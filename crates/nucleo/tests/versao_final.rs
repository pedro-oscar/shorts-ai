//! A versão final pela interface pública do núcleo: o pedido entra na fila como trabalho de
//! render, sem abrir sessão do Claude, e reaproveita os cortes e os rostos da prévia. Os
//! programas são falsos (scripts de shell).
#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, mpsc};
use std::time::Duration;

use nucleo::{Config, EstadoDaEtapa, Evento, Nucleo};
use serde_json::json;

const FFPROBE: &str = r#"#!/bin/sh
case "$*" in
*format=duration*) echo 2.0 ;;
*) echo '{"streams":[{"width":256,"height":128}]}' ;;
esac
"#;

const FFMPEG: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
echo "$@" >> "$dir/ffmpeg.log"
case "$*" in
*rawvideo*)
  for i in 1 2 3 4 5 6 7 8 9 10; do cat "$dir/quadro.rgb"; done
  exit 0 ;;
*signalstats*)
  echo "lavfi.signalstats.YAVG=120"
  exit 0 ;;
*print_format=json*)
  cat "$dir/loudnorm.json" >&2
  exit 0 ;;
*"-f null"*) exit 0 ;;
esac
for ultimo; do :; done
echo dados > "$ultimo"
"#;

const NODE: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
echo "$PWD: $@" >> "$dir/node.log"
[ -f "$dir/node-falha" ] && { echo 'chrome não abriu' >&2; exit 1; }
case "$2" in
pacote) mkdir -p "$3" ;;
render)
  echo "progresso 0.500"
  echo reel > "$6" ;;
esac
"#;

/// Registra a chamada: a versão final nunca deve chegar aqui.
const CLAUDE: &str = "#!/bin/sh\necho \"$@\" >> \"$(dirname \"$0\")/claude.log\"\nexit 1\n";

const LOUDNORM: &str = r#"{"input_i":"-20.0","input_tp":"-3.0","input_lra":"5.0","input_thresh":"-30.0","target_offset":"0.5"}"#;

const ID: &str = "Aula (2026-10-09)";

struct Cenario {
    tmp: tempfile::TempDir,
    projeto: PathBuf,
    nucleo: Nucleo,
    eventos: mpsc::Receiver<Evento>,
}

impl Cenario {
    fn novo() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("bin");
        fs::create_dir(&bin).unwrap();
        for (nome, conteudo) in [
            ("ffmpeg", FFMPEG),
            ("ffprobe", FFPROBE),
            ("node", NODE),
            ("claude", CLAUDE),
        ] {
            let caminho = bin.join(nome);
            fs::write(&caminho, conteudo).unwrap();
            fs::set_permissions(&caminho, fs::Permissions::from_mode(0o755)).unwrap();
        }
        fs::write(bin.join("loudnorm.json"), LOUDNORM).unwrap();
        fs::copy(
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/dados/dois-rostos-256x128.rgb"
            ),
            bin.join("quadro.rgb"),
        )
        .unwrap();
        let videos = tmp.path().join("Videos");
        let projeto = videos.join("Shorts AI").join(ID);
        fs::create_dir_all(projeto.join("edit")).unwrap();
        fs::create_dir_all(projeto.join("remotion/src")).unwrap();
        fs::create_dir_all(projeto.join("remotion/node_modules")).unwrap();
        fs::write(projeto.join("remotion/src/Root.tsx"), "root").unwrap();
        fs::write(projeto.join("remotion/package.json"), "{}").unwrap();
        let video = tmp.path().join("aula.mp4");
        fs::write(&video, b"video").unwrap();
        fs::write(
            projeto.join("projeto.json"),
            json!({
                "versao": 1,
                "titulo": "Aula",
                "lote": "2026-10-09T10-00-00",
                "criadoEm": "2026-10-09T10:00:00Z",
                "origem": {
                    "tipo": "arquivo",
                    "caminho": video.display().to_string(),
                    "nome": "aula.mp4",
                    "tamanho": 5
                },
                "idiomaDoVideo": "pt",
                "opcoes": {
                    "quantidadeDeReels": 6,
                    "previa": true,
                    "pedido": "",
                    "revisoes": 1,
                    "modelo": "padrao",
                    "nomesProprios": []
                },
                "etapas": [
                    {"etapa": "importacao", "estado": "concluida"},
                    {"etapa": "transcricao", "estado": "concluida"},
                    {"etapa": "roteiro", "estado": "concluida"},
                    {"etapa": "producao", "estado": "concluida"},
                    {"etapa": "revisao", "estado": "concluida"}
                ]
            })
            .to_string(),
        )
        .unwrap();
        let palavras: Vec<_> = (0..10)
            .map(|n| {
                let inicio = f64::from(n) * 0.5;
                json!({"text": if n % 5 == 4 { "fim." } else { "oi" }, "start": inicio, "end": inicio + 0.4, "type": "word"})
            })
            .collect();
        fs::write(
            projeto.join("edit/transcricao.json"),
            json!({"words": palavras}).to_string(),
        )
        .unwrap();
        fs::write(
            projeto.join("edit/roteiro.json"),
            json!({"versao": 1, "fonte": "aula.mp4", "cortes": [
                {"id": "c01", "status": "produzir", "titulo": "Negociar", "trechos": [[0.0, 2.4]]},
                {"id": "c02", "status": "produzir", "titulo": "Regra", "trechos": [[2.5, 4.9]]}
            ]})
            .to_string(),
        )
        .unwrap();
        let (envio, eventos) = mpsc::channel();
        let envio = Mutex::new(envio);
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: tmp.path().join("dados"),
                pasta_de_videos: Some(videos),
                path_env: Some(bin.clone().into_os_string()),
                sidecar_dir: Some(bin),
                node: Some(tmp.path().join("bin/node")),
                ..Config::default()
            },
            move |evento| {
                let _ = envio.lock().unwrap().send(evento);
            },
        );
        Self {
            tmp,
            projeto,
            nucleo,
            eventos,
        }
    }

    fn bin(&self) -> PathBuf {
        self.tmp.path().join("bin")
    }

    fn chamadas(&self, programa: &str) -> Vec<String> {
        fs::read_to_string(self.bin().join(format!("{programa}.log")))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// Espera o render terminar e devolve os estados vistos e a falha, se houve.
    fn esperar_o_fim(&self) -> (Vec<EstadoDaEtapa>, Option<String>) {
        let mut estados = Vec::new();
        loop {
            let Evento::VersaoFinalMudou { estado, falha, .. } = self
                .eventos
                .recv_timeout(Duration::from_secs(20))
                .expect("a versão final não terminou")
            else {
                continue;
            };
            estados.push(estado);
            if matches!(estado, EstadoDaEtapa::Concluida | EstadoDaEtapa::Falhou) {
                return (estados, falha);
            }
        }
    }
}

fn nomes(pasta: &Path) -> Vec<String> {
    let mut nomes: Vec<String> = fs::read_dir(pasta)
        .map(|entradas| {
            entradas
                .filter_map(Result::ok)
                .filter(|e| e.path().is_file())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    nomes.sort();
    nomes
}

#[test]
fn a_versao_final_vai_para_publicar_e_a_previa_continua_em_previas() {
    let cenario = Cenario::novo();
    let pasta_dos_reels = cenario.projeto.join("publicar");
    // Uma prévia que já existia continua onde estava.
    fs::create_dir_all(pasta_dos_reels.join("prévias")).unwrap();
    fs::write(pasta_dos_reels.join("prévias/c01 - Negociar.mp4"), "previa").unwrap();
    cenario.nucleo.gerar_versao_final(&[ID.to_owned()]).unwrap();

    let (estados, falha) = cenario.esperar_o_fim();

    assert_eq!(falha, None);
    assert_eq!(
        estados,
        [
            EstadoDaEtapa::Pendente,
            EstadoDaEtapa::EmAndamento,
            EstadoDaEtapa::Concluida
        ]
    );
    assert_eq!(
        nomes(&pasta_dos_reels),
        ["c01 - Negociar.mp4", "c02 - Regra.mp4"]
    );
    assert_eq!(
        nomes(&pasta_dos_reels.join("prévias")),
        ["c01 - Negociar.mp4"]
    );
    let dados = cenario.nucleo.dados_do_projeto(ID).unwrap();
    assert!(dados.reels.iter().all(|reel| !reel.previa));
}

#[test]
fn a_versao_final_nao_abre_sessao_do_claude_e_reaproveita_cortes_e_rostos() {
    let cenario = Cenario::novo();
    // Primeiro a prévia, que corta e segue o rosto de cada reel.
    let previa = nucleo::producao::Producao::new(
        nucleo::corte::Ffmpeg::new(cenario.bin().join("ffmpeg"), cenario.bin().join("ffprobe")),
        cenario.bin().join("node"),
    );
    previa
        .produzir(
            &nucleo::producao::Pedido {
                pasta: &cenario.projeto,
                video: &cenario.tmp.path().join("aula.mp4"),
                qualidade: nucleo::producao::Qualidade::Previa,
            },
            &std::sync::atomic::AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap();
    let cortes = cenario.chamadas("ffmpeg").len();

    cenario.nucleo.gerar_versao_final(&[ID.to_owned()]).unwrap();
    let (_, falha) = cenario.esperar_o_fim();

    assert_eq!(falha, None);
    assert_eq!(cenario.chamadas("claude"), Vec::<String>::new());
    // Só o sondar do corte (ffprobe) e o render mudam; o ffmpeg não corta nem rastreia de novo.
    assert_eq!(cenario.chamadas("ffmpeg").len(), cortes);
    let renders: Vec<_> = cenario
        .chamadas("node")
        .into_iter()
        .filter(|c| c.contains(" render "))
        .collect();
    assert_eq!(renders.len(), 4);
    assert!(renders[2].ends_with(" 1") && renders[3].ends_with(" 1"));
}

#[test]
fn a_falha_do_render_chega_no_evento() {
    let cenario = Cenario::novo();
    fs::write(cenario.bin().join("node-falha"), "").unwrap();

    cenario.nucleo.gerar_versao_final(&[ID.to_owned()]).unwrap();
    let (estados, falha) = cenario.esperar_o_fim();

    assert_eq!(estados.last(), Some(&EstadoDaEtapa::Falhou));
    assert!(falha.unwrap().contains("chrome não abriu"));
}

#[test]
fn projeto_que_nao_existe_nao_enfileira_nada() {
    let cenario = Cenario::novo();

    let erro = cenario
        .nucleo
        .gerar_versao_final(&[ID.to_owned(), "Outro (2026-10-09)".to_owned()])
        .unwrap_err();

    assert!(matches!(erro, nucleo::Erro::ProjetoNaoEncontrado { .. }));
    assert!(
        cenario
            .eventos
            .recv_timeout(Duration::from_millis(300))
            .is_err()
    );
}
