//! Processos externos (ffmpeg, whisper-cli, claude): rodam até o fim, entregam cada linha de saída
//! enquanto correm e morrem se a tarefa for cancelada.

use std::io::{self, BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// De quanto em quanto tempo se olha se o processo terminou ou se foi cancelado.
const INTERVALO_DE_ESPERA: Duration = Duration::from_millis(20);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Fluxo {
    Stdout,
    Stderr,
}

pub(crate) struct Saida {
    pub sucesso: bool,
    pub stdout: Vec<String>,
    pub stderr: String,
}

pub(crate) enum Interrompido {
    Cancelado,
    Io(io::Error),
}

impl From<io::Error> for Interrompido {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// Roda o comando até o fim, passando cada linha de saída a `por_linha`, e o mata se
/// `cancelar` ligar.
pub(crate) fn executar(
    comando: Command,
    cancelar: &AtomicBool,
    por_linha: &mut dyn FnMut(Fluxo, &str),
) -> Result<Saida, Interrompido> {
    executar_com_entrada(comando, None, cancelar, por_linha)
}

/// Como [`executar`], entregando `entrada` ao processo pela entrada padrão.
pub(crate) fn executar_com_entrada(
    mut comando: Command,
    entrada: Option<&str>,
    cancelar: &AtomicBool,
    por_linha: &mut dyn FnMut(Fluxo, &str),
) -> Result<Saida, Interrompido> {
    let mut filho = comando
        .stdin(if entrada.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    if let (Some(entrada), Some(mut stdin)) = (entrada, filho.stdin.take()) {
        // Numa thread: um prompt maior que o pipe não pode travar a leitura da saída. Se o
        // processo morrer antes de ler, a escrita falha e não há mais a quem entregar.
        let entrada = entrada.to_owned();
        thread::spawn(move || {
            let _ = stdin.write_all(entrada.as_bytes());
        });
    }
    let stdout = filho.stdout.take().expect("stdout em pipe");
    let stderr = filho.stderr.take().expect("stderr em pipe");
    let (envio, recebimento) = mpsc::channel();
    let leitores = [
        leitor(stdout, Fluxo::Stdout, envio.clone()),
        leitor(stderr, Fluxo::Stderr, envio),
    ];
    let mut saida = Saida {
        sucesso: false,
        stdout: Vec::new(),
        stderr: String::new(),
    };
    let mut receber = |saida: &mut Saida| {
        while let Ok((fluxo, linha)) = recebimento.try_recv() {
            por_linha(fluxo, &linha);
            match fluxo {
                Fluxo::Stdout => saida.stdout.push(linha),
                Fluxo::Stderr => {
                    saida.stderr.push_str(&linha);
                    saida.stderr.push('\n');
                }
            }
        }
    };
    let status = loop {
        if cancelar.load(Ordering::Relaxed) {
            let _ = filho.kill();
            let _ = filho.wait();
            for leitor in leitores {
                let _ = leitor.join();
            }
            return Err(Interrompido::Cancelado);
        }
        receber(&mut saida);
        if let Some(status) = filho.try_wait()? {
            break status;
        }
        thread::sleep(INTERVALO_DE_ESPERA);
    };
    for leitor in leitores {
        let _ = leitor.join();
    }
    receber(&mut saida);
    saida.sucesso = status.success();
    Ok(saida)
}

fn leitor(
    fonte: impl io::Read + Send + 'static,
    fluxo: Fluxo,
    envio: mpsc::Sender<(Fluxo, String)>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        for linha in BufReader::new(fonte).lines().map_while(Result::ok) {
            if envio.send((fluxo, linha)).is_err() {
                break;
            }
        }
    })
}
