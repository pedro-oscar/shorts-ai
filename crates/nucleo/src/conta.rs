//! A conta Claude: acha o Claude Code, confere a versão e consulta o login (ADR 0002).
//!
//! Todo `claude` roda com `CLAUDE_CONFIG_DIR` numa pasta dos dados do app. O núcleo só lê
//! `claude auth status --json`; nunca abre arquivo de credencial nem o Keychain.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::Erro;

/// A versão mínima do Claude Code que o app aceita.
pub const VERSAO_MINIMA_DO_CLAUDE_CODE: &str = "2.1.292";

const LOGIN_POLL_INTERVAL: Duration = Duration::from_millis(500);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// Em que pé está a conta Claude do app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(
    tag = "tipo",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EstadoDaConta {
    NaoInstalado,
    VersaoAntiga {
        versao: String,
        minima: String,
    },
    SemLogin {
        versao: String,
    },
    Logado {
        versao: String,
        /// O `authMethod` do Claude Code, como ele informa.
        metodo: String,
        /// O `subscriptionType` (`pro`, `max`, `team`...); `None` na conta do Console.
        plano: Option<String>,
        email: Option<String>,
        cobranca: Cobranca,
    },
}

/// Como o uso do Claude é pago: pela cota da assinatura ou pelo preço de API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Cobranca {
    Assinatura,
    /// Conta do Console e plano Enterprise contam como preço de API.
    PorUso,
}

/// Onde o núcleo procura o `claude` e onde ele guarda a configuração.
pub(crate) struct Conta {
    path_env: Option<OsString>,
    home_dir: Option<PathBuf>,
    config_dir: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthStatus {
    #[serde(default)]
    logged_in: bool,
    auth_method: Option<String>,
    subscription_type: Option<String>,
    email: Option<String>,
}

impl Conta {
    pub fn new(path_env: Option<OsString>, home_dir: Option<PathBuf>, config_dir: PathBuf) -> Self {
        Self {
            path_env,
            home_dir,
            config_dir,
        }
    }

    pub fn estado(&self) -> EstadoDaConta {
        let Some(exe) = self.locate() else {
            return EstadoDaConta::NaoInstalado;
        };
        let Some(versao) = self.version(&exe) else {
            return EstadoDaConta::NaoInstalado;
        };
        if parse_version(&versao) < parse_version(VERSAO_MINIMA_DO_CLAUDE_CODE) {
            return EstadoDaConta::VersaoAntiga {
                versao,
                minima: VERSAO_MINIMA_DO_CLAUDE_CODE.to_owned(),
            };
        }
        match self.auth_status(&exe) {
            Some(status) if status.logged_in => {
                let cobranca = match status.subscription_type.as_deref() {
                    None | Some("enterprise") => Cobranca::PorUso,
                    Some(_) => Cobranca::Assinatura,
                };
                EstadoDaConta::Logado {
                    versao,
                    metodo: status.auth_method.unwrap_or_default(),
                    plano: status.subscription_type,
                    email: status.email,
                    cobranca,
                }
            }
            _ => EstadoDaConta::SemLogin { versao },
        }
    }

    /// Roda `claude auth login --claudeai` como processo filho e acompanha o status até o
    /// login concluir. O navegador é aberto pelo próprio Claude Code.
    pub fn entrar(&self) -> Result<EstadoDaConta, Erro> {
        let estado = self.estado();
        let EstadoDaConta::SemLogin { .. } = estado else {
            return Ok(estado);
        };
        let exe = self.locate().ok_or_else(|| not_concluded("claude sumiu"))?;
        let mut child = self
            .command(&exe)
            .args(["auth", "login", "--claudeai"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| not_concluded(error.to_string()))?;
        let started = Instant::now();
        let outcome = loop {
            let exited = match child.try_wait() {
                Ok(exited) => exited,
                Err(error) => break Err(not_concluded(error.to_string())),
            };
            let estado = self.estado();
            if matches!(estado, EstadoDaConta::Logado { .. }) {
                break Ok(estado);
            }
            if let Some(status) = exited {
                break Err(not_concluded(format!("o login terminou com {status}")));
            }
            if started.elapsed() > LOGIN_TIMEOUT {
                break Err(not_concluded("o login demorou demais"));
            }
            std::thread::sleep(LOGIN_POLL_INTERVAL);
        };
        stop(&mut child);
        outcome
    }

    /// `claude -p "Responda só: OK"`: confirma que o Claude responde depois do login.
    pub fn testar(&self) -> Result<(), Erro> {
        let failure = |detalhe: String| Erro::ClaudeNaoRespondeu { detalhe };
        let exe = self
            .locate()
            .ok_or_else(|| failure("claude não encontrado".to_owned()))?;
        let output = self
            .command(&exe)
            .args(["-p", "Responda só: OK", "--output-format", "json"])
            .stdin(Stdio::null())
            .output()
            .map_err(|error| failure(error.to_string()))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let is_error = serde_json::from_str::<serde_json::Value>(&stdout)
            .ok()
            .and_then(|json| json.get("is_error").and_then(serde_json::Value::as_bool))
            .unwrap_or(false);
        if output.status.success() && !is_error && !stdout.trim().is_empty() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detalhe = [stdout.trim(), stderr.trim()]
            .into_iter()
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        Err(failure(if detalhe.is_empty() {
            output.status.to_string()
        } else {
            detalhe
        }))
    }

    fn command(&self, exe: &Path) -> Command {
        let mut command = Command::new(exe);
        command.env("CLAUDE_CONFIG_DIR", &self.config_dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // Sem a janela de console piscando a cada consulta.
            command.creation_flags(0x0800_0000);
        }
        command
    }

    fn output(&self, exe: &Path, args: &[&str]) -> Option<Output> {
        std::fs::create_dir_all(&self.config_dir).ok()?;
        self.command(exe)
            .args(args)
            .stdin(Stdio::null())
            .output()
            .ok()
    }

    fn version(&self, exe: &Path) -> Option<String> {
        let output = self.output(exe, &["--version"])?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let word = stdout.split_whitespace().next()?;
        word.starts_with(|c: char| c.is_ascii_digit())
            .then(|| word.to_owned())
    }

    /// O status sai no stdout mesmo com código de saída diferente de zero (sem login).
    fn auth_status(&self, exe: &Path) -> Option<AuthStatus> {
        let output = self.output(exe, &["auth", "status", "--json"])?;
        serde_json::from_slice(&output.stdout).ok()
    }

    /// Um app aberto pelo menu ou pelo Dock não recebe o PATH do terminal; por isso, depois
    /// do PATH, valem os locais de instalação conhecidos.
    fn locate(&self) -> Option<PathBuf> {
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
}

fn not_concluded(detalhe: impl Into<String>) -> Erro {
    Erro::LoginNaoConcluido {
        detalhe: detalhe.into(),
    }
}

fn stop(child: &mut Child) {
    // O processo pode já ter saído; matar e recolher só evita deixá-lo órfão.
    let _ = child.kill();
    let _ = child.wait();
}

fn parse_version(version: &str) -> (u64, u64, u64) {
    let mut parts = version
        .split('.')
        .map(|part| part.parse::<u64>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}
