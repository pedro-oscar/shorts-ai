//! Processos externos (ffmpeg, whisper-cli, claude): rodam até o fim, entregam cada linha de saída
//! enquanto correm e morrem se a tarefa for cancelada.

use std::ffi::{OsStr, OsString};
use std::io::{self, BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// De quanto em quanto tempo se olha se o processo terminou ou se foi cancelado.
const POLL_INTERVAL: Duration = Duration::from_millis(20);

/// O que o AppImage exporta para o GTK que vai dentro dele (o hook do linuxdeploy-plugin-gtk e
/// o runtime), apontando para a imagem. Um programa do sistema que herda isso, como o navegador
/// que o `claude auth login` abre, carrega os módulos do GTK da imagem e não abre.
const DO_APPIMAGE: [&str; 13] = [
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "OWD",
    "GTK_DATA_PREFIX",
    "GTK_THEME",
    "GTK_EXE_PREFIX",
    "GTK_PATH",
    "GTK_IM_MODULE_FILE",
    "GDK_PIXBUF_MODULE_FILE",
    "GIO_MODULE_DIR",
    "GSETTINGS_SCHEMA_DIR",
    "GI_TYPELIB_PATH",
];

/// O comando de um programa externo, como todo processo do núcleo nasce: sem a janela de
/// console no Windows e, dentro do AppImage, sem o ambiente que o AppImage montou para si.
pub(crate) fn comando(programa: impl AsRef<OsStr>) -> Command {
    let mut comando = Command::new(programa);
    if let Some(appdir) = std::env::var_os("APPDIR") {
        sem_o_ambiente_do_appimage(
            &mut comando,
            Path::new(&appdir),
            std::env::var_os("XDG_DATA_DIRS"),
        );
    }
    hide_console(&mut comando);
    comando
}

/// O comando de um processo pesado de mídia (o render, o corte, o rosto), com prioridade abaixo
/// do normal; os filhos que ele abrir (o Chrome e o ffmpeg do Remotion) herdam a prioridade. Ele
/// roda junto com a Transcrição de outro projeto, e as fases de CPU do whisper (a carga do modelo
/// e o VAD) não podem esperar por ele com a GPU parada.
pub(crate) fn comando_em_segundo_plano(programa: impl AsRef<OsStr>) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        let mut comando = comando(programa);
        comando.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
        comando
    }
    #[cfg(not(windows))]
    {
        // O `nice` troca de programa sem trocar de processo: cancelar ainda mata o programa.
        let nice = Path::new("/usr/bin/nice");
        if nice.is_file() {
            let mut comando = comando(nice);
            comando.args(["-n", "10"]).arg(programa);
            comando
        } else {
            comando(programa)
        }
    }
}

/// Tira as variáveis do AppImage e, do `XDG_DATA_DIRS`, as pastas de dentro da imagem que ele
/// pôs na frente das do sistema.
fn sem_o_ambiente_do_appimage(comando: &mut Command, appdir: &Path, xdg: Option<OsString>) {
    for variavel in DO_APPIMAGE {
        comando.env_remove(variavel);
    }
    let Some(xdg) = xdg else { return };
    let do_sistema = std::env::split_paths(&xdg).filter(|pasta| !pasta.starts_with(appdir));
    match std::env::join_paths(do_sistema) {
        Ok(pastas) if !pastas.is_empty() => comando.env("XDG_DATA_DIRS", pastas),
        _ => comando.env_remove("XDG_DATA_DIRS"),
    };
}

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
fn hide_console(command: &mut Command) {
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
    // Lê até o fim, mesmo o que não for UTF-8 (o `yt-dlp` no Windows escreve em cp1252): parar
    // antes fecharia o pipe, e a escrita seguinte do processo falharia (`Errno 22` no Windows).
    thread::spawn(move || {
        let mut reader = BufReader::new(source);
        let mut bytes = Vec::new();
        loop {
            bytes.clear();
            match reader.read_until(b'\n', &mut bytes) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let line = String::from_utf8_lossy(&bytes);
            let line = line.trim_end_matches(['\n', '\r']).to_owned();
            if sender.send((stream, line)).is_err() {
                break;
            }
        }
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    /// O valor que o comando passa ao processo: `Some(None)` quando ele tira a variável.
    fn variavel(comando: &Command, nome: &str) -> Option<Option<OsString>> {
        comando
            .get_envs()
            .find(|(chave, _)| *chave == nome)
            .map(|(_, valor)| valor.map(OsStr::to_owned))
    }

    #[test]
    fn dentro_do_appimage_o_programa_nao_herda_o_gtk_da_imagem() {
        let mut comando = Command::new("xdg-open");
        sem_o_ambiente_do_appimage(
            &mut comando,
            Path::new("/tmp/.mount_ShortsAbc"),
            Some("/tmp/.mount_ShortsAbc//usr/share:/usr/share:/usr/local/share".into()),
        );

        for nome in [
            "GTK_PATH",
            "GIO_MODULE_DIR",
            "GDK_PIXBUF_MODULE_FILE",
            "APPDIR",
        ] {
            assert_eq!(variavel(&comando, nome), Some(None), "{nome}");
        }
        assert_eq!(
            variavel(&comando, "XDG_DATA_DIRS"),
            Some(Some("/usr/share:/usr/local/share".into()))
        );
    }

    #[test]
    fn sem_pasta_do_sistema_no_xdg_data_dirs_o_programa_usa_o_padrao() {
        let mut comando = Command::new("xdg-open");
        sem_o_ambiente_do_appimage(
            &mut comando,
            Path::new("/tmp/.mount_ShortsAbc"),
            Some("/tmp/.mount_ShortsAbc/usr/share".into()),
        );

        assert_eq!(variavel(&comando, "XDG_DATA_DIRS"), Some(None));
    }

    #[test]
    fn segue_lendo_depois_de_uma_linha_que_nao_e_utf8() {
        // O yt-dlp no Windows escreve em cp1252: um caminho com "Ç" não é UTF-8. Se a leitura
        // parasse ali, o pipe fecharia e a escrita seguinte do processo falharia.
        let mut command = Command::new("sh");
        command.args(["-c", r"printf 'antes\n\307\r\n'; sleep 0.2; echo depois"]);
        let saida = run(command, &AtomicBool::new(false), &mut |_, _| {}).unwrap_or_else(|_| {
            panic!("o sh não rodou");
        });
        assert!(saida.status.success(), "{:?}", saida.status);
        assert_eq!(saida.stdout, ["antes", "\u{FFFD}", "depois"]);
    }
}
