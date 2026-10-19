//! A fila: até o limite de vídeos ao mesmo tempo, cada trabalho roda numa thread própria, e
//! cada etapa pega a vaga do recurso que disputa (a GPU, o Claude ou o render) antes de usá-lo.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use specta::Type;
use time::OffsetDateTime;

use crate::lote::{self, LoteJson};
use crate::producao::{self, ErroDaProducao, Producao, Qualidade, Reel};
use crate::projeto::{ModoDeImportacao, Origem, Parada, ProjetoJson};
use crate::sessao::{self, ErroDoRoteiro, EventoDaSessao, ResultadoDaRevisao, Roteirista};
use crate::tempos::{self, Passo};
use crate::transcricao::{Pedido, Transcritor};
use crate::vagas::{AvisarVaga, Posse, Recurso, Recusa, Vagas};
use crate::youtube::Ytdlp;
use crate::{EstadoDaEtapa, Etapa, Evento, LigarArquivo, MotivoDeNotificacao, nome_do_arquivo};

/// Quanto esperar antes de tentar de novo quando o Claude não diz quando a cota libera.
const ESPERA_SEM_HORA: Duration = Duration::from_secs(5 * 60);

pub(crate) type Emitir = Arc<dyn Fn(Evento) + Send + Sync>;

/// O que a fila faz com um projeto.
enum Trabalho {
    /// As etapas do projeto, da primeira não concluída em diante.
    Etapas(PathBuf),
    /// Só o render da versão final, sem sessão do Claude.
    VersaoFinal(PathBuf),
}

impl Trabalho {
    fn pasta(&self) -> &Path {
        match self {
            Self::Etapas(pasta) | Self::VersaoFinal(pasta) => pasta,
        }
    }

    /// O id do projeto do trabalho, seja ele qual for.
    fn id(&self) -> String {
        nome_do_arquivo(self.pasta())
    }

    /// O id do projeto, se o trabalho é de etapas.
    fn projeto(&self) -> Option<String> {
        match self {
            Self::Etapas(pasta) => Some(nome_do_arquivo(pasta)),
            Self::VersaoFinal(_) => None,
        }
    }
}

/// Os pedidos de parada de um trabalho que está rodando.
#[derive(Clone, Default)]
struct Controle {
    pausar: Arc<AtomicBool>,
    /// Mata o processo e descarta a etapa em curso.
    cancelar: Arc<AtomicBool>,
    /// Junto com `cancelar`, quando o app vai fechar: o projeto volta Pausado, e não Cancelado.
    interromper: Arc<AtomicBool>,
}

impl Controle {
    /// Como fica o projeto cujo processo o `cancelar` matou.
    fn parada_do_cancelar(&self) -> Parada {
        if self.interromper.load(Ordering::SeqCst) {
            Parada::Pausado
        } else {
            Parada::Cancelado
        }
    }

    /// Pediram para o projeto parar: ao fim da etapa (pausa) ou agora.
    fn parado(&self) -> bool {
        self.pausar.load(Ordering::SeqCst) || self.cancelar.load(Ordering::SeqCst)
    }
}

/// Um trabalho que está rodando.
struct Rodando {
    controle: Controle,
    pasta: PathBuf,
    /// É de etapas, e não a versão final.
    etapas: bool,
}

/// Quem está na fila e quem está rodando.
struct Estado {
    /// O trabalho que espera a vez, na ordem em que a fila o começa.
    pendentes: VecDeque<Trabalho>,
    /// O que está rodando, pelo id do projeto: um trabalho por projeto de cada vez.
    em_andamento: HashMap<String, Rodando>,
    /// Os projetos que esperam a cota liberar, com a hora de tentar de novo.
    aguardando: Vec<(PathBuf, Instant)>,
    /// Quantos trabalhos rodam ao mesmo tempo: os vídeos ao mesmo tempo.
    limite: usize,
    /// A posição na fila do próximo trabalho que começar; quem começou antes pega a vaga antes.
    proxima_ordem: u64,
    encerrar: bool,
}

struct Compartilhado {
    estado: Mutex<Estado>,
    acordar: Condvar,
}

/// O que os trabalhos usam: os executores de cada etapa, as vagas e o aviso à interface.
struct Oficina {
    emit: Emitir,
    ligar: LigarArquivo,
    ytdlp: Option<Ytdlp>,
    transcritor: Option<Transcritor>,
    roteirista: Option<Roteirista>,
    producao: Option<Producao>,
    vagas: Vagas,
    /// Um trabalho termina de cada vez: saber se o lote terminou depende de quem ainda roda.
    terminando: Mutex<()>,
}

/// O que a fila fez com o pedido de parar um projeto.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Parou {
    /// Estava esperando a vez: saiu da fila na hora.
    NaFila,
    /// Está rodando: o trabalho para quando a etapa terminar (ou na hora, se cancelar).
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
    vagas: Vagas,
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
    /// A fila começa com um vídeo de cada vez e uma vaga de cada recurso.
    pub fn new(
        emit: Emitir,
        ligar: LigarArquivo,
        transcritor: Option<Transcritor>,
        roteirista: Option<Roteirista>,
        producao: Option<Producao>,
        ytdlp: Option<Ytdlp>,
    ) -> Self {
        let compartilhado = Arc::new(Compartilhado {
            estado: Mutex::new(Estado {
                pendentes: VecDeque::new(),
                em_andamento: HashMap::new(),
                aguardando: Vec::new(),
                limite: 1,
                proxima_ordem: 0,
                encerrar: false,
            }),
            acordar: Condvar::new(),
        });
        let avisar: AvisarVaga = {
            let emit = Arc::clone(&emit);
            Arc::new(move |projeto: &str, recurso, estado| {
                emit(Evento::VagaMudou {
                    projeto: projeto.to_owned(),
                    recurso,
                    estado,
                });
            })
        };
        let vagas = Vagas::new(avisar);
        let oficina = Arc::new(Oficina {
            emit,
            ligar,
            ytdlp,
            transcritor,
            roteirista,
            producao,
            vagas: vagas.clone(),
            terminando: Mutex::new(()),
        });
        let do_despachante = Arc::clone(&compartilhado);
        thread::spawn(move || {
            while let Some((trabalho, controle, ordem)) = proximo(&do_despachante, &oficina.emit) {
                let oficina = Arc::clone(&oficina);
                let compartilhado = Arc::clone(&do_despachante);
                thread::spawn(move || {
                    trabalhar(&oficina, &compartilhado, &trabalho, &controle, ordem);
                });
            }
        });
        Self {
            compartilhado,
            vagas,
        }
    }

    /// As vagas dos recursos, para mudar a capacidade do Claude ou reabrir a vaga dele.
    pub fn vagas(&self) -> &Vagas {
        &self.vagas
    }

    /// Muda quantos trabalhos rodam ao mesmo tempo. Acima do limite novo, quem roda termina o
    /// que faz, e a fila só começa outro quando sobrar lugar.
    pub fn definir_limite(&self, limite: usize) {
        travar(&self.compartilhado).limite = limite.max(1);
        self.compartilhado.acordar.notify_all();
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
        self.compartilhado.acordar.notify_all();
    }

    /// Tira da fila o projeto que espera a vez, ou pede ao que está rodando que pare ao fim da
    /// etapa (ou na hora, se ainda espera uma vaga).
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
        match travar(&self.compartilhado).em_andamento.get(id) {
            Some(rodando) if rodando.etapas => {
                pedir(&rodando.controle);
                Parou::EmAndamento
            }
            _ => Parou::NaoEstava,
        }
    }

    /// Para tudo para o app fechar: a fila não começa mais nada, e os trabalhos que estão
    /// rodando têm o processo morto (um projeto volta Pausado, com a etapa em curso
    /// descartada). Volta quando nenhum trabalho roda mais, ou depois de `espera`.
    pub fn interromper(&self, espera: Duration) {
        let mut estado = travar(&self.compartilhado);
        estado.encerrar = true;
        for rodando in estado.em_andamento.values() {
            rodando.controle.interromper.store(true, Ordering::SeqCst);
            rodando.controle.cancelar.store(true, Ordering::SeqCst);
        }
        self.compartilhado.acordar.notify_all();
        let _ = self
            .compartilhado
            .acordar
            .wait_timeout_while(estado, espera, |estado| !estado.em_andamento.is_empty());
    }

    /// Há trabalho rodando (inclusive uma versão final), esperando a vez ou esperando a cota.
    pub fn ocupada(&self) -> bool {
        let estado = travar(&self.compartilhado);
        !estado.em_andamento.is_empty()
            || !estado.pendentes.is_empty()
            || !estado.aguardando.is_empty()
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

    /// Esquece o projeto que vai ser apagado: as etapas e a versão final que esperam a vez, e
    /// a espera da cota.
    pub fn esquecer(&self, id: &str) {
        let mut estado = travar(&self.compartilhado);
        estado.pendentes.retain(|trabalho| trabalho.id() != id);
        estado
            .aguardando
            .retain(|(pasta, _)| nome_do_arquivo(pasta) != id);
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
        self.compartilhado.acordar.notify_all();
    }
}

/// Espera o próximo trabalho que pode começar: há lugar abaixo do limite e o projeto dele não
/// está rodando. Devolve o trabalho com a posição dele na fila, ou `None` quando a fila foi
/// largada. O trabalho que começa entra no `em_andamento`; o projeto cuja cota deve ter
/// liberado volta para o fim da fila.
fn proximo(compartilhado: &Compartilhado, emit: &Emitir) -> Option<(Trabalho, Controle, u64)> {
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
            // Sob a trava, junto com a saída da espera: quem cancela o projeto ao mesmo tempo
            // o acha ainda na espera ou já de volta à fila, e nunca grava por cima desta volta.
            let pasta = estado.aguardando.remove(lugar).0;
            if voltar_da_espera(&pasta, emit) {
                estado.pendentes.push_back(Trabalho::Etapas(pasta));
            }
            continue;
        }
        let livre = estado.em_andamento.len() < estado.limite;
        if let Some(lugar) = estado
            .pendentes
            .iter()
            .position(|trabalho| !estado.em_andamento.contains_key(&trabalho.id()))
            .filter(|_| livre)
            && let Some(trabalho) = estado.pendentes.remove(lugar)
        {
            let controle = Controle::default();
            let ordem = estado.proxima_ordem;
            estado.proxima_ordem += 1;
            estado.em_andamento.insert(
                trabalho.id(),
                Rodando {
                    controle: controle.clone(),
                    pasta: trabalho.pasta().to_path_buf(),
                    etapas: trabalho.projeto().is_some(),
                },
            );
            return Some((trabalho, controle, ordem));
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

/// Roda um trabalho na thread dele, avisa como o projeto terminou e libera o lugar na fila.
fn trabalhar(
    oficina: &Oficina,
    compartilhado: &Compartilhado,
    trabalho: &Trabalho,
    controle: &Controle,
    ordem: u64,
) {
    let id = trabalho.id();
    let vez = Vez {
        vagas: &oficina.vagas,
        projeto: &id,
        ordem,
        edit: trabalho.pasta().join("edit"),
    };
    let fim = match trabalho {
        Trabalho::Etapas(pasta) => rodar(pasta, oficina, &vez, controle, &|pasta, libera| {
            travar(compartilhado).aguardando.push((pasta, libera));
        }),
        Trabalho::VersaoFinal(pasta) => {
            renderizar_versao_final(pasta, oficina, &vez, &controle.cancelar);
            Fim::Normal
        }
    };
    // Dois trabalhos do mesmo lote terminando juntos: o primeiro vê o outro ainda rodando e
    // deixa para ele dizer que o lote terminou.
    let _terminando = oficina
        .terminando
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if let Trabalho::Etapas(pasta) = trabalho {
        let outros: Vec<PathBuf> = travar(compartilhado)
            .em_andamento
            .iter()
            .filter(|(outro, rodando)| **outro != id && rodando.etapas)
            .map(|(_, rodando)| rodando.pasta.clone())
            .collect();
        notificar(pasta, &oficina.emit, &fim, &outros);
    }
    travar(compartilhado).em_andamento.remove(&id);
    // Quem espera um lugar na fila e quem espera o trabalho largar os processos.
    compartilhado.acordar.notify_all();
}

/// A vez de um trabalho nas vagas: o projeto e a posição em que ele começou.
struct Vez<'a> {
    vagas: &'a Vagas,
    projeto: &'a str,
    ordem: u64,
    edit: PathBuf,
}

impl Vez<'_> {
    /// Pega a vaga do recurso e, se precisou esperar, grava a espera em `edit/tempos.jsonl`.
    fn pegar(
        &self,
        etapa: Option<Etapa>,
        recurso: Recurso,
        parar: &dyn Fn() -> bool,
    ) -> Result<Posse, Recusa> {
        let inicio = OffsetDateTime::now_utc();
        let posse = self.vagas.pegar(recurso, self.projeto, self.ordem, parar)?;
        if posse.esperou {
            let nome = match recurso {
                Recurso::Gpu => "esperaPelaGpu",
                Recurso::Claude => "esperaPeloClaude",
                Recurso::Render => "esperaPeloRender",
            };
            let passo = Passo {
                etapa,
                nome,
                reel: None,
            };
            tempos::registrar(&self.edit, passo, inicio, OffsetDateTime::now_utc());
        }
        Ok(posse)
    }

    /// A falha de uma sessão do Claude. Se a cota acabou, a vaga dele fecha até ela liberar, e
    /// isso acontece enquanto quem a viu acabar ainda segura a vaga: quem esperava por ela não
    /// chega a abrir uma sessão.
    fn falha_da_sessao(&self, erro: ErroDoRoteiro) -> Falha {
        match erro {
            ErroDoRoteiro::CotaEsgotada { libera_em } => {
                let libera = instante_da_liberacao(libera_em);
                Falha::Cota {
                    libera,
                    nova: self.vagas.fechar_ate(Recurso::Claude, libera),
                }
            }
            outro => Falha::Erro(outro.to_string()),
        }
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

/// A cota liberou: o projeto deixa de aguardar. Devolve se ele ainda aguardava, isto é, se
/// volta para a fila.
fn voltar_da_espera(pasta: &Path, emit: &Emitir) -> bool {
    let Ok(mut projeto) = ProjetoJson::ler(pasta) else {
        return false;
    };
    if projeto.parada != Some(Parada::AguardandoCota) {
        return false;
    }
    projeto.parada = None;
    // Sem gravar, a parada some só até o app fechar; a reabertura pausa o projeto do mesmo jeito.
    let _ = projeto.gravar(pasta);
    emit(Evento::ParadaMudou {
        projeto: nome_do_arquivo(pasta),
        parada: None,
    });
    true
}

/// O render da versão final de um projeto cuja Produção já rodou. Os cortes e os rostos vêm do
/// cache da Produção; nenhuma sessão do Claude é aberta. A falha vai só no evento: as etapas
/// do projeto continuam como estavam.
fn renderizar_versao_final(pasta: &Path, oficina: &Oficina, vez: &Vez, cancelar: &AtomicBool) {
    let emit = &oficina.emit;
    let id = nome_do_arquivo(pasta);
    let mudou = |estado, falha| {
        emit(Evento::VersaoFinalMudou {
            projeto: id.clone(),
            estado,
            falha,
        });
    };
    mudou(EstadoDaEtapa::EmAndamento, None);
    let passo = Passo {
        etapa: None,
        nome: "versaoFinal",
        reel: None,
    };
    let resultado = match (ProjetoJson::ler(pasta), oficina.producao.as_ref()) {
        (Ok(projeto), Some(producao)) => tempos::medir(&pasta.join("edit"), passo, || {
            produzir_em(
                pasta,
                &projeto,
                producao,
                Qualidade::Final,
                vez,
                None,
                cancelar,
                &|| cancelar.load(Ordering::SeqCst),
                &mut |percentual| {
                    emit(Evento::ProgressoDaVersaoFinal {
                        projeto: id.clone(),
                        percentual,
                    });
                },
            )
        })
        .map_err(Falha::texto),
        (Err(error), _) => Err(error.to_string()),
        (_, None) => Err("a Produção não está disponível".to_owned()),
    };
    match resultado {
        Ok(_) => mudou(EstadoDaEtapa::Concluida, None),
        Err(falha) => mudou(EstadoDaEtapa::Falhou, Some(falha)),
    }
}

/// Por que uma etapa não terminou.
enum Falha {
    Erro(String),
    /// A cota do plano acabou: a etapa recomeça quando ela liberar, no instante dado. `nova`
    /// diz se foi este projeto que a viu acabar; os outros esperam a mesma cota sem avisar.
    Cota {
        libera: Instant,
        nova: bool,
    },
    /// O projeto foi pausado enquanto esperava uma vaga no meio da etapa: ela volta a Pendente
    /// sem perder nada, porque o que ela já fez está no cache.
    Pausada,
}

impl Falha {
    /// A falha como a mensagem que vai no evento.
    fn texto(self) -> String {
        match self {
            Self::Erro(erro) => erro,
            Self::Cota { .. } => "a cota do Claude acabou".to_owned(),
            Self::Pausada => "pausado".to_owned(),
        }
    }
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

/// Como um trabalho de etapas terminou, para as notificações.
#[derive(PartialEq, Eq)]
enum Fim {
    Normal,
    /// Parou para esperar uma cota que outro projeto já avisou.
    CotaJaAvisada,
}

/// A vaga que a etapa pega antes de começar, se pega alguma; a da Produção e a da Revisão são
/// pegas dentro da etapa, só quando ela precisa.
fn vaga_antes_da_etapa(etapa: Etapa) -> Option<Recurso> {
    match etapa {
        Etapa::Transcricao => Some(Recurso::Gpu),
        Etapa::Roteiro => Some(Recurso::Claude),
        Etapa::Importacao | Etapa::Producao | Etapa::Revisao => None,
    }
}

/// Roda as etapas que existem, da primeira não concluída em diante, e para na primeira que
/// falha. As etapas sem executor continuam pendentes.
fn rodar(
    pasta: &Path,
    oficina: &Oficina,
    vez: &Vez,
    controle: &Controle,
    aguardar: &dyn Fn(PathBuf, Instant),
) -> Fim {
    let Oficina {
        emit,
        ligar,
        ytdlp,
        transcritor,
        roteirista,
        producao,
        ..
    } = oficina;
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
            return Fim::Normal;
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
            parar(pasta, &mut projeto, controle.parada_do_cancelar(), emit);
            return Fim::Normal;
        }
        if controle.pausar.load(Ordering::SeqCst) {
            parar(pasta, &mut projeto, Parada::Pausado, emit);
            return Fim::Normal;
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
            return Fim::Normal;
        }
        // Quem espera a vaga continua com a etapa Pendente, e a pausa vale na hora.
        let posse = match vaga_antes_da_etapa(etapa) {
            None => None,
            Some(recurso) => match vez.pegar(Some(etapa), recurso, &|| controle.parado()) {
                Ok(posse) => Some(posse),
                Err(Recusa::Parou) => {
                    let parada = if controle.cancelar.load(Ordering::SeqCst) {
                        controle.parada_do_cancelar()
                    } else {
                        Parada::Pausado
                    };
                    parar(pasta, &mut projeto, parada, emit);
                    return Fim::Normal;
                }
                Err(Recusa::Fechada(libera)) => {
                    parar(pasta, &mut projeto, Parada::AguardandoCota, emit);
                    aguardar(pasta.to_path_buf(), libera);
                    return Fim::CotaJaAvisada;
                }
            },
        };
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
                roteirizar(pasta, &projeto, roteirista, &id, emit, vez, cancelar)
            }
            (Etapa::Producao, _, _, Some(producao)) => {
                produzir(pasta, &projeto, producao, &id, emit, vez, controle)
            }
            (Etapa::Revisao, _, Some(roteirista), Some(producao)) => revisar(
                pasta, &projeto, roteirista, producao, &id, emit, vez, cancelar,
            ),
            (Etapa::Revisao, ..) => Ok(()),
            _ => importar(
                pasta,
                &mut projeto,
                ligar,
                ytdlp.as_ref(),
                &id,
                emit,
                cancelar,
            )
            .map_err(Falha::Erro),
        };
        drop(posse);
        // Cancelar descarta a etapa em curso, tenha ela terminado ou não.
        if cancelar.load(Ordering::SeqCst) {
            transicao(&mut projeto, EstadoDaEtapa::Pendente, None);
            parar(pasta, &mut projeto, controle.parada_do_cancelar(), emit);
            return Fim::Normal;
        }
        match resultado {
            Ok(()) => transicao(&mut projeto, EstadoDaEtapa::Concluida, None),
            Err(Falha::Cota { libera, nova }) => {
                transicao(&mut projeto, EstadoDaEtapa::Pendente, None);
                parar(pasta, &mut projeto, Parada::AguardandoCota, emit);
                aguardar(pasta.to_path_buf(), libera);
                return if nova {
                    Fim::Normal
                } else {
                    Fim::CotaJaAvisada
                };
            }
            Err(Falha::Pausada) => {
                transicao(&mut projeto, EstadoDaEtapa::Pendente, None);
                parar(pasta, &mut projeto, Parada::Pausado, emit);
                return Fim::Normal;
            }
            Err(Falha::Erro(falha)) => {
                transicao(&mut projeto, EstadoDaEtapa::Falhou, Some(falha));
                return Fim::Normal;
            }
        }
    }
    Fim::Normal
}

/// Avisa, por notificação do sistema, como o projeto terminou o que podia fazer: pronto,
/// falhou ou aguardando a cota (só quem a viu acabar; os outros esperam a mesma cota); e, se
/// isso fechou o lote, que o lote terminou. Com outro projeto do lote ainda rodando (`outros`
/// são as pastas dos que rodam), o lote não terminou: quem terminar por último avisa.
fn notificar(pasta: &Path, emit: &Emitir, fim: &Fim, outros: &[PathBuf]) {
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
        if *fim == Fim::CotaJaAvisada {
            return;
        }
        MotivoDeNotificacao::AguardandoCota
    } else if falhou {
        MotivoDeNotificacao::ProjetoFalhou
    } else if pronto {
        MotivoDeNotificacao::ProjetoPronto
    } else {
        return;
    };
    let outro_do_lote_rodando = outros
        .iter()
        .any(|outro| ProjetoJson::ler(outro).is_ok_and(|outro| outro.lote == projeto.lote));
    let biblioteca = pasta.parent();
    let lote_terminou = biblioteca
        .filter(|_| tipo != MotivoDeNotificacao::AguardandoCota && !outro_do_lote_rodando)
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
            let passo = Passo::da_etapa(Etapa::Importacao, "download");
            tempos::medir(&pasta.join("edit"), passo, || {
                ytdlp.baixar(url, faixa, &bruto, cancelar, &mut |percentual| {
                    emit(Evento::ProgressoDaEtapa {
                        projeto: id.to_owned(),
                        etapa: Etapa::Importacao,
                        percentual,
                    });
                })
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
    vez: &Vez,
    cancelar: &AtomicBool,
) -> Result<(), Falha> {
    let nome = projeto.origem.nome();
    let idioma = projeto
        .idioma_do_video
        .as_deref()
        .ok_or("o idioma do vídeo não foi detectado")?;
    let modelo = (projeto.opcoes.modelo != "padrao").then_some(projeto.opcoes.modelo.as_str());
    let passo = Passo::da_etapa(Etapa::Roteiro, "sessao");
    tempos::medir(&pasta.join("edit"), passo, || {
        roteirista.roteirizar(
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
    })
    .map_err(|erro| vez.falha_da_sessao(erro))
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
/// Sem mudanças, as rodadas que sobram seriam iguais e não rodam. A sessão pega a vaga do
/// Claude e a Produção, a do render; esperar qualquer uma só para com o Cancelar, porque pausar
/// entre as rodadas jogaria fora uma rodada já paga.
#[allow(clippy::too_many_arguments)]
fn revisar(
    pasta: &Path,
    projeto: &ProjetoJson,
    roteirista: &Roteirista,
    producao: &Producao,
    id: &str,
    emit: &Emitir,
    vez: &Vez,
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
    let edit = pasta.join("edit");
    let cancelado = || cancelar.load(Ordering::SeqCst);
    let produzir = || {
        tempos::medir(&edit, Passo::da_etapa(Etapa::Revisao, "producao"), || {
            produzir_em(
                pasta,
                projeto,
                producao,
                qualidade,
                vez,
                Some(Etapa::Revisao),
                cancelar,
                &cancelado,
                &mut |_| {},
            )
        })
    };
    let mut reels = produzir()?;
    for _ in 0..projeto.opcoes.revisoes {
        tempos::medir(&edit, Passo::da_etapa(Etapa::Revisao, "folhas"), || {
            producao.preparar_revisao(&pedido_da_producao, &reels, cancelar)
        })
        .map_err(|error| error.to_string())?;
        let resultado = {
            let _vaga = vez
                .pegar(Some(Etapa::Revisao), Recurso::Claude, &cancelado)
                .map_err(|recusa| match recusa {
                    Recusa::Fechada(libera) => Falha::Cota {
                        libera,
                        nova: false,
                    },
                    Recusa::Parou => Falha::Erro("cancelado".to_owned()),
                })?;
            tempos::medir(&edit, Passo::da_etapa(Etapa::Revisao, "sessao"), || {
                roteirista.revisar(
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
            })
            .map_err(|erro| vez.falha_da_sessao(erro))?
        };
        if resultado == ResultadoDaRevisao::SemMudancas {
            break;
        }
        reels = produzir()?;
    }
    Ok(())
}

/// A Produção: corta, segue o rosto e renderiza cada reel. A prévia (meia escala) vem antes da
/// versão final quando o projeto a pede. Pausar enquanto espera a vaga do render para na hora.
fn produzir(
    pasta: &Path,
    projeto: &ProjetoJson,
    producao: &Producao,
    id: &str,
    emit: &Emitir,
    vez: &Vez,
    controle: &Controle,
) -> Result<(), Falha> {
    let qualidade = if projeto.opcoes.previa {
        Qualidade::Previa
    } else {
        Qualidade::Final
    };
    let passo = Passo::da_etapa(Etapa::Producao, "producao");
    tempos::medir(&pasta.join("edit"), passo, || {
        produzir_em(
            pasta,
            projeto,
            producao,
            qualidade,
            vez,
            Some(Etapa::Producao),
            &controle.cancelar,
            &|| controle.parado(),
            &mut |percentual| {
                emit(Evento::ProgressoDaEtapa {
                    projeto: id.to_owned(),
                    etapa: Etapa::Producao,
                    percentual,
                });
            },
        )
    })
    .map(|_| ())
}

/// Produz os reels do projeto na `qualidade`; `progresso` recebe o percentual (0 a 100) cada
/// vez que ele muda. A vaga do render é pega na `vez` só antes do primeiro processo que o
/// cache não evita, e fica até o fim; esperar por ela para quando `parar` fica verdadeiro, e
/// aí a falha é [`Falha::Pausada`] se não foi o `cancelar`.
#[allow(clippy::too_many_arguments)]
fn produzir_em(
    pasta: &Path,
    projeto: &ProjetoJson,
    producao: &Producao,
    qualidade: Qualidade,
    vez: &Vez,
    etapa: Option<Etapa>,
    cancelar: &AtomicBool,
    parar: &(dyn Fn() -> bool + Sync),
    progresso: &mut dyn FnMut(u8),
) -> Result<Vec<Reel>, Falha> {
    let video = projeto.origem.video(pasta);
    let vaga: Mutex<Option<Posse>> = Mutex::new(None);
    let parou_na_espera = AtomicBool::new(false);
    let garantir_vaga = || {
        let mut vaga = vaga.lock().unwrap_or_else(PoisonError::into_inner);
        if vaga.is_none() {
            match vez.pegar(etapa, Recurso::Render, parar) {
                Ok(posse) => *vaga = Some(posse),
                Err(_) => {
                    parou_na_espera.store(true, Ordering::SeqCst);
                    return Err(ErroDaProducao::Cancelada);
                }
            }
        }
        Ok(())
    };
    let mut ultimo = None;
    let resultado = producao.produzir_na_vez(
        &producao::Pedido {
            pasta,
            video: &video,
            qualidade,
        },
        cancelar,
        &garantir_vaga,
        &mut |fracao| {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let percentual = (fracao * 100.0).floor().clamp(0.0, 100.0) as u8;
            if ultimo != Some(percentual) {
                ultimo = Some(percentual);
                progresso(percentual);
            }
        },
    );
    match resultado {
        Ok(reels) => Ok(reels),
        Err(_) if parou_na_espera.load(Ordering::SeqCst) && !cancelar.load(Ordering::SeqCst) => {
            Err(Falha::Pausada)
        }
        Err(error) => Err(Falha::Erro(error.to_string())),
    }
}
