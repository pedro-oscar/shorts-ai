//! A fila serial: um trabalhador roda, em ordem, as etapas que existem de cada projeto.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::{self, Sender};
use std::thread;

use crate::projeto::{ModoDeImportacao, Origem, ProjetoJson};
use crate::sessao::{self, EventoDaSessao, Roteirista};
use crate::transcricao::{Pedido, Transcritor};
use crate::{EstadoDaEtapa, Etapa, Evento, LigarArquivo, nome_do_arquivo};

pub(crate) type Emitir = Arc<dyn Fn(Evento) + Send + Sync>;

pub(crate) struct Fila {
    envio: Sender<PathBuf>,
}

impl Fila {
    pub fn new(
        emit: Emitir,
        ligar: LigarArquivo,
        transcritor: Option<Transcritor>,
        roteirista: Option<Roteirista>,
    ) -> Self {
        let (envio, recebimento) = mpsc::channel::<PathBuf>();
        thread::spawn(move || {
            for pasta in recebimento {
                rodar(
                    &pasta,
                    &emit,
                    &ligar,
                    transcritor.as_ref(),
                    roteirista.as_ref(),
                );
            }
        });
        Self { envio }
    }

    /// Põe o projeto no fim da fila.
    pub fn enfileirar(&self, pasta: PathBuf) {
        // O trabalhador só sai quando a fila é largada.
        let _ = self.envio.send(pasta);
    }
}

/// Roda as etapas que existem, da primeira não concluída em diante, e para na primeira que
/// falha. As etapas sem executor continuam pendentes.
fn rodar(
    pasta: &Path,
    emit: &Emitir,
    ligar: &LigarArquivo,
    transcritor: Option<&Transcritor>,
    roteirista: Option<&Roteirista>,
) {
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
        let tem_executor = match etapa {
            Etapa::Importacao => true,
            Etapa::Transcricao => transcritor.is_some(),
            Etapa::Roteiro => roteirista.is_some(),
            _ => false,
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
        transicao(&mut projeto, EstadoDaEtapa::EmAndamento, None);
        let resultado = match (etapa, transcritor, roteirista) {
            (Etapa::Transcricao, Some(transcritor), _) => {
                transcrever(pasta, &mut projeto, transcritor, &id, emit)
            }
            (Etapa::Roteiro, _, Some(roteirista)) => {
                roteirizar(pasta, &projeto, roteirista, &id, emit)
            }
            _ => importar(pasta, &mut projeto, ligar).map_err(|error| error.to_string()),
        };
        match resultado {
            Ok(()) => transicao(&mut projeto, EstadoDaEtapa::Concluida, None),
            Err(falha) => {
                transicao(&mut projeto, EstadoDaEtapa::Falhou, Some(falha));
                return;
            }
        }
    }
}

/// A Importação de um arquivo local: um hardlink em `bruto/` quando o arquivo está no mesmo
/// volume e, senão, só a referência a ele.
fn importar(pasta: &Path, projeto: &mut ProjetoJson, ligar: &LigarArquivo) -> io::Result<()> {
    let Origem::Arquivo {
        caminho,
        nome,
        tamanho,
        modificado_em,
        modo,
    } = &mut projeto.origem;
    let metadados = fs::metadata(&caminho)?;
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

/// A Transcrição do vídeo original: grava `edit/transcricao.json` e a transcrição compactada,
/// e o idioma detectado no projeto. Um idioma já definido no projeto (pelos padrões ou pelas
/// exceções) é respeitado. A fila ainda não cancela etapas, então nada liga o `cancelar`.
fn transcrever(
    pasta: &Path,
    projeto: &mut ProjetoJson,
    transcritor: &Transcritor,
    id: &str,
    emit: &Emitir,
) -> Result<(), String> {
    let Origem::Arquivo {
        caminho,
        nome,
        modo,
        ..
    } = &projeto.origem;
    let video = match modo {
        Some(ModoDeImportacao::Hardlink) => pasta.join("bruto").join(nome),
        _ => PathBuf::from(caminho),
    };
    let mut ultimo = None;
    let transcricao = transcritor
        .transcrever(
            &Pedido {
                video: &video,
                pasta_de_saida: &pasta.join("edit"),
                idioma: projeto.idioma_do_video.as_deref(),
                nomes_proprios: &projeto.opcoes.nomes_proprios,
            },
            &AtomicBool::new(false),
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

/// O Roteiro: a sessão do Claude escreve `edit/roteiro.json`, e o núcleo o valida no fim. A
/// fila ainda não cancela etapas, então nada liga o `cancelar`.
fn roteirizar(
    pasta: &Path,
    projeto: &ProjetoJson,
    roteirista: &Roteirista,
    id: &str,
    emit: &Emitir,
) -> Result<(), String> {
    let Origem::Arquivo { nome, .. } = &projeto.origem;
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
            &AtomicBool::new(false),
            &mut |evento| {
                emit(match evento {
                    EventoDaSessao::Acao { ferramenta, alvo } => Evento::AcaoDoClaude {
                        projeto: id.to_owned(),
                        etapa: Etapa::Roteiro,
                        ferramenta,
                        alvo,
                    },
                    EventoDaSessao::Tokens { entrada, cache } => Evento::TokensDoClaude {
                        projeto: id.to_owned(),
                        etapa: Etapa::Roteiro,
                        entrada,
                        cache,
                    },
                });
            },
        )
        .map_err(|error| error.to_string())
}
