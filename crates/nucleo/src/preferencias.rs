//! As preferências da pessoa, num JSON nos dados do app (ADR 0007).

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Aceite, Erro};

const FILE_NAME: &str = "preferencias.json";

#[derive(Debug, Default, Serialize, Deserialize)]
pub(crate) struct Preferencias {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aceite: Option<Aceite>,
}

pub(crate) struct PreferencesFile {
    path: PathBuf,
}

impl PreferencesFile {
    pub fn in_dir(app_data_dir: &Path) -> Self {
        Self {
            path: app_data_dir.join(FILE_NAME),
        }
    }

    /// Sem o arquivo, como na primeira execução, valem as preferências padrão.
    pub fn read(&self) -> Result<Preferencias, Erro> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(Preferencias::default());
            }
            Err(error) => return Err(self.unreadable(error.to_string())),
        };
        serde_json::from_slice(&bytes).map_err(|error| self.unreadable(error.to_string()))
    }

    /// Grava num arquivo temporário e troca pelo definitivo: um app fechado no meio da
    /// gravação deixa o arquivo antigo inteiro, nunca um pela metade.
    pub fn write(&self, preferencias: &Preferencias) -> Result<(), Erro> {
        self.write_atomically(preferencias)
            .map_err(|error| Erro::PreferenciasNaoGravadas {
                caminho: self.caminho(),
                detalhe: error.to_string(),
            })
    }

    fn write_atomically(&self, preferencias: &Preferencias) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let temporary = self.path.with_extension("json.tmp");
        let mut file = File::create(&temporary)?;
        serde_json::to_writer_pretty(&mut file, preferencias)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        fs::rename(&temporary, &self.path)
    }

    fn unreadable(&self, detalhe: String) -> Erro {
        Erro::PreferenciasIlegiveis {
            caminho: self.caminho(),
            detalhe,
        }
    }

    fn caminho(&self) -> String {
        self.path.display().to_string()
    }
}
