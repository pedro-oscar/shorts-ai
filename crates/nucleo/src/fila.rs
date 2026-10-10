//! A fila serial: um trabalhador roda, em ordem, as etapas que existem de cada projeto.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::{self, Sender};
use std::thread;

use crate::producao::{self, Producao, Qualidade};
use crate::projeto::{ModoDeImportacao, Origem, ProjetoJson};
use crate::sessao::{self, EventoDaSessao, ResultadoDaRevisao, Roteirista};
use crate::transcricao::{Pedido, Transcritor};
use crate::{EstadoDaEtapa, Etapa, Evento, LigarArquivo, nome_do_arquivo};

pub(crate) type Emitir = Arc<dyn Fn(Evento) + Send + Sync>;

/// O que o trabalhador faz com um projeto.
enum Trabalho {
    /// As etapas do projeto, da primeira não concluída em diante.
    Etapas(PathBuf),
    /// Só o render da versão final, sem sessão do Claude.
    VersaoFinal(PathBuf),
}

pub(crate) struct Fila {
    envio: Sender<Trabalho>,
}

impl Fila {
    pub fn new(
        emit: Emitir,
        ligar: LigarArquivo,
        transcritor: Option<Transcritor>,
        roteirista: Option<Roteirista>,
        producao: Option<Producao>,
    ) -> Self {
        let (envio, recebimento) = mpsc::channel::<Trabalho>();
        thread::spawn(move || {
            for trabalho in recebimento {
                match trabalho {
                    Trabalho::Etapas(pasta) => rodar(
                        &pasta,
                        &emit,
                        &ligar,
                        transcritor.as_ref(),
                        roteirista.as_ref(),
                        producao.as_ref(),
                    ),
                    Trabalho::VersaoFinal(pasta) => {
                        renderizar_versao_final(&pasta, &emit, producao.as_ref());
                    }
                }
            }
        });
        Self { envio }
    }

    /// Põe o projeto no fim da fila.
    pub fn enfileirar(&self, pasta: PathBuf) {
        // O trabalhador só sai quando a fila é largada.
        let _ = self.envio.send(Trabalho::Etapas(pasta));
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

/// Roda as etapas que existem, da primeira não concluída em diante, e para na primeira que
/// falha. As etapas sem executor continuam pendentes.
fn rodar(
    pasta: &Path,
    emit: &Emitir,
    ligar: &LigarArquivo,
    transcritor: Option<&Transcritor>,
    roteirista: Option<&Roteirista>,
    producao: Option<&Producao>,
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
        transicao(&mut projeto, EstadoDaEtapa::EmAndamento, None);
        let resultado = match (etapa, transcritor, roteirista, producao) {
            (Etapa::Transcricao, Some(transcritor), _, _) => {
                transcrever(pasta, &mut projeto, transcritor, &id, emit)
            }
            (Etapa::Roteiro, _, Some(roteirista), _) => {
                roteirizar(pasta, &projeto, roteirista, &id, emit)
            }
            (Etapa::Producao, _, _, Some(producao)) => {
                produzir(pasta, &projeto, producao, &id, emit)
            }
            (Etapa::Revisao, _, Some(roteirista), Some(producao)) => {
                revisar(pasta, &projeto, roteirista, producao, &id, emit)
            }
            (Etapa::Revisao, ..) => Ok(()),
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
    let video = video_original(pasta, projeto);
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
/// Sem mudanças, as rodadas que sobram seriam iguais e não rodam. A fila ainda não cancela
/// etapas, então nada liga o `cancelar`.
fn revisar(
    pasta: &Path,
    projeto: &ProjetoJson,
    roteirista: &Roteirista,
    producao: &Producao,
    id: &str,
    emit: &Emitir,
) -> Result<(), String> {
    if projeto.opcoes.revisoes == 0 {
        return Ok(());
    }
    let Origem::Arquivo { nome, .. } = &projeto.origem;
    let idioma = projeto
        .idioma_do_video
        .as_deref()
        .ok_or("o idioma do vídeo não foi detectado")?;
    let modelo = (projeto.opcoes.modelo != "padrao").then_some(projeto.opcoes.modelo.as_str());
    let video = video_original(pasta, projeto);
    let qualidade = if projeto.opcoes.previa {
        Qualidade::Previa
    } else {
        Qualidade::Final
    };
    let cancelar = AtomicBool::new(false);
    let pedido_da_producao = producao::Pedido {
        pasta,
        video: &video,
        qualidade,
    };
    let produzir = || {
        producao
            .produzir(&pedido_da_producao, &cancelar, &mut |_| {})
            .map_err(|error| error.to_string())
    };
    let mut reels = produzir()?;
    for _ in 0..projeto.opcoes.revisoes {
        producao
            .preparar_revisao(&pedido_da_producao, &reels, &cancelar)
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
                &cancelar,
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
/// versão final quando o projeto a pede. A fila ainda não cancela etapas, então nada liga o
/// `cancelar`.
fn produzir(
    pasta: &Path,
    projeto: &ProjetoJson,
    producao: &Producao,
    id: &str,
    emit: &Emitir,
) -> Result<(), String> {
    let qualidade = if projeto.opcoes.previa {
        Qualidade::Previa
    } else {
        Qualidade::Final
    };
    produzir_em(pasta, projeto, producao, qualidade, &mut |percentual| {
        emit(Evento::ProgressoDaEtapa {
            projeto: id.to_owned(),
            etapa: Etapa::Producao,
            percentual,
        });
    })
}

/// Produz os reels do projeto na `qualidade`; `progresso` recebe o percentual (0 a 100) cada
/// vez que ele muda.
fn produzir_em(
    pasta: &Path,
    projeto: &ProjetoJson,
    producao: &Producao,
    qualidade: Qualidade,
    progresso: &mut dyn FnMut(u8),
) -> Result<(), String> {
    let video = video_original(pasta, projeto);
    let mut ultimo = None;
    producao
        .produzir(
            &producao::Pedido {
                pasta,
                video: &video,
                qualidade,
            },
            &AtomicBool::new(false),
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

/// O vídeo original do projeto: o hardlink em `bruto/` ou o caminho de origem.
fn video_original(pasta: &Path, projeto: &ProjetoJson) -> PathBuf {
    let Origem::Arquivo {
        caminho,
        nome,
        modo,
        ..
    } = &projeto.origem;
    match modo {
        Some(ModoDeImportacao::Hardlink) => pasta.join("bruto").join(nome),
        _ => PathBuf::from(caminho),
    }
}
