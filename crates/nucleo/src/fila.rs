//! A fila serial: um trabalhador roda, em ordem, as etapas que existem de cada projeto.

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::lote::{self, LoteJson};
use crate::producao::{self, Producao, Qualidade};
use crate::projeto::{ModoDeImportacao, Origem, Parada, ProjetoJson};
use crate::sessao::{self, ErroDoRoteiro, EventoDaSessao, ResultadoDaRevisao, Roteirista};
use crate::transcricao::{Pedido, Transcritor};
use crate::youtube::Ytdlp;
use crate::{EstadoDaEtapa, Etapa, Evento, LigarArquivo, MotivoDeNotificacao, nome_do_arquivo};

/// Quanto esperar antes de tentar de novo quando o Claude não diz quando a cota libera.
const ESPERA_SEM_HORA: Duration = Duration::from_secs(5 * 60);

pub(crate) type Emitir = Arc<dyn Fn(Evento) + Send + Sync>;

/// O que o trabalhador faz com um projeto.
enum Trabalho {
    /// As etapas do projeto, da primeira não concluída em diante.
    Etapas(PathBuf),
    /// Só o render da versão final, sem sessão do Claude.
    VersaoFinal(PathBuf),
}

impl Trabalho {
    /// O id do projeto, se o trabalho é de etapas.
    fn projeto(&self) -> Option<String> {
        match self {
            Self::Etapas(pasta) => Some(nome_do_arquivo(pasta)),
            Self::VersaoFinal(_) => None,
        }
    }
}

/// Os pedidos de parada do projeto que está rodando.
#[derive(Clone, Default)]
struct Controle {
    pausar: Arc<AtomicBool>,
    cancelar: Arc<AtomicBool>,
}

/// Quem está na fila e quem está rodando.
#[derive(Default)]
struct Estado {
    /// O trabalho que espera a vez, na ordem em que o trabalhador o pega.
    pendentes: VecDeque<Trabalho>,
    atual: Option<(String, Controle)>,
    /// Os projetos que esperam a cota liberar, com a hora de tentar de novo.
    aguardando: Vec<(PathBuf, Instant)>,
    encerrar: bool,
}

struct Compartilhado {
    estado: Mutex<Estado>,
    acordar: Condvar,
}

/// O que a fila fez com o pedido de parar um projeto.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Parou {
    /// Estava esperando a vez: saiu da fila na hora.
    NaFila,
    /// Está rodando: o trabalhador para quando a etapa terminar (ou na hora, se cancelar).
    EmAndamento,
    /// Não está na fila nem rodando.
    NaoEstava,
}

/// Para onde um projeto que espera a vez anda na fila.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Movimento {
    /// Uma posição mais perto da vez.
    Subir,
    /// Uma posição mais longe da vez.
    Descer,
    /// A próxima vaga que abrir é dele.
    PassarNaFrente,
}

pub(crate) struct Fila {
    compartilhado: Arc<Compartilhado>,
}

fn travar(compartilhado: &Compartilhado) -> MutexGuard<'_, Estado> {
    compartilhado
        .estado
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

impl Drop for Fila {
    fn drop(&mut self) {
        travar(&self.compartilhado).encerrar = true;
        self.compartilhado.acordar.notify_all();
    }
}

impl Fila {
    pub fn new(
        emit: Emitir,
        ligar: LigarArquivo,
        transcritor: Option<Transcritor>,
        roteirista: Option<Roteirista>,
        producao: Option<Producao>,
        ytdlp: Option<Ytdlp>,
    ) -> Self {
        let compartilhado = Arc::new(Compartilhado {
            estado: Mutex::new(Estado::default()),
            acordar: Condvar::new(),
        });
        let do_trabalhador = Arc::clone(&compartilhado);
        thread::spawn(move || {
            while let Some(proxima) = proximo(&do_trabalhador) {
                let (trabalho, controle) = match proxima {
                    Proximo::Cota(pasta) => {
                        voltar_da_espera(&pasta, &emit);
                        travar(&do_trabalhador)
                            .pendentes
                            .push_back(Trabalho::Etapas(pasta));
                        continue;
                    }
                    Proximo::Trabalho(trabalho, controle) => (trabalho, controle),
                };
                match trabalho {
                    Trabalho::Etapas(pasta) => {
                        rodar(
                            &pasta,
                            &emit,
                            &Executores {
                                ligar: &ligar,
                                ytdlp: ytdlp.as_ref(),
                                transcritor: transcritor.as_ref(),
                                roteirista: roteirista.as_ref(),
                                producao: producao.as_ref(),
                                aguardar: &|pasta, libera_em| {
                                    travar(&do_trabalhador)
                                        .aguardando
                                        .push((pasta, instante_da_liberacao(libera_em)));
                                },
                            },
                            &controle,
                        );
                        notificar(&pasta, &emit);
                        travar(&do_trabalhador).atual = None;
                    }
                    Trabalho::VersaoFinal(pasta) => {
                        renderizar_versao_final(&pasta, &emit, producao.as_ref());
                    }
                }
            }
        });
        Self { compartilhado }
    }

    /// Põe o projeto no fim da fila; se já esperava, perde a vaga antiga.
    pub fn enfileirar(&self, pasta: PathBuf) {
        let id = nome_do_arquivo(&pasta);
        let mut estado = travar(&self.compartilhado);
        estado
            .pendentes
            .retain(|trabalho| trabalho.projeto().as_deref() != Some(&id));
        estado
            .aguardando
            .retain(|(pasta, _)| nome_do_arquivo(pasta) != id);
        estado.pendentes.push_back(Trabalho::Etapas(pasta));
        self.compartilhado.acordar.notify_one();
    }

    /// Tira da fila o projeto que espera a vez, ou pede ao que está rodando que pare ao fim da
    /// etapa.
    pub fn pausar(&self, id: &str) -> Parou {
        self.parar(id, |controle| controle.pausar.store(true, Ordering::SeqCst))
    }

    /// Tira da fila o projeto que espera a vez, ou mata o processo do que está rodando.
    pub fn cancelar(&self, id: &str) -> Parou {
        self.parar(id, |controle| {
            controle.cancelar.store(true, Ordering::SeqCst);
        })
    }

    fn parar(&self, id: &str, pedir: impl FnOnce(&Controle)) -> Parou {
        if self.tirar(id) {
            return Parou::NaFila;
        }
        match &travar(&self.compartilhado).atual {
            Some((atual, controle)) if atual == id => {
                pedir(controle);
                Parou::EmAndamento
            }
            _ => Parou::NaoEstava,
        }
    }

    /// O projeto está na fila esperando a vez.
    pub fn esperando(&self, id: &str) -> bool {
        travar(&self.compartilhado)
            .pendentes
            .iter()
            .any(|trabalho| trabalho.projeto().as_deref() == Some(id))
    }

    /// Tira da fila o projeto que espera a vez, ou a cota liberar; `false` se ele não estava
    /// lá.
    pub fn tirar(&self, id: &str) -> bool {
        let mut estado = travar(&self.compartilhado);
        let antes = estado.pendentes.len() + estado.aguardando.len();
        estado
            .pendentes
            .retain(|trabalho| trabalho.projeto().as_deref() != Some(id));
        estado
            .aguardando
            .retain(|(pasta, _)| nome_do_arquivo(pasta) != id);
        estado.pendentes.len() + estado.aguardando.len() != antes
    }

    /// Anda com o projeto que espera a vez e devolve a nova ordem dos que esperam; `None` se
    /// ele não está esperando.
    pub fn mover(&self, id: &str, movimento: Movimento) -> Option<Vec<String>> {
        let mut estado = travar(&self.compartilhado);
        let lugares: Vec<usize> = estado
            .pendentes
            .iter()
            .enumerate()
            .filter(|(_, trabalho)| trabalho.projeto().is_some())
            .map(|(lugar, _)| lugar)
            .collect();
        let posicao = lugares
            .iter()
            .position(|&lugar| estado.pendentes[lugar].projeto().as_deref() == Some(id))?;
        match movimento {
            Movimento::Subir if posicao > 0 => {
                estado
                    .pendentes
                    .swap(lugares[posicao], lugares[posicao - 1]);
            }
            Movimento::Descer if posicao + 1 < lugares.len() => {
                estado
                    .pendentes
                    .swap(lugares[posicao], lugares[posicao + 1]);
            }
            Movimento::PassarNaFrente if posicao > 0 => {
                if let Some(trabalho) = estado.pendentes.remove(lugares[posicao]) {
                    estado.pendentes.insert(lugares[0], trabalho);
                }
            }
            _ => {}
        }
        Some(
            estado
                .pendentes
                .iter()
                .filter_map(Trabalho::projeto)
                .collect(),
        )
    }

    /// Põe no fim da fila o render da versão final dos reels do projeto.
    pub fn enfileirar_versao_final(&self, pasta: PathBuf) {
        travar(&self.compartilhado)
            .pendentes
            .push_back(Trabalho::VersaoFinal(pasta));
        self.compartilhado.acordar.notify_one();
    }
}

/// O que o trabalhador faz a seguir.
enum Proximo {
    Trabalho(Trabalho, Controle),
    /// A cota deve ter liberado para o projeto: ele volta para a fila.
    Cota(PathBuf),
}

/// Espera o próximo trabalho da fila; `None` quando a fila foi largada. O projeto que começa
/// vira o que está rodando.
fn proximo(compartilhado: &Compartilhado) -> Option<Proximo> {
    let mut estado = travar(compartilhado);
    loop {
        if estado.encerrar {
            return None;
        }
        let agora = Instant::now();
        if let Some(lugar) = estado
            .aguardando
            .iter()
            .position(|(_, libera)| *libera <= agora)
        {
            return Some(Proximo::Cota(estado.aguardando.remove(lugar).0));
        }
        if let Some(trabalho) = estado.pendentes.pop_front() {
            let controle = Controle::default();
            if let Some(id) = trabalho.projeto() {
                estado.atual = Some((id, controle.clone()));
            }
            return Some(Proximo::Trabalho(trabalho, controle));
        }
        let proxima_liberacao = estado.aguardando.iter().map(|(_, libera)| *libera).min();
        estado = match proxima_liberacao {
            Some(libera) => {
                compartilhado
                    .acordar
                    .wait_timeout(estado, libera.saturating_duration_since(agora))
                    .unwrap_or_else(PoisonError::into_inner)
                    .0
            }
            None => compartilhado
                .acordar
                .wait(estado)
                .unwrap_or_else(PoisonError::into_inner),
        };
    }
}

/// Quando tentar de novo: na hora que o Claude deu para a cota liberar, ou daqui a pouco.
fn instante_da_liberacao(libera_em: Option<i64>) -> Instant {
    let espera = libera_em
        .and_then(|segundos| u64::try_from(segundos).ok())
        .and_then(|segundos| {
            Duration::from_secs(segundos)
                .checked_sub(SystemTime::now().duration_since(UNIX_EPOCH).ok()?)
        })
        .unwrap_or(if libera_em.is_some() {
            Duration::ZERO
        } else {
            ESPERA_SEM_HORA
        });
    Instant::now() + espera
}

/// A cota liberou: o projeto deixa de aguardar e volta ao fim da fila.
fn voltar_da_espera(pasta: &Path, emit: &Emitir) {
    let Ok(mut projeto) = ProjetoJson::ler(pasta) else {
        return;
    };
    if projeto.parada != Some(Parada::AguardandoCota) {
        return;
    }
    projeto.parada = None;
    // Sem gravar, a parada some só até o app fechar; a reabertura pausa o projeto do mesmo jeito.
    let _ = projeto.gravar(pasta);
    emit(Evento::ParadaMudou {
        projeto: nome_do_arquivo(pasta),
        parada: None,
    });
}

/// O render da versão final de um projeto cuja Produção já rodou. Os cortes e os rostos vêm do
/// cache da Produção; nenhuma sessão do Claude é aberta. A falha vai só no evento: as etapas
/// do projeto continuam como estavam.
fn renderizar_versao_final(pasta: &Path, emit: &Emitir, producao: Option<&Producao>) {
    let id = nome_do_arquivo(pasta);
    let mudou = |estado, falha| {
        emit(Evento::VersaoFinalMudou {
            projeto: id.clone(),
            estado,
            falha,
        });
    };
    mudou(EstadoDaEtapa::EmAndamento, None);
    let resultado = match (ProjetoJson::ler(pasta), producao) {
        (Ok(projeto), Some(producao)) => produzir_em(
            pasta,
            &projeto,
            producao,
            Qualidade::Final,
            &AtomicBool::new(false),
            &mut |percentual| {
                emit(Evento::ProgressoDaVersaoFinal {
                    projeto: id.clone(),
                    percentual,
                });
            },
        ),
        (Err(error), _) => Err(error.to_string()),
        (_, None) => Err("a Produção não está disponível".to_owned()),
    };
    match resultado {
        Ok(()) => mudou(EstadoDaEtapa::Concluida, None),
        Err(falha) => mudou(EstadoDaEtapa::Falhou, Some(falha)),
    }
}

/// O que sabe fazer cada etapa; a que não tem executor fica pendente.
#[derive(Clone, Copy)]
struct Executores<'a> {
    ligar: &'a LigarArquivo,
    ytdlp: Option<&'a Ytdlp>,
    transcritor: Option<&'a Transcritor>,
    roteirista: Option<&'a Roteirista>,
    producao: Option<&'a Producao>,
    /// Põe o projeto para esperar a cota liberar (em segundos desde 1970, se o Claude disse).
    aguardar: &'a dyn Fn(PathBuf, Option<i64>),
}

/// Por que uma etapa não terminou.
enum Falha {
    Erro(String),
    /// A cota do plano acabou: a etapa recomeça quando ela liberar.
    Cota {
        libera_em: Option<i64>,
    },
}

impl From<String> for Falha {
    fn from(erro: String) -> Self {
        Self::Erro(erro)
    }
}

impl From<&str> for Falha {
    fn from(erro: &str) -> Self {
        Self::Erro(erro.to_owned())
    }
}

impl From<ErroDoRoteiro> for Falha {
    fn from(erro: ErroDoRoteiro) -> Self {
        match erro {
            ErroDoRoteiro::CotaEsgotada { libera_em } => Self::Cota { libera_em },
            outro => Self::Erro(outro.to_string()),
        }
    }
}

/// Roda as etapas que existem, da primeira não concluída em diante, e para na primeira que
/// falha. As etapas sem executor continuam pendentes.
fn rodar(pasta: &Path, emit: &Emitir, executores: &Executores, controle: &Controle) {
    let Executores {
        ligar,
        ytdlp,
        transcritor,
        roteirista,
        producao,
        aguardar,
    } = *executores;
    let id = nome_do_arquivo(pasta);
    let mut projeto = match ProjetoJson::ler(pasta) {
        Ok(projeto) => projeto,
        Err(error) => {
            emit(Evento::EtapaMudou {
                projeto: id,
                etapa: Etapa::Importacao,
                estado: EstadoDaEtapa::Falhou,
                falha: Some(error.to_string()),
            });
            return;
        }
    };
    for etapa in Etapa::TODAS {
        let concluida = projeto
            .etapas
            .iter()
            .any(|item| item.etapa == etapa && item.estado == EstadoDaEtapa::Concluida);
        if concluida {
            continue;
        }
        if controle.cancelar.load(Ordering::SeqCst) {
            parar(pasta, &mut projeto, Parada::Cancelado, emit);
            return;
        }
        if controle.pausar.load(Ordering::SeqCst) {
            parar(pasta, &mut projeto, Parada::Pausado, emit);
            return;
        }
        let tem_executor = match etapa {
            Etapa::Importacao => true,
            Etapa::Transcricao => transcritor.is_some(),
            Etapa::Roteiro => roteirista.is_some(),
            Etapa::Producao => producao.is_some(),
            Etapa::Revisao => {
                projeto.opcoes.revisoes == 0 || (roteirista.is_some() && producao.is_some())
            }
        };
        if !tem_executor {
            return;
        }
        let transicao = |projeto: &mut ProjetoJson, estado, falha| {
            projeto.marcar(etapa, estado);
            projeto.falha = falha;
            // Sem gravar, o estado só vale nesta execução; a falha é avisada do mesmo jeito.
            let gravado = projeto.gravar(pasta);
            let falha = projeto
                .falha
                .clone()
                .or_else(|| gravado.err().map(|error| error.to_string()));
            emit(Evento::EtapaMudou {
                projeto: id.clone(),
                etapa,
                estado,
                falha,
            });
        };
        let cancelar: &AtomicBool = &controle.cancelar;
        transicao(&mut projeto, EstadoDaEtapa::EmAndamento, None);
        let resultado = match (etapa, transcritor, roteirista, producao) {
            (Etapa::Transcricao, Some(transcritor), _, _) => {
                transcrever(pasta, &mut projeto, transcritor, &id, emit, cancelar)
                    .map_err(Falha::Erro)
            }
            (Etapa::Roteiro, _, Some(roteirista), _) => {
                roteirizar(pasta, &projeto, roteirista, &id, emit, cancelar)
            }
            (Etapa::Producao, _, _, Some(producao)) => {
                produzir(pasta, &projeto, producao, &id, emit, cancelar).map_err(Falha::Erro)
            }
            (Etapa::Revisao, _, Some(roteirista), Some(producao)) => {
                revisar(pasta, &projeto, roteirista, producao, &id, emit, cancelar)
            }
            (Etapa::Revisao, ..) => Ok(()),
            _ => importar(pasta, &mut projeto, ligar, ytdlp, &id, emit, cancelar)
                .map_err(Falha::Erro),
        };
        // Cancelar descarta a etapa em curso, tenha ela terminado ou não.
        if cancelar.load(Ordering::SeqCst) {
            transicao(&mut projeto, EstadoDaEtapa::Pendente, None);
            parar(pasta, &mut projeto, Parada::Cancelado, emit);
            return;
        }
        match resultado {
            Ok(()) => transicao(&mut projeto, EstadoDaEtapa::Concluida, None),
            Err(Falha::Cota { libera_em }) => {
                transicao(&mut projeto, EstadoDaEtapa::Pendente, None);
                parar(pasta, &mut projeto, Parada::AguardandoCota, emit);
                aguardar(pasta.to_path_buf(), libera_em);
                return;
            }
            Err(Falha::Erro(falha)) => {
                transicao(&mut projeto, EstadoDaEtapa::Falhou, Some(falha));
                return;
            }
        }
    }
}

/// Avisa, por notificação do sistema, como o projeto terminou o que podia fazer: pronto,
/// falhou ou aguardando a cota; e, se isso fechou o lote, que o lote terminou.
fn notificar(pasta: &Path, emit: &Emitir) {
    let Ok(projeto) = ProjetoJson::ler(pasta) else {
        return;
    };
    let falhou = projeto
        .etapas
        .iter()
        .any(|item| item.estado == EstadoDaEtapa::Falhou);
    let pronto = projeto
        .etapas
        .iter()
        .all(|item| item.estado == EstadoDaEtapa::Concluida);
    let tipo = if projeto.parada == Some(Parada::AguardandoCota) {
        MotivoDeNotificacao::AguardandoCota
    } else if falhou {
        MotivoDeNotificacao::ProjetoFalhou
    } else if pronto {
        MotivoDeNotificacao::ProjetoPronto
    } else {
        return;
    };
    let biblioteca = pasta.parent();
    let lote_terminou = biblioteca
        .filter(|_| tipo != MotivoDeNotificacao::AguardandoCota)
        .and_then(|biblioteca| lote::nome_se_terminou(biblioteca, &projeto.lote));
    let nome_do_lote = lote_terminou
        .clone()
        .or_else(|| {
            biblioteca
                .and_then(|biblioteca| LoteJson::ler(biblioteca, &projeto.lote).ok())
                .map(|lote| lote.nome)
        })
        .unwrap_or_default();
    emit(Evento::Notificacao {
        motivo: tipo,
        projeto: projeto.titulo.clone(),
        lote: nome_do_lote.clone(),
    });
    if lote_terminou.is_some() {
        emit(Evento::Notificacao {
            motivo: MotivoDeNotificacao::LoteTerminado,
            projeto: projeto.titulo,
            lote: nome_do_lote,
        });
    }
}

/// Para o projeto: grava por que ele parou e avisa.
fn parar(pasta: &Path, projeto: &mut ProjetoJson, parada: Parada, emit: &Emitir) {
    projeto.parada = Some(parada);
    // Sem gravar, a parada só vale até o app fechar; a reabertura pausa o projeto do mesmo jeito.
    let _ = projeto.gravar(pasta);
    emit(Evento::ParadaMudou {
        projeto: nome_do_arquivo(pasta),
        parada: Some(parada),
    });
}

/// A Importação: um arquivo local vira um hardlink em `bruto/` (ou só a referência a ele,
/// noutro volume) e um link do YouTube é baixado para `bruto/`.
fn importar(
    pasta: &Path,
    projeto: &mut ProjetoJson,
    ligar: &LigarArquivo,
    ytdlp: Option<&Ytdlp>,
    id: &str,
    emit: &Emitir,
    cancelar: &AtomicBool,
) -> Result<(), String> {
    let faixa = projeto.opcoes.faixa;
    match &mut projeto.origem {
        Origem::Arquivo {
            caminho,
            nome,
            tamanho,
            modificado_em,
            modo,
        } => {
            let metadados = fs::metadata(&caminho).map_err(|error| error.to_string())?;
            *tamanho = metadados.len();
            *modificado_em = metadados.modified().ok().map(Into::into);
            let destino = pasta.join("bruto").join(&*nome);
            *modo = Some(if ligar(Path::new(caminho.as_str()), &destino).is_ok() {
                ModoDeImportacao::Hardlink
            } else {
                ModoDeImportacao::Referencia
            });
            Ok(())
        }
        Origem::Youtube { url, nome, .. } => {
            let bruto = pasta.join("bruto");
            if bruto.join(&*nome).is_file() {
                return Ok(());
            }
            let ytdlp = ytdlp.ok_or("o yt-dlp não está disponível")?;
            ytdlp.baixar(url, faixa, &bruto, cancelar, &mut |percentual| {
                emit(Evento::ProgressoDaEtapa {
                    projeto: id.to_owned(),
                    etapa: Etapa::Importacao,
                    percentual,
                });
            })?;
            Ok(())
        }
    }
}

/// A Transcrição do vídeo original: grava `edit/transcricao.json` e a transcrição compactada,
/// e o idioma detectado no projeto. Um idioma já definido no projeto (pelos padrões ou pelas
/// exceções) é respeitado.
fn transcrever(
    pasta: &Path,
    projeto: &mut ProjetoJson,
    transcritor: &Transcritor,
    id: &str,
    emit: &Emitir,
    cancelar: &AtomicBool,
) -> Result<(), String> {
    let video = projeto.origem.video(pasta);
    let mut ultimo = None;
    let transcricao = transcritor
        .transcrever(
            &Pedido {
                video: &video,
                pasta_de_saida: &pasta.join("edit"),
                idioma: projeto.idioma_do_video.as_deref(),
                nomes_proprios: &projeto.opcoes.nomes_proprios,
                // O vídeo baixado de um link já é só a faixa.
                faixa: match projeto.origem {
                    Origem::Arquivo { .. } => projeto.opcoes.faixa,
                    Origem::Youtube { .. } => None,
                },
            },
            cancelar,
            &mut |fracao| {
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let percentual = (fracao * 100.0).floor().clamp(0.0, 100.0) as u8;
                if ultimo != Some(percentual) {
                    ultimo = Some(percentual);
                    emit(Evento::ProgressoDaEtapa {
                        projeto: id.to_owned(),
                        etapa: Etapa::Transcricao,
                        percentual,
                    });
                }
            },
        )
        .map_err(|error| error.to_string())?;
    projeto.idioma_do_video = Some(transcricao.idioma);
    Ok(())
}

/// O Roteiro: a sessão do Claude escreve `edit/roteiro.json`, e o núcleo o valida no fim.
fn roteirizar(
    pasta: &Path,
    projeto: &ProjetoJson,
    roteirista: &Roteirista,
    id: &str,
    emit: &Emitir,
    cancelar: &AtomicBool,
) -> Result<(), Falha> {
    let nome = projeto.origem.nome();
    let idioma = projeto
        .idioma_do_video
        .as_deref()
        .ok_or("o idioma do vídeo não foi detectado")?;
    let modelo = (projeto.opcoes.modelo != "padrao").then_some(projeto.opcoes.modelo.as_str());
    roteirista
        .roteirizar(
            &sessao::Pedido {
                pasta,
                video: nome,
                idioma,
                cortes: projeto.opcoes.quantidade_de_reels,
                pedido: &projeto.opcoes.pedido,
                modelo,
            },
            cancelar,
            &mut |evento| emit(evento_da_sessao(id, Etapa::Roteiro, evento)),
        )
        .map_err(Falha::from)
}

fn evento_da_sessao(id: &str, etapa: Etapa, evento: EventoDaSessao) -> Evento {
    match evento {
        EventoDaSessao::Acao { ferramenta, alvo } => Evento::AcaoDoClaude {
            projeto: id.to_owned(),
            etapa,
            ferramenta,
            alvo,
        },
        EventoDaSessao::Tokens { entrada, cache } => Evento::TokensDoClaude {
            projeto: id.to_owned(),
            etapa,
            entrada,
            cache,
        },
    }
}

/// A Revisão: em cada rodada, a folha de revisão de cada reel vai para uma sessão do Claude
/// que corrige o roteiro; se ele mudou, a Produção refaz só os cortes alterados (pelo cache).
/// Sem mudanças, as rodadas que sobram seriam iguais e não rodam.
fn revisar(
    pasta: &Path,
    projeto: &ProjetoJson,
    roteirista: &Roteirista,
    producao: &Producao,
    id: &str,
    emit: &Emitir,
    cancelar: &AtomicBool,
) -> Result<(), Falha> {
    if projeto.opcoes.revisoes == 0 {
        return Ok(());
    }
    let nome = projeto.origem.nome();
    let idioma = projeto
        .idioma_do_video
        .as_deref()
        .ok_or("o idioma do vídeo não foi detectado")?;
    let modelo = (projeto.opcoes.modelo != "padrao").then_some(projeto.opcoes.modelo.as_str());
    let video = projeto.origem.video(pasta);
    let qualidade = if projeto.opcoes.previa {
        Qualidade::Previa
    } else {
        Qualidade::Final
    };
    let pedido_da_producao = producao::Pedido {
        pasta,
        video: &video,
        qualidade,
    };
    let produzir = || {
        producao
            .produzir(&pedido_da_producao, cancelar, &mut |_| {})
            .map_err(|error| error.to_string())
    };
    let mut reels = produzir()?;
    for _ in 0..projeto.opcoes.revisoes {
        producao
            .preparar_revisao(&pedido_da_producao, &reels, cancelar)
            .map_err(|error| error.to_string())?;
        let resultado = roteirista
            .revisar(
                &sessao::Pedido {
                    pasta,
                    video: nome,
                    idioma,
                    cortes: projeto.opcoes.quantidade_de_reels,
                    pedido: &projeto.opcoes.pedido,
                    modelo,
                },
                cancelar,
                &mut |evento| emit(evento_da_sessao(id, Etapa::Revisao, evento)),
            )
            .map_err(Falha::from)?;
        if resultado == ResultadoDaRevisao::SemMudancas {
            break;
        }
        reels = produzir()?;
    }
    Ok(())
}

/// A Produção: corta, segue o rosto e renderiza cada reel. A prévia (meia escala) vem antes da
/// versão final quando o projeto a pede.
fn produzir(
    pasta: &Path,
    projeto: &ProjetoJson,
    producao: &Producao,
    id: &str,
    emit: &Emitir,
    cancelar: &AtomicBool,
) -> Result<(), String> {
    let qualidade = if projeto.opcoes.previa {
        Qualidade::Previa
    } else {
        Qualidade::Final
    };
    produzir_em(
        pasta,
        projeto,
        producao,
        qualidade,
        cancelar,
        &mut |percentual| {
            emit(Evento::ProgressoDaEtapa {
                projeto: id.to_owned(),
                etapa: Etapa::Producao,
                percentual,
            });
        },
    )
}

/// Produz os reels do projeto na `qualidade`; `progresso` recebe o percentual (0 a 100) cada
/// vez que ele muda.
fn produzir_em(
    pasta: &Path,
    projeto: &ProjetoJson,
    producao: &Producao,
    qualidade: Qualidade,
    cancelar: &AtomicBool,
    progresso: &mut dyn FnMut(u8),
) -> Result<(), String> {
    let video = projeto.origem.video(pasta);
    let mut ultimo = None;
    producao
        .produzir(
            &producao::Pedido {
                pasta,
                video: &video,
                qualidade,
            },
            cancelar,
            &mut |fracao| {
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let percentual = (fracao * 100.0).floor().clamp(0.0, 100.0) as u8;
                if ultimo != Some(percentual) {
                    ultimo = Some(percentual);
                    progresso(percentual);
                }
            },
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}
