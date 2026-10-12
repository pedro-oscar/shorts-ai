//! As regras aprendidas: as linhas `- ...` do arquivo que o Claude escreve nos dados do app.
//! O resto do arquivo (título, seções) fica como está quando a pessoa edita ou apaga uma regra.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use specta::Type;

const ARQUIVO: &str = "aprendizados.md";

/// Uma regra do arquivo de aprendizados.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Regra {
    /// A posição entre as regras, de 0 em diante, na ordem do arquivo.
    pub indice: u32,
    /// O título da seção em que a regra está.
    pub secao: Option<String>,
    pub texto: String,
}

pub struct Aprendizados {
    arquivo: PathBuf,
    /// O arquivo que vem com a skill, de onde nasce o primeiro; só é lido.
    semente: Option<PathBuf>,
}

fn e_regra(linha: &str) -> bool {
    linha.starts_with("- ")
}

impl Aprendizados {
    pub fn new(app_data_dir: &Path, assets_dir: Option<&Path>) -> Self {
        Self {
            arquivo: app_data_dir.join("aprendizados").join(ARQUIVO),
            semente: assets_dir.map(|dir| dir.join("corte-viral").join("references").join(ARQUIVO)),
        }
    }

    fn conteudo(&self) -> io::Result<String> {
        match fs::read_to_string(&self.arquivo) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                match self.semente.as_deref().map(fs::read_to_string) {
                    Some(Ok(texto)) => Ok(texto),
                    Some(Err(error)) if error.kind() != io::ErrorKind::NotFound => Err(error),
                    _ => Ok(String::new()),
                }
            }
            outro => outro,
        }
    }

    pub fn regras(&self) -> io::Result<Vec<Regra>> {
        let mut secao = None;
        let mut regras = Vec::new();
        for linha in self.conteudo()?.lines() {
            if let Some(titulo) = linha.strip_prefix("## ") {
                secao = Some(titulo.trim().to_owned());
            } else if e_regra(linha) {
                regras.push(Regra {
                    indice: u32::try_from(regras.len()).unwrap_or(u32::MAX),
                    secao: secao.clone(),
                    texto: linha[2..].trim().to_owned(),
                });
            }
        }
        Ok(regras)
    }

    /// Troca o texto da regra `indice`, ou a tira se `texto` for `None`. Devolve `false` se
    /// não há essa regra.
    pub fn alterar(&self, indice: u32, texto: Option<&str>) -> io::Result<bool> {
        let conteudo = self.conteudo()?;
        let mut restantes = indice;
        let mut achada = false;
        let mut linhas = Vec::new();
        for linha in conteudo.lines() {
            if !e_regra(linha) {
                linhas.push(linha.to_owned());
            } else if restantes > 0 || achada {
                restantes = restantes.saturating_sub(1);
                linhas.push(linha.to_owned());
            } else {
                achada = true;
                if let Some(texto) = texto {
                    linhas.push(format!(
                        "- {}",
                        texto.split_whitespace().collect::<Vec<_>>().join(" ")
                    ));
                }
            }
        }
        if !achada {
            return Ok(false);
        }
        if let Some(pasta) = self.arquivo.parent() {
            fs::create_dir_all(pasta)?;
        }
        fs::write(&self.arquivo, linhas.join("\n") + "\n")?;
        Ok(true)
    }
}
