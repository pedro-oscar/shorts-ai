//! A conta Claude: acha o Claude Code, confere a versão e consulta o login (ADR 0002).
//!
//! Todo `claude` roda com `CLAUDE_CONFIG_DIR` numa pasta dos dados do app. O núcleo só lê
//! `claude auth status --json`; nunca abre arquivo de credencial nem o Keychain.

use std::collections::VecDeque;
use std::path::Path;
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::Erro;
use crate::claude_code::ClaudeCode;
use crate::process::{self, Interrupted};

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

/// Como a pessoa entra: pela assinatura Claude ou pela conta do Console (cobrança por uso).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ModoDeLogin {
    Assinatura,
    Console,
}

impl ModoDeLogin {
    fn flag(self) -> &'static str {
        match self {
            Self::Assinatura => "--claudeai",
            Self::Console => "--console",
        }
    }
}

/// As últimas linhas de saída de um comando, para o detalhe de um erro.
const DETAIL_LINES: usize = 20;

pub(crate) struct Conta {
    claude: ClaudeCode,
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
    pub fn new(claude: ClaudeCode) -> Self {
        Self { claude }
    }

    pub fn estado(&self) -> EstadoDaConta {
        let Some(exe) = self.claude.locate() else {
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

    /// Roda `claude auth login` como processo filho, ou num terminal do sistema quando o
    /// navegador mostra um código para colar, e acompanha o status até o login concluir. O
    /// navegador é aberto pelo próprio Claude Code.
    pub fn entrar(&self, modo: ModoDeLogin, por_terminal: bool) -> Result<EstadoDaConta, Erro> {
        let estado = self.estado();
        let EstadoDaConta::SemLogin { .. } = estado else {
            return Ok(estado);
        };
        let exe = self
            .claude
            .locate()
            .ok_or_else(|| not_concluded("claude sumiu"))?;
        let mut child = if por_terminal {
            self.terminal(&exe, modo)?
        } else {
            self.claude
                .command(&exe)
                .args(["auth", "login", modo.flag()])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| not_concluded(error.to_string()))?
        };
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
            // Um terminal que sai sem erro pode ter só passado o login a outro processo.
            if let Some(status) = exited.filter(|status| !por_terminal || !status.success()) {
                break Err(not_concluded(format!("o login terminou com {status}")));
            }
            if started.elapsed() > LOGIN_TIMEOUT {
                break Err(not_concluded("o login demorou demais"));
            }
            std::thread::sleep(LOGIN_POLL_INTERVAL);
        };
        if !por_terminal || outcome.is_err() {
            stop(&mut child);
        }
        outcome
    }

    /// Roda o instalador oficial do sistema, repassando a saída, e detecta o Claude Code de
    /// novo ao terminar.
    pub fn instalar(&self, on_line: &(dyn Fn(String) + Sync)) -> Result<EstadoDaConta, Erro> {
        let mut command = installer();
        if let Some(path) = &self.claude.path_env {
            command.env("PATH", path);
        }
        run_streaming(command, on_line).map_err(|detalhe| Erro::InstalacaoFalhou { detalhe })?;
        Ok(self.estado())
    }

    /// Roda `claude update`, repassando a saída, e confere a versão de novo ao terminar.
    pub fn atualizar(&self, on_line: &(dyn Fn(String) + Sync)) -> Result<EstadoDaConta, Erro> {
        let falha = |detalhe: String| Erro::AtualizacaoFalhou { detalhe };
        let exe = self
            .claude
            .locate()
            .ok_or_else(|| falha("claude não encontrado".to_owned()))?;
        std::fs::create_dir_all(&self.claude.config_dir).map_err(|e| falha(e.to_string()))?;
        let mut command = self.claude.command(&exe);
        command.arg("update");
        run_streaming(command, on_line).map_err(falha)?;
        Ok(self.estado())
    }

    /// `claude -p "Responda só: OK"`: confirma que o Claude responde depois do login.
    pub fn testar(&self) -> Result<(), Erro> {
        let failure = |detalhe: String| Erro::ClaudeNaoRespondeu { detalhe };
        let exe = self
            .claude
            .locate()
            .ok_or_else(|| failure("claude não encontrado".to_owned()))?;
        let output = self
            .claude
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

    /// Abre o terminal do sistema já com o `CLAUDE_CONFIG_DIR` do app e o login. O app não
    /// hospeda terminal nem repassa código: a pessoa cola o código ali.
    fn terminal(&self, exe: &Path, modo: ModoDeLogin) -> Result<Child, Erro> {
        std::fs::create_dir_all(&self.claude.config_dir)
            .map_err(|e| not_concluded(e.to_string()))?;
        let mut command = self
            .terminal_command(exe, modo)
            .ok_or_else(|| not_concluded("nenhum terminal encontrado"))?;
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| not_concluded(error.to_string()))
    }

    #[cfg(windows)]
    fn terminal_command(&self, exe: &Path, modo: ModoDeLogin) -> Option<Command> {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("cmd");
        command.args(["/c", "start", "Claude Code", "cmd", "/k"]);
        command.raw_arg(format!(
            "\"set \"CLAUDE_CONFIG_DIR={}\" && \"{}\" auth login {}\"",
            self.claude.config_dir.display(),
            exe.display(),
            modo.flag()
        ));
        Some(command)
    }

    /// O primeiro emulador de terminal do PATH. O `env` leva o `CLAUDE_CONFIG_DIR` até o
    /// comando mesmo quando o terminal é um servidor que não herda o ambiente.
    #[cfg(not(windows))]
    fn terminal_command(&self, exe: &Path, modo: ModoDeLogin) -> Option<Command> {
        const TERMINAIS: [(&str, &str); 6] = [
            ("x-terminal-emulator", "-e"),
            ("gnome-terminal", "--"),
            ("konsole", "-e"),
            ("xfce4-terminal", "-x"),
            ("kitty", "--"),
            ("xterm", "-e"),
        ];
        let dirs = self
            .claude
            .path_env
            .iter()
            .flat_map(std::env::split_paths)
            .collect::<Vec<_>>();
        let (program, flag) = TERMINAIS.into_iter().find_map(|(name, flag)| {
            dirs.iter()
                .map(|dir| dir.join(name))
                .find(|candidate| candidate.is_file())
                .map(|path| (path, flag))
        })?;
        let mut command = Command::new(program);
        command
            .arg(flag)
            .arg("env")
            .arg(format!(
                "CLAUDE_CONFIG_DIR={}",
                self.claude.config_dir.display()
            ))
            .arg(exe)
            .args(["auth", "login", modo.flag()]);
        Some(command)
    }

    fn output(&self, exe: &Path, args: &[&str]) -> Option<Output> {
        std::fs::create_dir_all(&self.claude.config_dir).ok()?;
        self.claude
            .command(exe)
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
}

fn not_concluded(detalhe: impl Into<String>) -> Erro {
    Erro::LoginNaoConcluido {
        detalhe: detalhe.into(),
    }
}

#[cfg(windows)]
fn installer() -> Command {
    let mut command = Command::new("powershell");
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "irm https://claude.ai/install.ps1 | iex",
    ]);
    process::hide_console(&mut command);
    command
}

/// Baixa o script antes de passá-lo ao `bash`: um `curl` que falha derruba a instalação.
#[cfg(not(windows))]
fn installer() -> Command {
    let mut command = Command::new("/bin/sh");
    command.args([
        "-c",
        r#"script=$(curl -fsSL https://claude.ai/install.sh) && printf '%s\n' "$script" | bash"#,
    ]);
    command
}

/// Roda o comando repassando cada linha de stdout e stderr. Se ele falha, o erro traz as
/// últimas linhas, na ordem em que saíram.
fn run_streaming(command: Command, on_line: &(dyn Fn(String) + Sync)) -> Result<(), String> {
    let mut tail = VecDeque::new();
    let output = process::run(command, &AtomicBool::new(false), &mut |_, line| {
        on_line(line.to_owned());
        if tail.len() == DETAIL_LINES {
            tail.pop_front();
        }
        tail.push_back(line.to_owned());
    })
    .map_err(|interrupted| match interrupted {
        Interrupted::Io(error) => error.to_string(),
        Interrupted::Cancelled => "cancelado".to_owned(),
    })?;
    if output.status.success() {
        Ok(())
    } else if tail.is_empty() {
        Err(output.status.to_string())
    } else {
        Err(Vec::from(tail).join("\n"))
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
