//! A estimativa antes de gerar pela interface pública do núcleo: a faixa de custo, as sessões do
//! Claude e o tempo, com os coeficientes iniciais e depois de calibrados pelas execuções.

use std::fs;

use nucleo::{Config, ModeloDoClaude, Nucleo, Padroes};
use serde_json::{Value, json};

struct Cenario {
    tmp: tempfile::TempDir,
    nucleo: Nucleo,
}

impl Cenario {
    fn novo() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: tmp.path().join("dados"),
                pasta_de_videos: Some(tmp.path().join("Videos")),
                carregadores_do_vulkan: Some(Vec::new()),
                ..Config::default()
            },
            |_| {},
        );
        Self { tmp, nucleo }
    }

    /// Um projeto de 744 s (a faixa fixa a duração), de 2 cortes, com um roteiro e uma revisão
    /// gravados. O projeto é escrito direto na Biblioteca, sem passar pela fila.
    fn execucao(&self, nome: &str, custo_do_roteiro: f64, custo_da_revisao: f64) {
        let biblioteca = self.tmp.path().join("Videos/Shorts AI");
        let pasta = biblioteca.join(nome);
        fs::create_dir_all(pasta.join("edit")).unwrap();
        fs::create_dir_all(biblioteca.join(".lotes")).unwrap();
        let projeto = json!({
            "versao": 1, "titulo": nome, "lote": nome,
            "criadoEm": "2026-10-12T10:00:00Z",
            "origem": {"tipo": "arquivo", "caminho": "/v/x.mp4", "nome": "x.mp4", "tamanho": 1},
            "idiomaDoVideo": null,
            "opcoes": {
                "quantidadeDeReels": 2, "previa": true, "pedido": "", "revisoes": 1,
                "modelo": "padrao", "nomesProprios": [], "faixa": {"inicio": 0, "fim": 744}
            },
            "etapas": [
                {"etapa": "importacao", "estado": "concluida"},
                {"etapa": "transcricao", "estado": "concluida"},
                {"etapa": "roteiro", "estado": "concluida"},
                {"etapa": "producao", "estado": "concluida"},
                {"etapa": "revisao", "estado": "concluida"}
            ]
        });
        fs::write(pasta.join("projeto.json"), projeto.to_string()).unwrap();
        let lote = json!({
            "id": nome, "nome": nome, "criadoEm": "2026-10-12T10:00:00Z",
            "padroes": {
                "quantidadeDeReels": 2, "previa": true, "pedido": "", "revisoes": 1,
                "modelo": "padrao", "nomesProprios": [], "idiomaDoVideo": "automatico"
            },
            "projetos": [nome]
        });
        fs::write(
            biblioteca.join(".lotes").join(format!("{nome}.json")),
            lote.to_string(),
        )
        .unwrap();
        let linha = |etapa: &str, custo: f64, duracao_ms: u64| -> Value {
            json!({
                "etapa": etapa, "sessionId": "s", "inicio": "2026-10-12T10:00:00Z",
                "custoUsd": custo, "custoCalculadoUsd": custo, "tabelaData": "2026-10-07",
                "precoAConferir": false, "turnos": 3, "duracaoMs": duracao_ms, "parcial": false,
                "modelos": {"claude-opus-5-5": {
                    "entrada": 1, "saida": 1, "cacheLeitura": 1, "cacheCriacao": 1,
                    "custoUsd": custo, "custoBase": "list"
                }}
            })
        };
        let linhas = [
            linha("roteiro", custo_do_roteiro, 152_000),
            linha("revisao", custo_da_revisao, 32_000),
        ];
        fs::write(pasta.join("edit/custos.json"), json!(linhas).to_string()).unwrap();
    }
}

fn padroes(reels: u8, revisoes: u8) -> Padroes {
    Padroes {
        quantidade_de_reels: reels,
        revisoes,
        modelo: ModeloDoClaude::Opus,
        ..Padroes::default()
    }
}

#[test]
fn o_video_de_referencia_cai_na_faixa_inicial_em_torno_do_medido() {
    let cenario = Cenario::novo();

    let estimativa = cenario
        .nucleo
        .estimar(&padroes(2, 1), &[Some(744.0)])
        .unwrap();

    // O roteiro custou US$ 0,91 e a revisão US$ 0,28 nesse vídeo.
    let medido = 0.91 + 0.28;
    assert!(estimativa.lote.de_usd < medido && medido < estimativa.lote.ate_usd);
    assert!(estimativa.lote.ate_usd < medido * 3.0);
    assert_eq!(estimativa.por_video, estimativa.lote);
    assert_eq!(estimativa.sessoes, 2);
    assert!(estimativa.inicial);
    assert_eq!(estimativa.execucoes, 0);
}

#[test]
fn cada_revisao_pedida_e_uma_sessao_a_mais_por_video() {
    let cenario = Cenario::novo();
    let videos = [Some(600.0), Some(900.0), None];

    let sem = cenario.nucleo.estimar(&padroes(3, 0), &videos).unwrap();
    let com = cenario.nucleo.estimar(&padroes(3, 3), &videos).unwrap();

    assert_eq!((sem.sessoes, com.sessoes), (3, 12));
    assert!(com.lote.de_usd > sem.lote.de_usd);
    assert!(com.tempo.de_s > sem.tempo.de_s);
}

#[test]
fn mais_minutos_e_mais_cortes_custam_mais_e_o_lote_soma_os_videos() {
    let cenario = Cenario::novo();
    let custo = |reels, segundos: f64| {
        cenario
            .nucleo
            .estimar(&padroes(reels, 1), &[Some(segundos)])
            .unwrap()
            .lote
            .ate_usd
    };

    assert!(custo(2, 1200.0) > custo(2, 600.0));
    assert!(custo(6, 600.0) > custo(2, 600.0));

    let dois = cenario
        .nucleo
        .estimar(&padroes(2, 1), &[Some(600.0), Some(600.0)])
        .unwrap();
    assert!((dois.lote.ate_usd - 2.0 * custo(2, 600.0)).abs() < 1e-9);
    assert!((dois.por_video.ate_usd - custo(2, 600.0)).abs() < 1e-9);
}

#[test]
fn o_modelo_escolhido_muda_os_precos() {
    let cenario = Cenario::novo();
    let com = |modelo| {
        cenario
            .nucleo
            .estimar(
                &Padroes {
                    modelo,
                    ..padroes(2, 1)
                },
                &[Some(744.0)],
            )
            .unwrap()
    };

    let opus = com(ModeloDoClaude::Opus);
    let sonnet = com(ModeloDoClaude::Sonnet);
    let padrao = com(ModeloDoClaude::Padrao);

    assert!(sonnet.lote.ate_usd < opus.lote.ate_usd);
    assert_eq!(padrao.lote, opus.lote);
    assert!(!opus.sem_preco);
}

#[test]
fn sem_gpu_a_transcricao_alonga_o_tempo() {
    // `carregadores_do_vulkan` vazio: sem o carregador, a máquina só tem a CPU.
    let sem_gpu = Cenario::novo();
    let com_gpu = {
        let tmp = tempfile::tempdir().unwrap();
        let carregador = tmp.path().join("libvulkan.so.1");
        fs::write(&carregador, b"").unwrap();
        let fake_whisper = tmp
            .path()
            .join(format!("whisper-cli{}", std::env::consts::EXE_SUFFIX));
        fs::write(&fake_whisper, b"").unwrap();
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: tmp.path().join("dados"),
                sidecar_dir: Some(tmp.path().to_path_buf()),
                carregadores_do_vulkan: Some(vec![carregador]),
                ..Config::default()
            },
            |_| {},
        );
        (tmp, nucleo)
    };

    let cpu = sem_gpu
        .nucleo
        .estimar(&padroes(2, 1), &[Some(744.0)])
        .unwrap();
    let gpu = com_gpu.1.estimar(&padroes(2, 1), &[Some(744.0)]).unwrap();

    assert!(cpu.tempo.de_s > gpu.tempo.de_s + 30.0 * 60.0);
}

#[test]
fn com_tres_execucoes_a_faixa_vai_da_mediana_ao_percentil_90() {
    let cenario = Cenario::novo();
    let inicial = cenario
        .nucleo
        .estimar(&padroes(2, 1), &[Some(744.0)])
        .unwrap();
    let previsto = inicial.lote.de_usd / 0.7;
    // Três execuções que custaram 1,0×, 2,0× e 3,0× o previsto; o pedido de 2 cortes e 1
    // revisão é o das execuções (a revisão gravada é uma só).
    for (nome, razao) in [("a.mp4", 1.0), ("b.mp4", 2.0), ("c.mp4", 3.0)] {
        cenario.execucao(nome, previsto * razao * 0.75, previsto * razao * 0.25);
    }

    let calibrada = cenario
        .nucleo
        .estimar(&padroes(2, 1), &[Some(744.0)])
        .unwrap();

    assert!(!calibrada.inicial);
    assert_eq!(calibrada.execucoes, 3);
    // Mediana 2,0; percentil 90 entre 2,0 e 3,0 a 80%: 2,8.
    assert!((calibrada.lote.de_usd - previsto * 2.0).abs() < previsto * 0.01);
    assert!((calibrada.lote.ate_usd - previsto * 2.8).abs() < previsto * 0.01);
}

#[test]
fn com_menos_de_tres_execucoes_continua_inicial() {
    let cenario = Cenario::novo();
    cenario.execucao("a.mp4", 0.9, 0.3);
    cenario.execucao("b.mp4", 0.9, 0.3);

    let estimativa = cenario
        .nucleo
        .estimar(&padroes(2, 1), &[Some(744.0)])
        .unwrap();

    assert!(estimativa.inicial);
    assert_eq!(estimativa.execucoes, 2);
}

#[test]
fn padroes_fora_dos_limites_nao_tem_estimativa() {
    let cenario = Cenario::novo();

    assert!(
        cenario
            .nucleo
            .estimar(&padroes(13, 1), &[Some(60.0)])
            .is_err()
    );
}
