//! O projeto em disco: a pasta na Biblioteca e o `projeto.json` dela (ADR 0007).

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;
use time::{Date, OffsetDateTime};

use crate::{EstadoDaEtapa, Etapa};

const FILE_NAME: &str = "projeto.json";
/// Quantos caracteres do título entram no nome da pasta.
const TITULO_MAXIMO: usize = 40;

/// A etapa e o estado dela, na ordem em que o projeto passa por elas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EtapaDoProjeto {
    pub etapa: Etapa,
    pub estado: EstadoDaEtapa,
}

/// Como a Importação trouxe o arquivo para o projeto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ModoDeImportacao {
    /// O vídeo original está no mesmo volume: o projeto tem um hardlink dele em `bruto/`.
    Hardlink,
    /// Outro volume, ou um sistema de arquivos sem hardlink (exFAT, FAT): só o caminho,
    /// com o tamanho e a data do arquivo.
    Referencia,
}

/// De onde veio o vídeo original.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "tipo",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Origem {
    Arquivo {
        caminho: String,
        nome: String,
        tamanho: u64,
        #[serde(default, with = "time::serde::rfc3339::option")]
        modificado_em: Option<OffsetDateTime>,
        /// `None` até a Importação rodar.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        modo: Option<ModoDeImportacao>,
    },
}

/// As opções efetivas do projeto: os padrões do lote, até haver exceções.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Opcoes {
    pub quantidade_de_reels: u8,
    pub previa: bool,
    pub pedido: String,
    pub revisoes: u8,
    pub modelo: String,
    pub nomes_proprios: Vec<String>,
}

impl Default for Opcoes {
    fn default() -> Self {
        Self {
            quantidade_de_reels: 6,
            previa: true,
            pedido: String::new(),
            revisoes: 1,
            modelo: "padrao".to_owned(),
            nomes_proprios: Vec::new(),
        }
    }
}

/// O conteúdo do `projeto.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjetoJson {
    pub versao: u32,
    pub titulo: String,
    pub lote: String,
    #[serde(with = "time::serde::rfc3339")]
    pub criado_em: OffsetDateTime,
    pub origem: Origem,
    /// `None` (pendente) até a Transcrição detectar o idioma.
    pub idioma_do_video: Option<String>,
    pub opcoes: Opcoes,
    pub etapas: Vec<EtapaDoProjeto>,
    /// Por que a etapa que falhou falhou.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub falha: Option<String>,
}

impl ProjetoJson {
    pub fn novo(titulo: String, lote: String, origem: Origem, agora: OffsetDateTime) -> Self {
        Self {
            versao: 1,
            titulo,
            lote,
            criado_em: agora,
            origem,
            idioma_do_video: None,
            opcoes: Opcoes::default(),
            etapas: Etapa::TODAS
                .iter()
                .map(|&etapa| EtapaDoProjeto {
                    etapa,
                    estado: EstadoDaEtapa::Pendente,
                })
                .collect(),
            falha: None,
        }
    }

    pub fn ler(pasta: &Path) -> io::Result<Self> {
        Ok(serde_json::from_slice(&fs::read(pasta.join(FILE_NAME))?)?)
    }

    pub fn gravar(&self, pasta: &Path) -> io::Result<()> {
        gravar_json(&pasta.join(FILE_NAME), self)
    }

    pub fn marcar(&mut self, etapa: Etapa, estado: EstadoDaEtapa) {
        if let Some(item) = self.etapas.iter_mut().find(|item| item.etapa == etapa) {
            item.estado = estado;
        }
    }
}

/// Grava num arquivo temporário e troca pelo definitivo: um app fechado no meio da gravação
/// deixa o arquivo antigo inteiro, nunca um pela metade.
pub(crate) fn gravar_json(path: &Path, valor: &impl Serialize) -> io::Result<()> {
    let temporary = path.with_extension("json.tmp");
    let mut file = File::create(&temporary)?;
    serde_json::to_writer_pretty(&mut file, valor)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    fs::rename(&temporary, path)
}

/// Cria a pasta nova do projeto, `<título até 40 caracteres> (AAAA-MM-DD)`, com ` (2)`, ` (3)`
/// e assim por diante se já existir, e dentro dela `bruto/`, `edit/` e `publicar/`.
pub(crate) fn criar_pasta(biblioteca: &Path, titulo: &str, data: Date) -> io::Result<PathBuf> {
    fs::create_dir_all(biblioteca)?;
    let base = format!(
        "{} ({:04}-{:02}-{:02})",
        titulo_para_pasta(titulo),
        data.year(),
        u8::from(data.month()),
        data.day()
    );
    for numero in 1u32.. {
        let nome = if numero == 1 {
            base.clone()
        } else {
            format!("{base} ({numero})")
        };
        let pasta = biblioteca.join(nome);
        match fs::create_dir(&pasta) {
            Ok(()) => {
                for subpasta in ["bruto", "edit", "publicar"] {
                    fs::create_dir(pasta.join(subpasta))?;
                }
                return Ok(pasta);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    unreachable!("o laço só termina com return")
}

/// O título sem o que o Windows não aceita em nome de pasta, cortado em 40 caracteres.
fn titulo_para_pasta(titulo: &str) -> String {
    let limpo: String = titulo
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c))
        .take(TITULO_MAXIMO)
        .collect();
    let limpo = limpo.trim_matches(|c: char| c.is_whitespace() || c == '.');
    if limpo.is_empty() {
        "Vídeo".to_owned()
    } else {
        limpo.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn projeto() -> ProjetoJson {
        ProjetoJson::novo(
            "Aula".to_owned(),
            "lote".to_owned(),
            Origem::Arquivo {
                caminho: "/v/aula.mp4".to_owned(),
                nome: "aula.mp4".to_owned(),
                tamanho: 10,
                modificado_em: None,
                modo: None,
            },
            OffsetDateTime::UNIX_EPOCH,
        )
    }

    #[test]
    fn gravacao_interrompida_deixa_o_projeto_json_antigo_inteiro() {
        let pasta = tempfile::tempdir().unwrap();
        let antigo = projeto();
        antigo.gravar(pasta.path()).unwrap();

        // Interrompida depois de escrever metade do temporário, antes de trocar.
        fs::write(
            pasta.path().join("projeto.json.tmp"),
            "{\"versao\": 1, \"tit",
        )
        .unwrap();
        assert_eq!(ProjetoJson::ler(pasta.path()).unwrap(), antigo);

        // A gravação seguinte passa por cima do resto da interrompida.
        let mut novo = antigo;
        novo.marcar(Etapa::Importacao, EstadoDaEtapa::Concluida);
        novo.gravar(pasta.path()).unwrap();
        assert_eq!(ProjetoJson::ler(pasta.path()).unwrap(), novo);
    }

    #[test]
    fn gravacao_que_falha_no_meio_nao_toca_no_projeto_json() {
        let pasta = tempfile::tempdir().unwrap();
        let antigo = projeto();
        antigo.gravar(pasta.path()).unwrap();

        // Com o temporário impedido, a gravação falha antes da troca.
        fs::create_dir(pasta.path().join("projeto.json.tmp")).unwrap();
        let mut novo = antigo.clone();
        novo.marcar(Etapa::Importacao, EstadoDaEtapa::Falhou);
        assert!(novo.gravar(pasta.path()).is_err());

        assert_eq!(ProjetoJson::ler(pasta.path()).unwrap(), antigo);
    }

    #[test]
    fn titulo_da_pasta_sem_caracteres_proibidos_e_ate_40_caracteres() {
        assert_eq!(titulo_para_pasta("a/b:c?"), "abc");
        assert_eq!(titulo_para_pasta(&"é".repeat(60)), "é".repeat(40));
        assert_eq!(titulo_para_pasta("  .. "), "Vídeo");
    }
}
