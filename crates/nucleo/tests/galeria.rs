//! A leitura dos dados do projeto para a Galeria, pela interface pública do núcleo: os reels
//! do roteiro com o arquivo publicado, as reservas e o que a pessoa pode abrir.

use std::fs;
use std::path::PathBuf;

use nucleo::{AlvoParaAbrir, Config, Erro, Nucleo};
use serde_json::json;

struct Cenario {
    // Fica vivo até o fim do teste.
    _tmp: tempfile::TempDir,
    projeto: PathBuf,
    nucleo: Nucleo,
}

impl Cenario {
    fn novo() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let videos = tmp.path().join("Videos");
        let projeto = videos.join("Shorts AI").join("Aula (2026-10-09)");
        fs::create_dir_all(projeto.join("edit")).unwrap();
        fs::create_dir_all(projeto.join("publicar")).unwrap();
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: tmp.path().join("dados"),
                pasta_de_videos: Some(videos),
                ..Config::default()
            },
            |_| {},
        );
        Self {
            _tmp: tmp,
            projeto,
            nucleo,
        }
    }

    fn roteiro(&self, cortes: &serde_json::Value) {
        let roteiro = json!({ "versao": 1, "cortes": cortes });
        fs::write(self.projeto.join("edit/roteiro.json"), roteiro.to_string()).unwrap();
    }

    fn publicar(&self, relativo: &str) -> String {
        let arquivo = self.projeto.join("publicar").join(relativo);
        fs::create_dir_all(arquivo.parent().unwrap()).unwrap();
        fs::write(&arquivo, b"reel").unwrap();
        arquivo.display().to_string()
    }
}

const ID: &str = "Aula (2026-10-09)";

#[test]
fn reels_com_as_informacoes_do_roteiro_e_o_arquivo_publicado() {
    let cenario = Cenario::novo();
    cenario.roteiro(&json!([{
        "id": "c01",
        "nota": 8.5,
        "categoria": "dica",
        "titulo": "Negociar salário tem regra",
        "gancho": "Você aceita a primeira oferta?",
        "payoff": "A regra dos três números",
        "porque": "Fala de dinheiro e tem tese clara",
        "descricao": "Descrição do post #salário",
        "trechos": [[10.0, 25.5], ["1:00", "1:30"]]
    }]));
    let arquivo = cenario.publicar("c01 - Negociar salário tem regra.mp4");

    let dados = cenario.nucleo.dados_do_projeto(ID).unwrap();

    assert_eq!(dados.reels.len(), 1);
    let reel = &dados.reels[0];
    assert_eq!(reel.id, "c01");
    assert_eq!(reel.titulo.as_deref(), Some("Negociar salário tem regra"));
    assert!((reel.duracao_em_segundos - 45.5).abs() < 1e-9);
    assert_eq!(reel.nota, Some(8.5));
    assert_eq!(reel.categoria.as_deref(), Some("dica"));
    assert_eq!(
        reel.gancho.as_deref(),
        Some("Você aceita a primeira oferta?")
    );
    assert_eq!(reel.payoff.as_deref(), Some("A regra dos três números"));
    assert_eq!(
        reel.porque.as_deref(),
        Some("Fala de dinheiro e tem tese clara")
    );
    assert_eq!(
        reel.descricao.as_deref(),
        Some("Descrição do post #salário")
    );
    assert_eq!(reel.arquivo.as_deref(), Some(arquivo.as_str()));
    assert!(!reel.previa);
}

#[test]
fn so_a_previa_publicada_vira_reel_com_selo_e_a_final_vale_mais() {
    let cenario = Cenario::novo();
    cenario.roteiro(&json!([
        { "id": "c01", "titulo": "Um", "trechos": [[0, 10]] },
        { "id": "c02", "titulo": "Dois", "trechos": [[0, 10]] },
        { "id": "c03", "titulo": "Três", "trechos": [[0, 10]] }
    ]));
    let previa = cenario.publicar("prévias/c01 - Um.mp4");
    cenario.publicar("prévias/c02 - Dois.mp4");
    let final_do_dois = cenario.publicar("c02 - Dois.mp4");

    let dados = cenario.nucleo.dados_do_projeto(ID).unwrap();

    assert_eq!(dados.reels[0].arquivo.as_deref(), Some(previa.as_str()));
    assert!(dados.reels[0].previa);
    assert_eq!(
        dados.reels[1].arquivo.as_deref(),
        Some(final_do_dois.as_str())
    );
    assert!(!dados.reels[1].previa);
    assert_eq!(dados.reels[2].arquivo, None);
}

#[test]
fn reservas_ficam_a_parte_com_titulo_nota_e_motivo() {
    let cenario = Cenario::novo();
    cenario.roteiro(&json!([
        { "id": "c01", "titulo": "Um", "trechos": [[0, 10]] },
        {
            "id": "c02",
            "status": "reserva",
            "nota": 6.5,
            "titulo": "Quase lá",
            "porque": "Nota abaixo do corte",
            "trechos": [[20, 30]]
        }
    ]));

    let dados = cenario.nucleo.dados_do_projeto(ID).unwrap();

    assert_eq!(dados.reels.len(), 1);
    assert_eq!(dados.reservas.len(), 1);
    let reserva = &dados.reservas[0];
    assert_eq!(reserva.id, "c02");
    assert_eq!(reserva.titulo.as_deref(), Some("Quase lá"));
    assert_eq!(reserva.nota, Some(6.5));
    assert_eq!(reserva.porque.as_deref(), Some("Nota abaixo do corte"));
}

#[test]
fn sem_roteiro_a_galeria_do_projeto_esta_vazia() {
    let cenario = Cenario::novo();

    let dados = cenario.nucleo.dados_do_projeto(ID).unwrap();

    assert!(dados.reels.is_empty() && dados.reservas.is_empty());
}

#[test]
fn roteiro_ilegivel_e_projeto_fora_da_biblioteca_sao_erros() {
    let cenario = Cenario::novo();
    fs::write(cenario.projeto.join("edit/roteiro.json"), "{ não é json").unwrap();

    assert!(matches!(
        cenario.nucleo.dados_do_projeto(ID),
        Err(Erro::ProjetoNaoLido { .. })
    ));
    assert!(matches!(
        cenario.nucleo.dados_do_projeto("../fora"),
        Err(Erro::ProjetoNaoLido { .. })
    ));
    assert!(matches!(
        cenario.nucleo.dados_do_projeto("Outro (2026-10-09)"),
        Err(Erro::ProjetoNaoLido { .. })
    ));
    assert!(matches!(
        cenario
            .nucleo
            .abrir_no_sistema("../fora", AlvoParaAbrir::Pasta),
        Err(Erro::ProjetoNaoLido { .. })
    ));
}
