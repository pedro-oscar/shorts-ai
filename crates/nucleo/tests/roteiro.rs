//! O roteiro: o plano de cada corte contra a saída do CLI Python (KGfmaHnBQx4) e uma
//! transcrição pequena para cada regra de erro e de aviso.

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use nucleo::roteiro::{
    Contexto, Gravidade, Problema, Transcricao, Validacao, cenas_registradas, validar,
};
use serde_json::{Value, json};

fn referencia() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.scratch/shorts-ai-mvp/referencia-kgfmahnbqx4")
}

fn json_de(caminho: &PathBuf) -> Value {
    serde_json::from_str(&fs::read_to_string(caminho).unwrap()).unwrap()
}

/// O registro do projeto de referência tinha as cenas que o roteiro usa.
fn contexto_de_referencia() -> Contexto {
    let roteiro = json_de(&referencia().join("roteiro.json"));
    let cenas = roteiro["cortes"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|c| c["motions"].as_array().into_iter().flatten())
        .filter(|m| m["type"] == "scene")
        .map(|m| m["name"].as_str().unwrap().to_string())
        .collect();
    Contexto {
        cenas,
        ..Contexto::default()
    }
}

#[test]
fn os_cortes_do_kgfmahnbqx4_batem_com_a_saida_do_cli_python() {
    let pasta = referencia();
    let transcricao =
        Transcricao::do_json(&fs::read_to_string(pasta.join("transcricao.json")).unwrap()).unwrap();
    let roteiro = fs::read_to_string(pasta.join("roteiro.json")).unwrap();

    let validacao = validar(&roteiro, Some(&transcricao), &contexto_de_referencia());

    assert!(!validacao.tem_erros(), "{validacao:#?}");
    let ids: Vec<_> = validacao.cortes.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["c01", "c02", "c03", "c04", "c05", "c06"]);
    for corte in &validacao.cortes {
        let plano = corte.plano.as_ref().unwrap();
        let cli = pasta.join("cortes").join(&corte.id);
        assert_eq!(plano.chave, format!("kgfmahnbqx4-{}", corte.id));

        let edl = json_de(&cli.join("edl.json"));
        let esperados: Vec<(f64, f64)> = edl["ranges"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| (r["start"].as_f64().unwrap(), r["end"].as_f64().unwrap()))
            .collect();
        assert_eq!(plano.trechos, esperados, "trechos de {}", corte.id);

        let legendas = serde_json::to_value(&plano.legendas).unwrap();
        assert_eq!(
            legendas,
            json_de(&cli.join("captions.json")),
            "legendas de {}",
            corte.id
        );

        let motion = serde_json::to_value(&plano.motion).unwrap();
        assert_eq!(
            motion,
            json_de(&cli.join("motion.json")),
            "motions de {}",
            corte.id
        );
    }
}

#[test]
fn o_registro_de_cenas_vem_do_index_do_remotion() {
    let remotion = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../assets/remotion");
    let cenas = cenas_registradas(&remotion);
    let esperadas: BTreeSet<String> = ["Comparacao", "Dinheiro", "Grafico"]
        .map(String::from)
        .into();
    assert_eq!(cenas, esperadas);
    assert!(cenas_registradas(&remotion.join("inexistente")).is_empty());
}

// ---------------------------------------------------------------- regras

/// "Olá mundo. Tudo bem? Sim, claro." com uma palavra a cada 0,5 s, em 0–3 s, e um respiro
/// até 30 s com uma palavra a cada segundo.
fn transcricao() -> Transcricao {
    let mut palavras = vec![];
    let frases = ["Olá", "mundo.", "Tudo", "bem?", "Sim,", "claro."];
    for (i, texto) in frases.iter().enumerate() {
        let inicio = i as f64 * 0.5;
        palavras.push(json!({"text": texto, "start": inicio, "end": inicio + 0.4, "type": "word"}));
        palavras.push(
            json!({"text": " ", "start": inicio + 0.4, "end": inicio + 0.5, "type": "spacing"}),
        );
    }
    for i in 0..27 {
        let inicio = 3.0 + f64::from(i);
        palavras.push(
            json!({"text": format!("p{i}"), "start": inicio, "end": inicio + 0.5, "type": "word"}),
        );
    }
    Transcricao::do_json(&json!({"words": palavras}).to_string()).unwrap()
}

fn roteiro_com(corte: Value) -> String {
    json!({"fonte": "bruto/Aula.mp4", "cortes": [corte]}).to_string()
}

fn validar_corte(corte: Value) -> Validacao {
    validar(
        &roteiro_com(corte),
        Some(&transcricao()),
        &Contexto::default(),
    )
}

fn problemas(validacao: &Validacao) -> Vec<&Problema> {
    validacao.cortes[0].problemas.iter().collect()
}

fn corte_longo(extra: Value) -> Value {
    let mut corte = json!({"id": "c01", "trechos": [[0.0, 30.0]]});
    corte
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    corte
}

#[test]
fn sem_transcricao_e_erro() {
    let validacao = validar(
        &roteiro_com(corte_longo(json!({}))),
        None,
        &Contexto::default(),
    );
    assert_eq!(validacao.problemas, [Problema::TranscricaoAusente]);
    assert!(validacao.tem_erros());
}

#[test]
fn json_ruim_e_versao_desconhecida_sao_erros() {
    let ruim = validar("{", Some(&transcricao()), &Contexto::default());
    assert!(matches!(ruim.problemas[0], Problema::RoteiroIlegivel(_)));
    let futuro = json!({"versao": 2, "cortes": []}).to_string();
    let futuro = validar(&futuro, Some(&transcricao()), &Contexto::default());
    assert_eq!(
        futuro.problemas,
        [Problema::VersaoNaoSuportada { versao: 2 }]
    );
}

#[test]
fn corte_sem_trechos_e_erro() {
    let validacao = validar_corte(json!({"id": "c01", "trechos": []}));
    assert_eq!(problemas(&validacao), [&Problema::CorteSemTrechos]);
    assert!(validacao.cortes[0].plano.is_none());
}

#[test]
fn trecho_fora_do_video_ou_sem_palavra_e_erro() {
    let fora = validar_corte(json!({"id": "c01", "trechos": [[10.0, 500.0]]}));
    assert!(matches!(
        problemas(&fora)[..],
        [Problema::TrechoForaDoVideo { .. }]
    ));
    let vazio = validar_corte(json!({"id": "c01", "trechos": [[0.42, 0.48]]}));
    assert_eq!(
        problemas(&vazio),
        [&Problema::TrechoSemPalavra {
            inicio: 0.42,
            fim: 0.48
        }]
    );
}

#[test]
fn duracao_acima_de_90_segundos_e_meio_e_erro() {
    let mut palavras = vec![];
    for i in 0..200 {
        let inicio = f64::from(i);
        palavras.push(
            json!({"text": format!("p{i}."), "start": inicio, "end": inicio + 0.5, "type": "word"}),
        );
    }
    let transcricao = Transcricao::do_json(&json!({"words": palavras}).to_string()).unwrap();
    let roteiro = roteiro_com(json!({"id": "c01", "trechos": [[0.0, 91.0]]}));
    let validacao = validar(&roteiro, Some(&transcricao), &Contexto::default());
    assert!(matches!(
        problemas(&validacao)[..],
        [Problema::DuracaoAcimaDoMaximo { .. }]
    ));
}

#[test]
fn encaixe_usa_40_por_cento_e_as_folgas_da_spec() {
    // "mundo." vai de 0,5 a 0,9; o trecho pega 0,2 s dela (50%) e só 0,1 s de "Olá" (25%).
    let validacao = validar_corte(corte_longo(json!({"trechos": [[0.3, 0.7], [1.0, 1.3]]})));
    let plano = validacao.cortes[0].plano.as_ref().unwrap();
    // 1º trecho: só "mundo."; o início recuaria até 0,38, mas "Olá" termina em 0,4; o fim
    // avançaria 0,18, mas "Tudo" começa em 1,0. 2º (último): "Tudo" 1,0–1,4 recua até 0,9
    // (onde "mundo." termina) e avança até 0,06 antes de "bem?", que começa em 1,5.
    assert_eq!(plano.trechos, [(0.4, 1.0), (0.9, 1.44)]);
}

#[test]
fn o_inicio_recua_ate_012_sem_invadir_a_palavra_anterior() {
    let validacao = validar_corte(corte_longo(json!({"trechos": [[5.0, 7.0], [10.0, 12.0]]})));
    let plano = validacao.cortes[0].plano.as_ref().unwrap();
    // p2 começa em 5,0 e a anterior termina em 4,5: recua 0,12.
    assert_eq!(plano.trechos[0].0, 4.88);
}

#[test]
fn o_ultimo_trecho_avanca_075_e_para_006_antes_da_proxima() {
    let validacao = validar_corte(corte_longo(json!({"trechos": [[10.0, 11.0]]})));
    let plano = validacao.cortes[0].plano.as_ref().unwrap();
    // última palavra: p7 (10,0–10,5)... a seguinte começa em 11,0: min(10,94; 11,25) = 10,94.
    assert_eq!(plano.trechos, [(9.88, 10.94)]);
}

#[test]
fn ultimo_trecho_sem_pontuacao_e_corte_curto_sao_avisos() {
    let validacao = validar_corte(json!({"id": "c01", "trechos": [[10.0, 11.0]]}));
    let avisos = problemas(&validacao);
    assert!(avisos.contains(&&Problema::UltimoTrechoSemPontuacao {
        palavra: "p7".into()
    }));
    assert!(
        avisos
            .iter()
            .any(|p| matches!(p, Problema::CorteCurto { .. }))
    );
    assert!(avisos.iter().all(|p| p.gravidade() == Gravidade::Aviso));
    assert!(!validacao.tem_erros());
}

#[test]
fn encaixe_que_move_a_borda_mais_de_06_s_e_aviso() {
    let palavras = json!([
        {"text": "longa", "start": 0.0, "end": 1.0},
        {"text": "fim.", "start": 10.0, "end": 11.0},
    ]);
    let transcricao = Transcricao::do_json(&json!({"words": palavras}).to_string()).unwrap();
    let roteiro = roteiro_com(json!({"id": "c01", "trechos": [[0.0, 5.0]]}));

    let validacao = validar(&roteiro, Some(&transcricao), &Contexto::default());

    assert!(
        problemas(&validacao).contains(&&Problema::EncaixeMoveuBorda {
            pedido: (0.0, 5.0),
            encaixado: (0.0, 1.75),
        }),
        "{:?}",
        problemas(&validacao)
    );
}

#[test]
fn as_correcoes_valem_na_legenda_preservando_a_pontuacao_e_as_do_corte_vencem() {
    let palavras = json!([
        {"text": "Nulo", "start": 0.0, "end": 0.5},
        {"text": " ", "start": 0.5, "end": 0.6, "type": "spacing"},
        {"text": "\"Olá,", "start": 0.6, "end": 1.0},
        {"text": "nulo.", "start": 1.0, "end": 1.5},
    ]);
    let transcricao = Transcricao::do_json(&json!({"words": palavras}).to_string()).unwrap();
    let roteiro = json!({
        "fonte": "bruto/a.mp4",
        "correcoes": {"Nulo": "no-lo", "ola": "oi"},
        "cortes": [
            {"id": "c01", "trechos": [[0.0, 1.5]]},
            {"id": "c02", "trechos": [[0.0, 1.5]], "correcoes": {"nulo": "Nulo!"}},
        ],
    })
    .to_string();

    let validacao = validar(&roteiro, Some(&transcricao), &Contexto::default());

    let textos = |i: usize| -> Vec<String> {
        let plano = validacao.cortes[i].plano.as_ref().unwrap();
        plano.legendas.iter().map(|l| l.text.clone()).collect()
    };
    assert_eq!(textos(0), ["no-lo", " \"oi,", " no-lo."]);
    assert_eq!(textos(1), ["Nulo!", " \"oi,", " Nulo!."]);
}

fn com_cena() -> Contexto {
    Contexto {
        cenas: BTreeSet::from(["Grafico".to_string()]),
        ..Contexto::default()
    }
}

fn validar_motions(motions: Value) -> Validacao {
    let corte = json!({"id": "c01", "trechos": [[10.0, 20.0]], "motions": motions});
    validar(&roteiro_com(corte), Some(&transcricao()), &com_cena())
}

fn erros(validacao: &Validacao) -> Vec<&Problema> {
    problemas(validacao)
        .into_iter()
        .filter(|p| p.gravidade() == Gravidade::Erro)
        .collect()
}

#[test]
fn motions_usam_at_word_duracoes_padrao_e_o_fim_limitado() {
    let corte = json!({
        "id": "c01", "trechos": [[10.0, 20.0]], "titulo": "Título", "enfase": ["p12"],
        "estilo": {"accent": "#111"},
        "motions": [
            {"type": "keyword", "text": "K", "at": 12.0},
            {"type": "zoom", "word": "p12", "at": 15.0, "scale": 1.2},
            {"type": "shake", "at": 12.5, "dur": 1.0},
            {"type": "flash", "at": 13.0},
            {"type": "scene", "name": "Grafico", "at": 18.0},
            {"type": "counter", "at": "0:19", "to": 3},
        ],
    });
    let roteiro = json!({"estilo": {"accent": "#FFF", "grain": 1}, "cortes": [corte]});

    let validacao = validar(&roteiro.to_string(), Some(&transcricao()), &com_cena());

    assert!(!validacao.tem_erros(), "{:?}", problemas(&validacao));
    let plano = validacao.cortes[0].plano.as_ref().unwrap();
    // O corte vai de 9,88 a 19,94 do original: 10,06 s.
    assert_eq!(plano.trechos, [(9.88, 19.94)]);
    let motion = serde_json::to_value(&plano.motion).unwrap();
    assert_eq!(
        motion,
        json!({
            "style": {"accent": "#111", "grain": 1},
            "emphasis": ["p12"],
            "motions": [
                {"type": "title", "start": 0.1, "end": 2.8, "text": "Título"},
                {"type": "keyword", "text": "K", "start": 2.12, "end": 3.72},
                {"type": "zoom", "scale": 1.2, "start": 5.02, "end": 6.42},
                {"type": "shake", "start": 2.62, "end": 3.62},
                {"type": "flash", "at": 3.12},
                {"type": "scene", "name": "Grafico", "start": 8.12, "end": 9.46},
                {"type": "counter", "to": 3, "start": 9.12, "end": 9.46},
            ],
        })
    );
}

#[test]
fn motion_com_tipo_invalido_sem_at_nem_word_ou_curto_e_erro() {
    let validacao = validar_motions(json!([
        {"type": "confete", "at": 12.0},
        {"type": "zoom"},
        {"type": "zoom", "at": 19.5},
    ]));
    assert_eq!(
        erros(&validacao),
        [
            &Problema::TipoDeMotionInvalido {
                numero: 1,
                tipo: "confete".into()
            },
            &Problema::MotionSemAtNemWord {
                numero: 2,
                tipo: "zoom".into()
            },
            &Problema::MotionCurto {
                numero: 3,
                tipo: "zoom".into()
            },
        ]
    );
    assert!(validacao.cortes[0].plano.is_none());
}

#[test]
fn motion_de_titulo_sem_at_nem_word_comeca_em_01() {
    let validacao = validar_motions(json!([{"type": "title", "text": "T"}]));
    let plano = validacao.cortes[0].plano.as_ref().unwrap();
    assert_eq!(plano.motion.motions[0]["start"], json!(0.1));
}

#[test]
fn at_fora_dos_trechos_e_word_nao_encontrada_sao_erros() {
    let validacao = validar_motions(json!([
        {"type": "zoom", "at": 25.0},
        {"type": "zoom", "at": 12.0, "ate": 28.0},
        {"type": "keyword", "word": "inexistente", "at": 12.0},
    ]));
    assert_eq!(
        erros(&validacao),
        [
            &Problema::AtForaDosTrechos {
                numero: 1,
                instante: 25.0
            },
            &Problema::AtForaDosTrechos {
                numero: 2,
                instante: 28.0
            },
            &Problema::PalavraNaoEncontrada {
                numero: 3,
                palavra: "inexistente".into()
            },
        ]
    );
}

#[test]
fn cena_nao_registrada_e_erro() {
    let validacao = validar_motions(json!([{"type": "scene", "name": "Fantasma", "at": 12.0}]));
    assert_eq!(
        erros(&validacao),
        [&Problema::CenaNaoRegistrada {
            nome: "Fantasma".into()
        }]
    );
}

#[test]
fn word_a_mais_de_4_s_do_at_e_motions_sobrepostas_sao_avisos() {
    let validacao = validar_motions(json!([
        {"type": "keyword", "word": "p12", "at": 11.0, "text": "A"},
        {"type": "counter", "at": 16.0, "to": 1},
        {"type": "keyword", "at": 16.5, "text": "B"},
    ]));
    assert!(!validacao.tem_erros());
    let avisos = problemas(&validacao);
    assert!(avisos.iter().any(|p| matches!(
        p,
        Problema::PalavraLongeDoAt { palavra, .. } if palavra == "p12"
    )));
    assert!(avisos.contains(&&Problema::MotionsSobrepostas {
        a: ("counter".into(), 6.12),
        b: ("keyword".into(), 6.62),
    }));
}

#[test]
fn cenas_de_tela_cheia_acima_de_60_por_cento_sao_aviso() {
    let validacao = validar_motions(json!([
        {"type": "scene", "name": "Grafico", "at": 10.5, "dur": 7.0, "layout": "full"},
    ]));
    assert!(problemas(&validacao).contains(&&Problema::CenasCobremDemais));
    let card = validar_motions(json!([
        {"type": "scene", "name": "Grafico", "at": 10.5, "dur": 7.0, "layout": "card"},
    ]));
    assert!(!problemas(&card).contains(&&Problema::CenasCobremDemais));
}

#[test]
fn fonte_fora_do_catalogo_e_logo_inexistente_sao_erros() {
    let pasta = tempfile::tempdir().unwrap();
    fs::write(pasta.path().join("logo.png"), b"png").unwrap();
    let contexto = Contexto {
        fontes: Some(BTreeSet::from(["Inter".to_string()])),
        pasta: pasta.path().to_path_buf(),
        ..Contexto::default()
    };
    let roteiro = |estilo: Value| {
        json!({"estilo": estilo, "cortes": [{"id": "c01", "trechos": [[10.0, 20.0]]}]}).to_string()
    };

    let ruim = validar(
        &roteiro(
            json!({"fontes": {"legenda": "Comic", "titulos": "Inter"}, "marca": {"arquivo": "sumiu.png"}}),
        ),
        Some(&transcricao()),
        &contexto,
    );
    assert_eq!(
        ruim.problemas,
        [
            Problema::FonteForaDoCatalogo {
                fonte: "Comic".into()
            },
            Problema::LogoInexistente {
                arquivo: "sumiu.png".into()
            },
        ]
    );

    let boa = validar(
        &roteiro(json!({"fontes": {"legenda": "Inter"}, "marca": {"arquivo": "logo.png"}})),
        Some(&transcricao()),
        &contexto,
    );
    assert!(boa.problemas.is_empty());

    let corte =
        json!({"id": "c01", "trechos": [[10.0, 20.0]], "estilo": {"fontes": {"titulos": "Comic"}}});
    let no_corte = validar(&roteiro_com(corte), Some(&transcricao()), &contexto);
    assert_eq!(
        erros(&no_corte),
        [&Problema::FonteForaDoCatalogo {
            fonte: "Comic".into()
        }]
    );
}

#[test]
fn cortes_de_reserva_nao_sao_validados() {
    let roteiro =
        json!({"cortes": [{"id": "c01", "status": "reserva", "trechos": []}]}).to_string();
    let validacao = validar(&roteiro, Some(&transcricao()), &Contexto::default());
    assert!(validacao.cortes.is_empty());
}
