//! As preferências da pessoa, num JSON nos dados do app (ADR 0007).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::kit::Kit;
use crate::{Aceite, Cotacao, Erro, IdiomaDaInterface, PlanoConfirmado};

const FILE_NAME: &str = "preferencias.json";

#[derive(Debug, Default, Serialize, Deserialize)]
pub(crate) struct Preferencias {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aceite: Option<Aceite>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plano: Option<PlanoConfirmado>,
    /// A cotação do R$; sem ela os valores aparecem em US$.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cotacao: Option<Cotacao>,
    /// A Biblioteca que a pessoa escolheu em Configurações; sem ela vale a padrão.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub biblioteca: Option<String>,
    /// O idioma da interface que a pessoa escolheu; sem ele vale o do sistema.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idioma: Option<IdiomaDaInterface>,
    /// Os kits de marca que a pessoa salvou, além do Padrão.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub kits: Vec<Kit>,
}

pub(crate) struct PreferencesFile {
    path: PathBuf,
    /// Para onde a leitura tirou, nesta execução, um arquivo que não era JSON válido.
    backup: Option<PathBuf>,
}

impl PreferencesFile {
    pub fn in_dir(app_data_dir: &Path) -> Self {
        Self {
            path: app_data_dir.join(FILE_NAME),
            backup: None,
        }
    }

    /// Sem o arquivo, como na primeira execução, valem as preferências padrão. Um arquivo
    /// que não é JSON válido vai para um backup na mesma pasta (ver [`Self::backup`]), e
    /// valem as padrão também; não ler o arquivo, ou não conseguir tirá-lo do caminho, é erro.
    pub fn read(&mut self) -> Result<Preferencias, Erro> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(Preferencias::default());
            }
            Err(error) => return Err(self.unreadable(error.to_string())),
        };
        serde_json::from_slice(&bytes).or_else(|json_error| {
            let backup = self.backup_path(OffsetDateTime::now_utc());
            fs::rename(&self.path, &backup)
                .map_err(|rename_error| self.unreadable(format!("{json_error}; {rename_error}")))?;
            self.backup = Some(backup);
            Ok(Preferencias::default())
        })
    }

    /// Onde ficou o arquivo que a leitura tirou do caminho. Vale até o app fechar, porque a
    /// interface pode pedir o estado inicial de novo e a leitura seguinte já não acha o
    /// arquivo.
    pub fn backup(&self) -> Option<String> {
        self.backup
            .as_ref()
            .map(|backup| backup.display().to_string())
    }

    /// `preferencias.corrompido-<AAAA-MM-DDTHH-MM-SS>.json`: sem dois-pontos, que o Windows
    /// não aceita em nome de arquivo, e com o horário para não sobrescrever um backup
    /// anterior. Em UTC, porque o `time` não lê o fuso do sistema num processo com várias
    /// threads.
    fn backup_path(&self, now: OffsetDateTime) -> PathBuf {
        let name = format!(
            "preferencias.corrompido-{:04}-{:02}-{:02}T{:02}-{:02}-{:02}.json",
            now.year(),
            u8::from(now.month()),
            now.day(),
            now.hour(),
            now.minute(),
            now.second()
        );
        self.path.with_file_name(name)
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
        crate::files::write_json(&self.path, preferencias)
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
