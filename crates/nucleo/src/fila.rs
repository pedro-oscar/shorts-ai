//! A fila serial: um trabalhador roda, em ordem, as etapas que existem de cada projeto.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc::{self, Sender};
use std::thread;

use crate::projeto::{ModoDeImportacao, Origem, ProjetoJson};
use crate::{EstadoDaEtapa, Etapa, Evento, LigarArquivo, nome_do_arquivo};

pub(crate) type Emitir = Arc<dyn Fn(Evento) + Send + Sync>;

pub(crate) struct Fila {
    envio: Sender<PathBuf>,
}

impl Fila {
    pub fn new(emit: Emitir, ligar: LigarArquivo) -> Self {
        let (envio, recebimento) = mpsc::channel::<PathBuf>();
        thread::spawn(move || {
            for pasta in recebimento {
                rodar(&pasta, &emit, &ligar);
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
fn rodar(pasta: &Path, emit: &Emitir, ligar: &LigarArquivo) {
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
        if etapa != Etapa::Importacao {
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
        match importar(pasta, &mut projeto, ligar) {
            Ok(()) => transicao(&mut projeto, EstadoDaEtapa::Concluida, None),
            Err(error) => {
                transicao(&mut projeto, EstadoDaEtapa::Falhou, Some(error.to_string()));
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
