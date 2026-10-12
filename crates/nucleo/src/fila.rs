//! A fila serial: um trabalhador roda, em ordem, as etapas que existem de cada projeto.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;

use crate::producao::{self, Producao, Qualidade};
use crate::projeto::{ModoDeImportacao, Origem, Parada, ProjetoJson};
use crate::sessao::{self, EventoDaSessao, ResultadoDaRevisao, Roteirista};
use crate::transcricao::{Pedido, Transcritor};
use crate::youtube::Ytdlp;
use crate::{EstadoDaEtapa, Etapa, Evento, LigarArquivo, nome_do_arquivo};

pub(crate) type Emitir = Arc<dyn Fn(Evento) + Send + Sync>;

/// O que o trabalhador faz com um projeto.
enum Trabalho {
    /// As etapas do projeto, da primeira não concluída em diante. O número identifica a vez
    /// dele na fila: pausar ou cancelar o projeto ainda na fila invalida a vez.
    Etapas(PathBuf, u64),
    /// Só o render da versão final, sem sessão do Claude.
    VersaoFinal(PathBuf),
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
    proxima_vez: u64,
    /// O projeto na fila e a vez dele.
    esperando: HashMap<String, u64>,
    atual: Option<(String, Controle)>,
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

pub(crate) struct Fila {
    envio: Sender<Trabalho>,
    estado: Arc<Mutex<Estado>>,
}

fn travar(estado: &Mutex<Estado>) -> std::sync::MutexGuard<'_, Estado> {
    estado.lock().unwrap_or_else(PoisonError::into_inner)
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
        let (envio, recebimento) = mpsc::channel::<Trabalho>();
        let estado = Arc::new(Mutex::new(Estado::default()));
        let do_trabalhador = Arc::clone(&estado);
        thread::spawn(move || {
            for trabalho in recebimento {
                match trabalho {
                    Trabalho::Etapas(pasta, vez) => {
                        let id = nome_do_arquivo(&pasta);
                        let controle = Controle::default();
                        {
                            let mut estado = travar(&do_trabalhador);
                            if estado.esperando.get(&id) != Some(&vez) {
                                continue;
                            }
                            estado.esperando.remove(&id);
                            estado.atual = Some((id, controle.clone()));
                        }
                        rodar(
                            &pasta,
                            &emit,
                            &Executores {
                                ligar: &ligar,
                                ytdlp: ytdlp.as_ref(),
                                transcritor: transcritor.as_ref(),
                                roteirista: roteirista.as_ref(),
                                producao: producao.as_ref(),
                            },
                            &controle,
                        );
                        travar(&do_trabalhador).atual = None;
                    }
                    Trabalho::VersaoFinal(pasta) => {
                        renderizar_versao_final(&pasta, &emit, producao.as_ref());
                    }
                }
            }
        });
        Self { envio, estado }
    }

    /// Põe o projeto no fim da fila.
    pub fn enfileirar(&self, pasta: PathBuf) {
        let vez = {
            let mut estado = travar(&self.estado);
            estado.proxima_vez += 1;
            let vez = estado.proxima_vez;
            estado.esperando.insert(nome_do_arquivo(&pasta), vez);
            vez
        };
        // O trabalhador só sai quando a fila é largada.
        let _ = self.envio.send(Trabalho::Etapas(pasta, vez));
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
        let mut estado = travar(&self.estado);
        if estado.esperando.remove(id).is_some() {
            return Parou::NaFila;
        }
        match &estado.atual {
            Some((atual, controle)) if atual == id => {
                pedir(controle);
                Parou::EmAndamento
            }
            _ => Parou::NaoEstava,
        }
    }

    /// Põe no fim da fila o render da versão final dos reels do projeto.
    pub fn enfileirar_versao_final(&self, pasta: PathBuf) {
        let _ = self.envio.send(Trabalho::VersaoFinal(pasta));
    }
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
            }
            (Etapa::Roteiro, _, Some(roteirista), _) => {
                roteirizar(pasta, &projeto, roteirista, &id, emit, cancelar)
            }
            (Etapa::Producao, _, _, Some(producao)) => {
                produzir(pasta, &projeto, producao, &id, emit, cancelar)
            }
            (Etapa::Revisao, _, Some(roteirista), Some(producao)) => {
                revisar(pasta, &projeto, roteirista, producao, &id, emit, cancelar)
            }
            (Etapa::Revisao, ..) => Ok(()),
            _ => importar(pasta, &mut projeto, ligar, ytdlp, &id, emit, cancelar),
        };
        // Cancelar descarta a etapa em curso, tenha ela terminado ou não.
        if cancelar.load(Ordering::SeqCst) {
            transicao(&mut projeto, EstadoDaEtapa::Pendente, None);
            parar(pasta, &mut projeto, Parada::Cancelado, emit);
            return;
        }
        match resultado {
            Ok(()) => transicao(&mut projeto, EstadoDaEtapa::Concluida, None),
            Err(falha) => {
                transicao(&mut projeto, EstadoDaEtapa::Falhou, Some(falha));
                return;
            }
        }
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
) -> Result<(), String> {
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
        .map_err(|error| error.to_string())
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
) -> Result<(), String> {
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
            .map_err(|error| error.to_string())?;
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
