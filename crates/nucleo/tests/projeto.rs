//! O projeto a partir de um arquivo local, pela interface pública do núcleo: pasta na
//! Biblioteca, Importação (hardlink ou referência), `projeto.json` e a fila.

use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use nucleo::{
    Config, Erro, EstadoDaEtapa, Etapa, Evento, IdiomaDoVideo, LigarArquivo, ModeloDoClaude,
    Nucleo, Padroes, ProjetoResumo,
};
use time::OffsetDateTime;

struct Cenario {
    // Ficam vivos até o fim do teste.
    _tmp: tempfile::TempDir,
    videos: PathBuf,
    entrada: PathBuf,
    nucleo: Nucleo,
    eventos: Receiver<Evento>,
}

impl Cenario {
    fn novo() -> Self {
        Self::com(None)
    }

    fn com(ligar: Option<LigarArquivo>) -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let videos = tmp.path().join("Videos");
        let entrada = tmp.path().join("entrada");
        fs::create_dir_all(&entrada).unwrap();
        let (envio, eventos) = mpsc::channel();
        let envio = Mutex::new(envio);
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: tmp.path().join("dados"),
                pasta_de_videos: Some(videos.clone()),
                ligar_arquivo: ligar,
                ..Config::default()
            },
            move |evento| {
                let _ = envio.lock().unwrap().send(evento);
            },
        );
        Self {
            _tmp: tmp,
            videos,
            entrada,
            nucleo,
            eventos,
        }
    }

    fn biblioteca(&self) -> PathBuf {
        self.videos.join("Shorts AI")
    }

    fn video(&self, nome: &str) -> String {
        let path = self.entrada.join(nome);
        fs::write(&path, b"video de mentira").unwrap();
        path.display().to_string()
    }

    /// Espera a fila terminar a Importação do projeto, com sucesso ou não.
    fn esperar_importacao(&self, id: &str) -> EstadoDaEtapa {
        loop {
            let evento = self
                .eventos
                .recv_timeout(Duration::from_secs(10))
                .expect("a Importação não terminou");
            if let Evento::EtapaMudou {
                projeto,
                etapa: Etapa::Importacao,
                estado,
                ..
            } = evento
                && projeto == id
                && matches!(estado, EstadoDaEtapa::Concluida | EstadoDaEtapa::Falhou)
            {
                return estado;
            }
        }
    }

    fn projeto_json(&self, id: &str) -> serde_json::Value {
        let bytes = fs::read(self.biblioteca().join(id).join("projeto.json")).unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }
}

fn data_de_hoje() -> String {
    let hoje = OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02}",
        hoje.year(),
        u8::from(hoje.month()),
        hoje.day()
    )
}

fn um_projeto(cenario: &Cenario, nome: &str) -> ProjetoResumo {
    let mut projetos = cenario
        .nucleo
        .criar_lote(&[cenario.video(nome)], &Padroes::default())
        .unwrap();
    assert_eq!(projetos.len(), 1);
    projetos.remove(0)
}

#[test]
fn a_biblioteca_padrao_e_a_pasta_de_videos_mais_shorts_ai() {
    let cenario = Cenario::novo();

    assert_eq!(
        cenario.nucleo.estado_inicial().biblioteca,
        cenario.biblioteca().display().to_string()
    );
}

#[test]
fn no_mesmo_volume_o_video_vira_um_hardlink_em_bruto() {
    let cenario = Cenario::novo();

    let projeto = um_projeto(&cenario, "aula.mp4");

    assert_eq!(
        cenario.esperar_importacao(&projeto.id),
        EstadoDaEtapa::Concluida
    );
    let pasta = cenario.biblioteca().join(&projeto.id);
    for subpasta in ["bruto", "edit", "publicar"] {
        assert!(pasta.join(subpasta).is_dir(), "falta {subpasta}/");
    }
    assert_eq!(
        fs::read(pasta.join("bruto/aula.mp4")).unwrap(),
        b"video de mentira"
    );
    let json = cenario.projeto_json(&projeto.id);
    assert_eq!(json["origem"]["modo"], "hardlink");
}

#[test]
fn em_outro_volume_so_a_referencia_com_tamanho_e_data() {
    let outro_volume: LigarArquivo = Arc::new(|_, _| {
        Err(io::Error::new(
            io::ErrorKind::CrossesDevices,
            "cross-device link",
        ))
    });
    let cenario = Cenario::com(Some(outro_volume));

    let projeto = um_projeto(&cenario, "aula.mov");

    assert_eq!(
        cenario.esperar_importacao(&projeto.id),
        EstadoDaEtapa::Concluida
    );
    let pasta = cenario.biblioteca().join(&projeto.id);
    assert!(!pasta.join("bruto/aula.mov").exists());
    let json = cenario.projeto_json(&projeto.id);
    assert_eq!(json["origem"]["modo"], "referencia");
    assert_eq!(json["origem"]["caminho"], cenario.video("aula.mov"));
    assert_eq!(json["origem"]["tamanho"], 16);
    assert!(json["origem"]["modificadoEm"].is_string());
}

#[test]
fn o_projeto_json_traz_origem_opcoes_padrao_e_o_estado_de_cada_etapa() {
    let cenario = Cenario::novo();

    let projeto = um_projeto(&cenario, "aula.mkv");
    cenario.esperar_importacao(&projeto.id);

    let json = cenario.projeto_json(&projeto.id);
    assert_eq!(json["titulo"], "aula");
    assert_eq!(json["origem"]["tipo"], "arquivo");
    assert_eq!(json["idiomaDoVideo"], serde_json::Value::Null);
    assert_eq!(json["opcoes"]["quantidadeDeReels"], 6);
    assert_eq!(json["opcoes"]["previa"], true);
    assert_eq!(json["opcoes"]["revisoes"], 1);
    let estados: Vec<_> = json["etapas"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| {
            (
                item["etapa"].as_str().unwrap(),
                item["estado"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        estados,
        [
            ("importacao", "concluida"),
            ("transcricao", "pendente"),
            ("roteiro", "pendente"),
            ("producao", "pendente"),
            ("revisao", "pendente"),
        ]
    );
}

#[test]
fn a_pasta_leva_o_titulo_ate_40_caracteres_e_a_data() {
    let cenario = Cenario::novo();
    let longo = format!("{}.mp4", "a".repeat(60));

    let projeto = um_projeto(&cenario, &longo);

    assert_eq!(
        projeto.id,
        format!("{} ({})", "a".repeat(40), data_de_hoje())
    );
    assert!(cenario.biblioteca().join(&projeto.id).is_dir());
}

#[test]
fn nomes_repetidos_ganham_2_3_e_assim_por_diante() {
    let cenario = Cenario::novo();
    let arquivo = cenario.video("aula.mp4");

    let projetos = cenario
        .nucleo
        .criar_lote(&[arquivo.clone(), arquivo.clone()], &Padroes::default())
        .unwrap();
    let depois = cenario
        .nucleo
        .criar_lote(&[arquivo], &Padroes::default())
        .unwrap();

    let hoje = data_de_hoje();
    let ids: Vec<_> = projetos
        .iter()
        .chain(&depois)
        .map(|p| p.id.clone())
        .collect();
    assert_eq!(
        ids,
        [
            format!("aula ({hoje})"),
            format!("aula ({hoje}) (2)"),
            format!("aula ({hoje}) (3)"),
        ]
    );
}

#[test]
fn o_lote_de_um_e_registrado_com_nome_automatico() {
    let cenario = Cenario::novo();

    let projeto = um_projeto(&cenario, "aula.mp4");

    let json = cenario.projeto_json(&projeto.id);
    let lote = json["lote"].as_str().unwrap();
    let registro: serde_json::Value = serde_json::from_slice(
        &fs::read(
            cenario
                .biblioteca()
                .join(".lotes")
                .join(format!("{lote}.json")),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(registro["nome"].as_str().unwrap().starts_with("Lote "));
    assert_eq!(registro["projetos"], serde_json::json!([projeto.id]));
}

#[test]
fn a_fila_roda_os_projetos_um_de_cada_vez_em_ordem() {
    let cenario = Cenario::novo();
    let projetos = cenario
        .nucleo
        .criar_lote(
            &[cenario.video("um.mp4"), cenario.video("dois.mp4")],
            &Padroes::default(),
        )
        .unwrap();

    let mut transicoes = Vec::new();
    while transicoes.len() < 4 {
        if let Evento::EtapaMudou {
            projeto, estado, ..
        } = cenario
            .eventos
            .recv_timeout(Duration::from_secs(10))
            .unwrap()
        {
            transicoes.push((projeto, estado));
        }
    }

    assert_eq!(
        transicoes,
        [
            (projetos[0].id.clone(), EstadoDaEtapa::EmAndamento),
            (projetos[0].id.clone(), EstadoDaEtapa::Concluida),
            (projetos[1].id.clone(), EstadoDaEtapa::EmAndamento),
            (projetos[1].id.clone(), EstadoDaEtapa::Concluida),
        ]
    );
}

#[test]
fn o_projeto_criado_chega_por_evento_com_as_cinco_etapas_pendentes() {
    let cenario = Cenario::novo();

    let projeto = um_projeto(&cenario, "aula.mp4");

    let Evento::ProjetoCriado { projeto: evento } = cenario
        .eventos
        .recv_timeout(Duration::from_secs(10))
        .unwrap()
    else {
        panic!("o primeiro evento devia ser ProjetoCriado");
    };
    assert_eq!(evento, projeto);
    assert_eq!(evento.etapas.len(), 5);
    assert!(
        evento
            .etapas
            .iter()
            .all(|e| e.estado == EstadoDaEtapa::Pendente)
    );
}

#[test]
fn arquivo_que_nao_e_video_aceito_nao_cria_nada() {
    let cenario = Cenario::novo();
    let bom = cenario.video("aula.mp4");
    let ruim = cenario.video("notas.txt");

    let erro = cenario
        .nucleo
        .criar_lote(&[bom, ruim.clone()], &Padroes::default())
        .unwrap_err();

    assert_eq!(erro, Erro::ArquivoInvalido { caminho: ruim });
    assert!(!cenario.biblioteca().exists());
}

#[test]
fn os_arquivos_inspecionados_trazem_nome_e_tamanho() {
    let cenario = Cenario::novo();
    let arquivo = cenario.video("aula.mp4");

    let lista = cenario.nucleo.inspecionar_arquivos(&[arquivo]).unwrap();

    assert_eq!(lista[0].nome, "aula.mp4");
    assert!((lista[0].tamanho - 16.0).abs() < f64::EPSILON);
    assert_eq!(lista[0].duracao_em_segundos, None);
}

#[test]
fn os_padroes_do_lote_ficam_gravados_como_opcoes_efetivas_de_cada_projeto() {
    let cenario = Cenario::novo();
    let padroes = Padroes {
        quantidade_de_reels: 3,
        previa: false,
        pedido: "  só os cortes de humor  ".to_owned(),
        revisoes: 2,
        modelo: ModeloDoClaude::Sonnet,
        nomes_proprios: vec![
            "Ana Souza".to_owned(),
            "  ".to_owned(),
            "Remotion".to_owned(),
        ],
        idioma_do_video: IdiomaDoVideo::En,
    };

    let projetos = cenario
        .nucleo
        .criar_lote(
            &[cenario.video("um.mp4"), cenario.video("dois.mp4")],
            &padroes,
        )
        .unwrap();

    for projeto in &projetos {
        cenario.esperar_importacao(&projeto.id);
        let json = cenario.projeto_json(&projeto.id);
        assert_eq!(json["opcoes"]["quantidadeDeReels"], 3);
        assert_eq!(json["opcoes"]["previa"], false);
        assert_eq!(json["opcoes"]["pedido"], "só os cortes de humor");
        assert_eq!(json["opcoes"]["revisoes"], 2);
        assert_eq!(json["opcoes"]["modelo"], "sonnet");
        assert_eq!(
            json["opcoes"]["nomesProprios"],
            serde_json::json!(["Ana Souza", "Remotion"])
        );
        assert_eq!(json["idiomaDoVideo"], "en");
    }
}

#[test]
fn padroes_fora_dos_limites_nao_criam_nada() {
    let cenario = Cenario::novo();
    for padroes in [
        Padroes {
            quantidade_de_reels: 0,
            ..Padroes::default()
        },
        Padroes {
            quantidade_de_reels: 13,
            ..Padroes::default()
        },
        Padroes {
            revisoes: 4,
            ..Padroes::default()
        },
    ] {
        let erro = cenario
            .nucleo
            .criar_lote(&[cenario.video("aula.mp4")], &padroes)
            .unwrap_err();
        assert!(matches!(erro, Erro::PadroesInvalidos { .. }), "{erro:?}");
    }
    assert!(!cenario.biblioteca().join(".lotes").exists());
}
