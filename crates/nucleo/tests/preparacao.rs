//! A preparação da primeira execução, pela interface pública do núcleo: o que falta, os
//! downloads de um servidor local e a falha de um pacote sem perder os outros. O `npm` e o
//! `node` são scripts de shell.
#![cfg(unix)]

use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;

use nucleo::{Config, Downloads, EstadoDaEtapa, Evento, Nucleo, Pacote};

const FAKE_NPM: &str = "#!/bin/sh\nmkdir -p node_modules\ntouch node_modules/.package-lock.json\n";
const FAKE_NODE: &str =
    "#!/bin/sh\n[ \"$2 $3\" = \"browser ensure\" ] && mkdir -p node_modules/.remotion\nexit 0\n";

/// Serve `GET <caminho>` com o conteúdo dado e responde 404 ao resto.
fn servidor(arquivos: Vec<(&'static str, Vec<u8>)>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endereco = listener.local_addr().unwrap();
    thread::spawn(move || {
        for conexao in listener.incoming() {
            let Ok(mut conexao) = conexao else { return };
            let mut pedido = [0; 2048];
            let n = conexao.read(&mut pedido).unwrap_or(0);
            let pedido = String::from_utf8_lossy(&pedido[..n]);
            let caminho = pedido.split_whitespace().nth(1).unwrap_or_default();
            let resposta = match arquivos.iter().find(|(nome, _)| *nome == caminho) {
                Some((_, corpo)) => {
                    let mut resposta = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        corpo.len()
                    )
                    .into_bytes();
                    resposta.extend_from_slice(corpo);
                    resposta
                }
                None => b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    .to_vec(),
            };
            let _ = conexao.write_all(&resposta);
        }
    });
    format!("http://{endereco}")
}

fn executavel(caminho: &Path, conteudo: &str) {
    fs::write(caminho, conteudo).unwrap();
    fs::set_permissions(caminho, fs::Permissions::from_mode(0o755)).unwrap();
}

/// Um `.tar.gz` como o do Node: uma pasta com `bin/node` e `bin/npm`.
fn arquivo_do_node(tmp: &Path) -> Vec<u8> {
    let raiz = tmp.join("empacotar/node-v1-linux-x64");
    fs::create_dir_all(raiz.join("bin")).unwrap();
    executavel(&raiz.join("bin/node"), FAKE_NODE);
    executavel(&raiz.join("bin/npm"), FAKE_NPM);
    let arquivo = tmp.join("node.tar.gz");
    let status = Command::new("tar")
        .arg("-czf")
        .arg(&arquivo)
        .arg("-C")
        .arg(tmp.join("empacotar"))
        .arg("node-v1-linux-x64")
        .status()
        .unwrap();
    assert!(status.success());
    fs::read(arquivo).unwrap()
}

struct Cenario {
    tmp: tempfile::TempDir,
    nucleo: Nucleo,
    eventos: Arc<Mutex<Vec<Evento>>>,
}

impl Cenario {
    fn novo(arquivos: Vec<(&'static str, Vec<u8>)>) -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let assets = tmp.path().join("assets/remotion");
        fs::create_dir_all(&assets).unwrap();
        for nome in ["package.json", "package-lock.json"] {
            fs::write(assets.join(nome), nome).unwrap();
        }
        let base = servidor(arquivos);
        let eventos = Arc::new(Mutex::new(Vec::new()));
        let coletor = Arc::clone(&eventos);
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: tmp.path().join("dados"),
                assets_dir: Some(tmp.path().join("assets")),
                downloads: Some(Downloads {
                    node: format!("{base}/node.tar.gz"),
                    modelo_whisper: format!("{base}/whisper.bin"),
                    modelo_vad: format!("{base}/vad.bin"),
                }),
                ..Config::default()
            },
            move |evento| coletor.lock().unwrap().push(evento),
        );
        Self {
            tmp,
            nucleo,
            eventos,
        }
    }

    fn dados(&self) -> PathBuf {
        self.tmp.path().join("dados")
    }

    fn estados(&self, pacote: Pacote) -> Vec<(EstadoDaEtapa, Option<String>)> {
        self.eventos
            .lock()
            .unwrap()
            .iter()
            .filter_map(|evento| match evento {
                Evento::PreparacaoMudou {
                    pacote: p,
                    estado,
                    falha,
                } if *p == pacote => Some((*estado, falha.clone())),
                _ => None,
            })
            .collect()
    }

    fn progresso(&self, pacote: Pacote) -> Vec<u8> {
        self.eventos
            .lock()
            .unwrap()
            .iter()
            .filter_map(|evento| match evento {
                Evento::ProgressoDaPreparacao {
                    pacote: p,
                    percentual,
                } if *p == pacote => Some(*percentual),
                _ => None,
            })
            .collect()
    }
}

fn arquivos_completos(tmp: &Path) -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("/node.tar.gz", arquivo_do_node(tmp)),
        ("/whisper.bin", vec![1; 12_000_000]),
        ("/vad.bin", vec![2; 1000]),
    ]
}

#[test]
fn sem_nada_baixado_tudo_falta_e_o_estado_traz_tamanhos_e_espaco_livre() {
    let tmp = tempfile::tempdir().unwrap();
    let cenario = Cenario::novo(arquivos_completos(tmp.path()));

    let estado = cenario.nucleo.verificar_preparacao();

    assert_eq!(
        estado
            .pacotes
            .iter()
            .map(|p| (p.pacote, p.presente))
            .collect::<Vec<_>>(),
        [
            (Pacote::NodePortatil, false),
            (Pacote::DependenciasDoRemotion, false),
            (Pacote::ModeloDeTranscricao, false)
        ]
    );
    assert!(estado.pacotes.iter().all(|p| p.tamanho_em_mb > 0));
    assert!(estado.espaco_livre_em_mb.is_some_and(|livre| livre > 0));
    assert!(!estado.completa());
}

#[test]
fn preparar_baixa_o_que_falta_com_progresso_por_pacote() {
    let tmp = tempfile::tempdir().unwrap();
    let cenario = Cenario::novo(arquivos_completos(tmp.path()));

    let estado = cenario.nucleo.preparar();

    assert!(estado.completa(), "{estado:?}");
    assert!(cenario.dados().join("node/bin/node").is_file());
    assert!(
        cenario
            .dados()
            .join("remotion/node_modules/.remotion")
            .is_dir()
    );
    assert_eq!(
        fs::read(cenario.dados().join("modelos/ggml-large-v3-q5_0.bin"))
            .unwrap()
            .len(),
        12_000_000
    );
    assert!(
        cenario
            .dados()
            .join("modelos/ggml-silero-v6.2.0.bin")
            .is_file()
    );
    for pacote in Pacote::TODOS {
        assert_eq!(
            cenario.estados(pacote),
            [
                (EstadoDaEtapa::EmAndamento, None),
                (EstadoDaEtapa::Concluida, None)
            ],
            "{pacote:?}"
        );
    }
    for pacote in [Pacote::NodePortatil, Pacote::ModeloDeTranscricao] {
        let progresso = cenario.progresso(pacote);
        assert_eq!(progresso.last(), Some(&100), "{pacote:?}");
        assert!(progresso.is_sorted(), "{pacote:?}: {progresso:?}");
    }
}

#[test]
fn o_que_ja_esta_presente_nao_e_baixado_de_novo() {
    let tmp = tempfile::tempdir().unwrap();
    let cenario = Cenario::novo(arquivos_completos(tmp.path()));
    cenario.nucleo.preparar();
    cenario.eventos.lock().unwrap().clear();

    let estado = cenario.nucleo.preparar();

    assert!(estado.completa());
    assert!(cenario.eventos.lock().unwrap().is_empty());
}

#[test]
fn a_falha_de_um_pacote_nao_perde_os_outros() {
    let tmp = tempfile::tempdir().unwrap();
    let mut arquivos = arquivos_completos(tmp.path());
    arquivos.retain(|(nome, _)| *nome != "/whisper.bin");
    let cenario = Cenario::novo(arquivos);

    let estado = cenario.nucleo.preparar();

    let faltam: Vec<_> = estado
        .pacotes
        .iter()
        .filter(|p| !p.presente)
        .map(|p| p.pacote)
        .collect();
    assert_eq!(faltam, [Pacote::ModeloDeTranscricao]);
    let estados = cenario.estados(Pacote::ModeloDeTranscricao);
    assert_eq!(estados[1].0, EstadoDaEtapa::Falhou);
    assert!(
        estados[1]
            .1
            .as_deref()
            .is_some_and(|falha| falha.contains("404")),
        "{estados:?}"
    );
    assert_eq!(
        cenario.estados(Pacote::NodePortatil).last().unwrap().0,
        EstadoDaEtapa::Concluida
    );
    assert!(
        !cenario
            .dados()
            .join("modelos/ggml-large-v3-q5_0.bin")
            .exists()
    );
}
