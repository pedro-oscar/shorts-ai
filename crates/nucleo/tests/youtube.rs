//! O link do YouTube pela interface pública do núcleo, com um `yt-dlp` falso: a consulta, o
//! direito de uso, a Importação por download e os nomes próprios.
#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use nucleo::{
    ArquivoDoLote, Config, Erro, EstadoDaEtapa, Etapa, Evento, Excecoes, Faixa, LinkDoLote, Nucleo,
    Padroes, ProjetoResumo,
};

const URL: &str = "https://youtu.be/KGfmaHnBQx4?si=abc";
const URL_CANONICA: &str = "https://www.youtube.com/watch?v=KGfmaHnBQx4";

/// Registra os argumentos de cada chamada em `chamadas.log`, no diretório do script. Consulta
/// (`--print`) devolve o JSON do vídeo; o download escreve o arquivo do `-o` e avisa o progresso.
const YTDLP: &str = r#"#!/bin/sh
echo "$@" >> "$(dirname "$0")/chamadas.log"
[ "$1" = "-U" ] && { echo "yt-dlp está atualizado"; exit 0; }
for a in "$@"; do
  if [ "$a" = "--print" ]; then
    [ -f "$(dirname "$0")/falhar" ] && { echo "ERROR: Video unavailable" >&2; exit 1; }
    echo '{"title": "Pregação: a fé", "channel": "Canal da Ana", "duration": 3725.0}'
    exit 0
  fi
done
while [ $# -gt 0 ]; do
  [ "$1" = "-o" ] && saida="$2"
  shift
done
saida=$(echo "$saida" | sed 's/%(ext)s/mp4/')
echo "SHORTS-PROGRESSO  10.0%"
echo "SHORTS-PROGRESSO  55.5%"
echo "SHORTS-PROGRESSO 100.0%"
echo "vídeo baixado" > "$saida"
"#;

struct Cenario {
    _tmp: tempfile::TempDir,
    sidecars: PathBuf,
    videos: PathBuf,
    nucleo: Nucleo,
    eventos: Receiver<Evento>,
}

impl Cenario {
    fn novo() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let sidecars = tmp.path().join("sidecars");
        fs::create_dir_all(&sidecars).unwrap();
        let ytdlp = sidecars.join("yt-dlp");
        fs::write(&ytdlp, YTDLP).unwrap();
        fs::set_permissions(&ytdlp, fs::Permissions::from_mode(0o755)).unwrap();
        let videos = tmp.path().join("Videos");
        let (envio, eventos) = mpsc::channel();
        let envio = Mutex::new(envio);
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: tmp.path().join("dados"),
                pasta_de_videos: Some(videos.clone()),
                sidecar_dir: Some(sidecars.clone()),
                node: Some(PathBuf::from("/opt/node/bin/node")),
                ..Config::default()
            },
            move |evento| {
                let _ = envio.lock().unwrap().send(evento);
            },
        );
        Self {
            _tmp: tmp,
            sidecars,
            videos,
            nucleo,
            eventos,
        }
    }

    fn biblioteca(&self) -> PathBuf {
        self.videos.join("Shorts AI")
    }

    fn chamadas(&self) -> Vec<String> {
        fs::read_to_string(self.sidecars.join("chamadas.log"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// Espera a Importação do projeto terminar e devolve o estado dela e os percentuais vistos.
    fn esperar_importacao(&self, id: &str) -> (EstadoDaEtapa, Vec<u8>) {
        let mut percentuais = Vec::new();
        loop {
            match self
                .eventos
                .recv_timeout(Duration::from_secs(10))
                .expect("a Importação não terminou")
            {
                Evento::ProgressoDaEtapa {
                    projeto,
                    etapa: Etapa::Importacao,
                    percentual,
                } if projeto == id => percentuais.push(percentual),
                Evento::EtapaMudou {
                    projeto,
                    etapa: Etapa::Importacao,
                    estado: estado @ (EstadoDaEtapa::Concluida | EstadoDaEtapa::Falhou),
                    ..
                } if projeto == id => return (estado, percentuais),
                _ => {}
            }
        }
    }

    fn projeto_json(&self, id: &str) -> serde_json::Value {
        serde_json::from_slice(&fs::read(self.biblioteca().join(id).join("projeto.json")).unwrap())
            .unwrap()
    }
}

fn link(direito_de_uso: bool) -> LinkDoLote {
    LinkDoLote {
        url: URL.to_owned(),
        titulo: "Pregação: a fé".to_owned(),
        canal: "Canal da Ana".to_owned(),
        direito_de_uso,
        faixa: None,
        excecoes: Excecoes::default(),
    }
}

fn um_projeto(cenario: &Cenario) -> ProjetoResumo {
    let mut projetos = cenario
        .nucleo
        .criar_lote_com_links(&[], &[link(true)], &Padroes::default())
        .unwrap();
    assert_eq!(projetos.len(), 1);
    projetos.remove(0)
}

#[test]
fn consultar_mostra_titulo_canal_e_duracao_e_atualiza_o_yt_dlp_uma_vez() {
    let cenario = Cenario::novo();

    let info = cenario.nucleo.consultar_link(URL).unwrap();
    cenario.nucleo.consultar_link(URL).unwrap();

    assert_eq!(info.url, URL_CANONICA);
    assert_eq!(info.titulo, "Pregação: a fé");
    assert_eq!(info.canal, "Canal da Ana");
    assert_eq!(info.duracao_em_segundos, Some(3725.0));
    let chamadas = cenario.chamadas();
    assert_eq!(chamadas.iter().filter(|c| *c == "-U").count(), 1);
    let consulta = chamadas.iter().find(|c| c.contains("--print")).unwrap();
    assert!(consulta.contains("--no-playlist"), "{consulta}");
    assert!(consulta.contains("--encoding utf-8"), "{consulta}");
    assert!(
        consulta.contains("--js-runtimes node:/opt/node/bin/node"),
        "{consulta}"
    );
    assert!(
        consulta.ends_with(&format!("-- {URL_CANONICA}")),
        "{consulta}"
    );
}

#[test]
fn link_que_nao_e_do_youtube_recebe_erro_sem_chamar_o_yt_dlp() {
    let cenario = Cenario::novo();

    let erro = cenario
        .nucleo
        .consultar_link("https://vimeo.com/123456789")
        .unwrap_err();

    assert_eq!(
        erro,
        Erro::LinkInvalido {
            url: "https://vimeo.com/123456789".to_owned()
        }
    );
    assert!(cenario.chamadas().is_empty());
}

#[test]
fn consulta_que_o_yt_dlp_recusa_traz_o_motivo() {
    let cenario = Cenario::novo();
    fs::write(cenario.sidecars.join("falhar"), "").unwrap();

    let erro = cenario.nucleo.consultar_link(URL).unwrap_err();

    assert_eq!(
        erro,
        Erro::LinkNaoConsultado {
            url: URL_CANONICA.to_owned(),
            detalhe: "ERROR: Video unavailable".to_owned()
        }
    );
}

#[test]
fn sem_o_direito_de_uso_nada_e_criado() {
    let cenario = Cenario::novo();

    let erro = cenario
        .nucleo
        .criar_lote_com_links(&[], &[link(true), link(false)], &Padroes::default())
        .unwrap_err();

    assert_eq!(
        erro,
        Erro::DireitoDeUsoNaoConfirmado {
            url: URL_CANONICA.to_owned()
        }
    );
    assert!(!cenario.biblioteca().exists());
}

#[test]
fn link_invalido_no_lote_nao_cria_nada() {
    let cenario = Cenario::novo();
    let mut ruim = link(true);
    ruim.url = "https://example.com/watch?v=KGfmaHnBQx4".to_owned();

    let erro = cenario
        .nucleo
        .criar_lote_com_links(&[], &[ruim], &Padroes::default())
        .unwrap_err();

    assert!(matches!(erro, Erro::LinkInvalido { .. }));
    assert!(!cenario.biblioteca().exists());
}

#[test]
fn a_importacao_baixa_o_video_e_o_projeto_guarda_a_confirmacao() {
    let cenario = Cenario::novo();

    let projeto = um_projeto(&cenario);
    let (estado, percentuais) = cenario.esperar_importacao(&projeto.id);

    assert_eq!(estado, EstadoDaEtapa::Concluida);
    assert_eq!(percentuais, [10, 55, 100]);
    let pasta = cenario.biblioteca().join(&projeto.id);
    assert_eq!(
        fs::read_to_string(pasta.join("bruto/video.mp4")).unwrap(),
        "vídeo baixado\n"
    );
    let json = cenario.projeto_json(&projeto.id);
    assert_eq!(json["titulo"], "Pregação: a fé");
    assert_eq!(json["origem"]["tipo"], "youtube");
    assert_eq!(json["origem"]["url"], URL_CANONICA);
    assert_eq!(json["origem"]["canal"], "Canal da Ana");
    assert_eq!(json["origem"]["nome"], "video.mp4");
    let confirmado = json["origem"]["direitoDeUsoEm"].as_str().unwrap();
    assert!(
        confirmado.ends_with('Z') && confirmado.contains('T'),
        "{confirmado}"
    );
    let download = cenario
        .chamadas()
        .into_iter()
        .find(|c| c.contains("--merge-output-format"))
        .unwrap();
    assert!(download.contains("--no-playlist"), "{download}");
    assert!(download.contains("--encoding utf-8"), "{download}");
    assert!(download.contains("height<=1080"), "{download}");
    assert!(download.contains("ext=m4a"), "{download}");
    assert!(download.contains("merge-output-format mp4"), "{download}");
}

#[test]
fn titulo_e_canal_viram_nomes_proprios_sem_repetir_os_dos_padroes() {
    let cenario = Cenario::novo();
    let padroes = Padroes {
        nomes_proprios: vec!["Canal da Ana".to_owned(), "Zé".to_owned()],
        ..Padroes::default()
    };

    let projeto = cenario
        .nucleo
        .criar_lote_com_links(&[], &[link(true)], &padroes)
        .unwrap()
        .remove(0);

    let json = cenario.projeto_json(&projeto.id);
    assert_eq!(
        json["opcoes"]["nomesProprios"],
        serde_json::json!(["Canal da Ana", "Zé", "Pregação: a fé"])
    );
}

#[test]
fn download_que_falha_para_a_importacao_com_o_motivo_do_yt_dlp() {
    let cenario = Cenario::novo();
    let ruim = cenario.sidecars.join("yt-dlp");
    fs::write(
        &ruim,
        "#!/bin/sh\n[ \"$1\" = \"-U\" ] && exit 0\necho 'ERROR: 403' >&2\nexit 1\n",
    )
    .unwrap();

    let projeto = um_projeto(&cenario);
    let (estado, _) = cenario.esperar_importacao(&projeto.id);

    assert_eq!(estado, EstadoDaEtapa::Falhou);
    // A saída inteira fica em bruto/, e a falha diz onde.
    let log = cenario
        .biblioteca()
        .join(&projeto.id)
        .join("bruto/yt-dlp.log");
    assert_eq!(
        cenario.projeto_json(&projeto.id)["falha"],
        format!("ERROR: 403 (saída completa em {})", log.display())
    );
    assert!(fs::read_to_string(&log).unwrap().contains("ERROR: 403"));
}

#[test]
fn lote_misto_cria_os_arquivos_e_depois_os_links() {
    let cenario = Cenario::novo();
    let arquivo = cenario.videos.join("aula.mp4");
    fs::create_dir_all(&cenario.videos).unwrap();
    fs::write(&arquivo, b"video").unwrap();

    let projetos = cenario
        .nucleo
        .criar_lote_com_links(
            &[ArquivoDoLote {
                caminho: arquivo.display().to_string(),
                faixa: None,
                excecoes: Excecoes::default(),
            }],
            &[link(true)],
            &Padroes::default(),
        )
        .unwrap();

    let titulos: Vec<_> = projetos.iter().map(|p| p.titulo.as_str()).collect();
    assert_eq!(titulos, ["aula", "Pregação: a fé"]);
}

#[test]
fn link_com_faixa_baixa_so_a_secao_e_grava_a_faixa_no_projeto() {
    let cenario = Cenario::novo();
    let faixa = Faixa {
        inicio: 600,
        fim: Some(1800),
    };
    let link = LinkDoLote {
        faixa: Some(faixa),
        ..link(true)
    };

    let projeto = cenario
        .nucleo
        .criar_lote_com_links(&[], &[link], &Padroes::default())
        .unwrap()
        .remove(0);
    cenario.esperar_importacao(&projeto.id);

    let download = cenario
        .chamadas()
        .into_iter()
        .find(|c| c.contains("--merge-output-format"))
        .unwrap();
    assert!(
        download.contains("--download-sections *600-1800 -- "),
        "{download}"
    );
    assert!(
        !download.contains("--force-keyframes-at-cuts"),
        "{download}"
    );
    let json = cenario.projeto_json(&projeto.id);
    assert_eq!(
        json["opcoes"]["faixa"],
        serde_json::json!({"inicio": 600, "fim": 1800})
    );
}

#[test]
fn faixa_sem_fim_baixa_ate_o_fim_do_video() {
    let cenario = Cenario::novo();
    let link = LinkDoLote {
        faixa: Some(Faixa {
            inicio: 90,
            fim: None,
        }),
        ..link(true)
    };

    let projeto = cenario
        .nucleo
        .criar_lote_com_links(&[], &[link], &Padroes::default())
        .unwrap()
        .remove(0);
    cenario.esperar_importacao(&projeto.id);

    assert!(
        cenario
            .chamadas()
            .iter()
            .any(|c| c.contains("--download-sections *90-inf -- "))
    );
}

#[test]
fn link_sem_faixa_baixa_o_video_inteiro() {
    let cenario = Cenario::novo();
    let projeto = um_projeto(&cenario);
    cenario.esperar_importacao(&projeto.id);

    assert!(
        !cenario
            .chamadas()
            .iter()
            .any(|c| c.contains("--download-sections"))
    );
    assert!(cenario.projeto_json(&projeto.id)["opcoes"]["faixa"].is_null());
}

#[test]
fn arquivo_local_guarda_a_faixa_sem_recortar_o_arquivo() {
    let cenario = Cenario::novo();
    let arquivo = cenario.videos.join("aula.mp4");
    fs::create_dir_all(&cenario.videos).unwrap();
    fs::write(&arquivo, b"video").unwrap();
    let faixa = Faixa {
        inicio: 30,
        fim: Some(90),
    };

    let projeto = cenario
        .nucleo
        .criar_lote_com_links(
            &[ArquivoDoLote {
                caminho: arquivo.display().to_string(),
                faixa: Some(faixa),
                excecoes: Excecoes::default(),
            }],
            &[],
            &Padroes::default(),
        )
        .unwrap()
        .remove(0);

    assert_eq!(
        cenario.projeto_json(&projeto.id)["opcoes"]["faixa"],
        serde_json::json!({"inicio": 30, "fim": 90})
    );
}

#[test]
fn faixa_com_fim_antes_do_inicio_nao_cria_nada() {
    let cenario = Cenario::novo();
    for faixa in [
        Faixa {
            inicio: 90,
            fim: Some(30),
        },
        Faixa {
            inicio: 30,
            fim: Some(30),
        },
    ] {
        let link = LinkDoLote {
            faixa: Some(faixa),
            ..link(true)
        };

        let erro = cenario
            .nucleo
            .criar_lote_com_links(&[], &[link], &Padroes::default())
            .unwrap_err();

        assert!(
            matches!(&erro, Erro::PadroesInvalidos { opcao, .. } if opcao == "faixa"),
            "{erro:?}"
        );
    }
    assert!(!cenario.biblioteca().join("Pregação: a fé").exists());
}

#[test]
fn faixa_do_video_inteiro_nao_e_gravada() {
    let cenario = Cenario::novo();
    let link = LinkDoLote {
        faixa: Some(Faixa {
            inicio: 0,
            fim: None,
        }),
        ..link(true)
    };

    let projeto = cenario
        .nucleo
        .criar_lote_com_links(&[], &[link], &Padroes::default())
        .unwrap()
        .remove(0);

    assert!(cenario.projeto_json(&projeto.id)["opcoes"]["faixa"].is_null());
}
