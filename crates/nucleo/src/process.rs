//! Processos externos (ffmpeg, whisper-cli, claude): rodam até o fim, entregam cada linha de saída
//! enquanto correm e morrem se a tarefa for cancelada.

use std::io::{self, BufRead, BufReader, Write};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// De quanto em quanto tempo se olha se o processo terminou ou se foi cancelado.
const POLL_INTERVAL: Duration = Duration::from_millis(20);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Stream {
    Stdout,
    Stderr,
}

pub(crate) struct Output {
    pub status: ExitStatus,
    pub stdout: Vec<String>,
    pub stderr: String,
}

impl Output {
    /// A última linha do stderr, que diz por que o programa falhou.
    pub fn last_stderr_line(&self) -> &str {
        self.stderr.trim().lines().last().unwrap_or_default()
    }
}

pub(crate) enum Interrupted {
    Cancelled,
    Io(io::Error),
}

impl From<io::Error> for Interrupted {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// Sem a janela de console que o Windows abre para cada programa de console chamado por um app
/// de janela.
pub(crate) fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// Roda o comando até o fim, passando cada linha de saída a `on_line`, e o mata se `cancel`
/// ligar.
pub(crate) fn run(
    command: Command,
    cancel: &AtomicBool,
    on_line: &mut dyn FnMut(Stream, &str),
) -> Result<Output, Interrupted> {
    run_with_input(command, None, cancel, on_line)
}

/// Como [`run`], entregando `input` ao processo pela entrada padrão.
pub(crate) fn run_with_input(
    mut command: Command,
    input: Option<&str>,
    cancel: &AtomicBool,
    on_line: &mut dyn FnMut(Stream, &str),
) -> Result<Output, Interrupted> {
    hide_console(&mut command);
    let mut child = command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
        // Numa thread: um prompt maior que o pipe não pode travar a leitura da saída. Se o
        // processo morrer antes de ler, a escrita falha e não há mais a quem entregar.
        let input = input.to_owned();
        thread::spawn(move || {
            let _ = stdin.write_all(input.as_bytes());
        });
    }
    let stdout = child.stdout.take().expect("stdout em pipe");
    let stderr = child.stderr.take().expect("stderr em pipe");
    let (sender, receiver) = mpsc::channel();
    let readers = [
        spawn_reader(stdout, Stream::Stdout, sender.clone()),
        spawn_reader(stderr, Stream::Stderr, sender),
    ];
    let mut stdout = Vec::new();
    let mut stderr = String::new();
    let mut receive = |stdout: &mut Vec<String>, stderr: &mut String| {
        while let Ok((stream, line)) = receiver.try_recv() {
            on_line(stream, &line);
            match stream {
                Stream::Stdout => stdout.push(line),
                Stream::Stderr => {
                    stderr.push_str(&line);
                    stderr.push('\n');
                }
            }
        }
    };
    let status = loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            for reader in readers {
                let _ = reader.join();
            }
            return Err(Interrupted::Cancelled);
        }
        receive(&mut stdout, &mut stderr);
        if let Some(status) = child.try_wait()? {
            break status;
        }
        thread::sleep(POLL_INTERVAL);
    };
    for reader in readers {
        let _ = reader.join();
    }
    receive(&mut stdout, &mut stderr);
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn spawn_reader(
    source: impl io::Read + Send + 'static,
    stream: Stream,
    sender: mpsc::Sender<(Stream, String)>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(source).lines().map_while(Result::ok) {
            if sender.send((stream, line)).is_err() {
                break;
            }
        }
    })
}
