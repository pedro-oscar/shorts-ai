//! O executável do Claude Code: onde ele está e como chamá-lo com a pasta de configuração do
//! app (ADR 0002). A Conta e as sessões chamam o `claude` só por aqui.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::process::hide_console;

/// Onde procurar o `claude` e onde fica a configuração dele.
#[derive(Debug, Clone)]
pub struct ClaudeCode {
    /// O `PATH` em que procurar o `claude`, antes dos locais de instalação conhecidos.
    pub(crate) path_env: Option<OsString>,
    /// A pasta pessoal, base dos locais de instalação conhecidos.
    home_dir: Option<PathBuf>,
    /// O `CLAUDE_CONFIG_DIR` de todo `claude` que o app roda.
    pub(crate) config_dir: PathBuf,
}

impl ClaudeCode {
    pub fn new(path_env: Option<OsString>, home_dir: Option<PathBuf>, config_dir: PathBuf) -> Self {
        Self {
            path_env,
            home_dir,
            config_dir,
        }
    }

    /// Um app aberto pelo menu ou pelo Dock não recebe o PATH do terminal; por isso, depois
    /// do PATH, valem os locais de instalação conhecidos. A procura é a cada chamada, porque o
    /// Claude Code pode ser instalado com o app aberto.
    pub(crate) fn locate(&self) -> Option<PathBuf> {
        let from_path = self
            .path_env
            .iter()
            .flat_map(std::env::split_paths)
            .collect::<Vec<_>>();
        let known = self.home_dir.iter().flat_map(|home| {
            [
                home.join(".local").join("bin"),
                home.join(".claude").join("local"),
                home.join("AppData").join("Roaming").join("npm"),
            ]
        });
        let system = [
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/homebrew/bin"),
        ];
        from_path
            .into_iter()
            .chain(known)
            .chain(system)
            .flat_map(|dir| {
                ["claude", "claude.exe", "claude.cmd"]
                    .into_iter()
                    .map(move |name| dir.join(name))
            })
            .find(|candidate| candidate.is_file())
    }

    /// O `claude` em `exe`, com a configuração do app e sem janela de console.
    pub(crate) fn command(&self, exe: &Path) -> Command {
        let mut command = Command::new(exe);
        command.env("CLAUDE_CONFIG_DIR", &self.config_dir);
        hide_console(&mut command);
        command
    }
}
