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
        Self::abrindo_com(|_| None)
    }

    /// `abrir_com` recebe a pasta temporária do teste e diz com que programa o núcleo abre.
    fn abrindo_com(abrir_com: impl FnOnce(&std::path::Path) -> Option<PathBuf>) -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let videos = tmp.path().join("Videos");
        let projeto = videos.join("Shorts AI").join("Aula (2026-10-09)");
        fs::create_dir_all(projeto.join("edit")).unwrap();
        fs::create_dir_all(projeto.join("publicar")).unwrap();
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: tmp.path().join("dados"),
                pasta_de_videos: Some(videos),
                abrir_com: abrir_com(tmp.path()),
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

    /// O `relativo` usa `/`; o caminho devolvido, o separador do sistema, como o do núcleo.
    fn publicar(&self, relativo: &str) -> String {
        let arquivo = relativo
            .split('/')
            .fold(self.projeto.join("publicar"), |pasta, parte| {
                pasta.join(parte)
            });
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
        cenario
            .nucleo
            .abrir_no_sistema("../fora", AlvoParaAbrir::Pasta),
        Err(Erro::ProjetoNaoLido { .. })
    ));
}

#[test]
fn projeto_cuja_pasta_sumiu_nao_e_encontrado() {
    let cenario = Cenario::novo();
    fs::remove_dir_all(&cenario.projeto).unwrap();

    assert_eq!(
        cenario.nucleo.dados_do_projeto(ID),
        Err(Erro::ProjetoNaoEncontrado { id: ID.to_owned() })
    );
    assert_eq!(
        cenario.nucleo.abrir_no_sistema(ID, AlvoParaAbrir::Pasta),
        Err(Erro::ProjetoNaoEncontrado { id: ID.to_owned() })
    );
}

#[cfg(unix)]
mod abrir_no_sistema {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    use super::{Cenario, ID};
    use nucleo::{AlvoParaAbrir, Erro};
    use serde_json::json;

    /// Grava ao lado de si, em `aberto`, o caminho que recebeu; faz o papel do `xdg-open`.
    const ABRIR_FALSO: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
printf '%s' "$1" > "$dir/aberto.tmp"
mv "$dir/aberto.tmp" "$dir/aberto"
"#;

    fn com_abrir_falso() -> (Cenario, PathBuf) {
        let mut abrir = PathBuf::new();
        let cenario = Cenario::abrindo_com(|tmp| {
            abrir = tmp.join("abrir");
            fs::write(&abrir, ABRIR_FALSO).unwrap();
            fs::set_permissions(&abrir, fs::Permissions::from_mode(0o755)).unwrap();
            Some(abrir.clone())
        });
        (cenario, abrir)
    }

    /// O caminho que o programa falso recebeu; ele roda solto, então o teste espera por ele.
    fn aberto(abrir: &Path) -> String {
        let arquivo = abrir.with_file_name("aberto");
        let limite = Instant::now() + Duration::from_secs(10);
        while !arquivo.is_file() {
            assert!(Instant::now() < limite, "o programa de abrir não rodou");
            std::thread::sleep(Duration::from_millis(20));
        }
        let caminho = fs::read_to_string(&arquivo).unwrap();
        fs::remove_file(&arquivo).unwrap();
        caminho
    }

    #[test]
    fn entrega_ao_programa_do_sistema_a_pasta_o_roteiro_e_os_logs() {
        let (cenario, abrir) = com_abrir_falso();
        cenario.roteiro(&json!([]));
        fs::write(cenario.projeto.join("edit/sessao-roteiro.jsonl"), "").unwrap();

        cenario
            .nucleo
            .abrir_no_sistema(ID, AlvoParaAbrir::Pasta)
            .unwrap();
        assert_eq!(aberto(&abrir), cenario.projeto.display().to_string());

        cenario
            .nucleo
            .abrir_no_sistema(ID, AlvoParaAbrir::Roteiro)
            .unwrap();
        assert_eq!(
            aberto(&abrir),
            cenario
                .projeto
                .join("edit/roteiro.json")
                .display()
                .to_string()
        );

        cenario
            .nucleo
            .abrir_no_sistema(ID, AlvoParaAbrir::Logs)
            .unwrap();
        assert_eq!(
            aberto(&abrir),
            cenario
                .projeto
                .join("edit/sessao-roteiro.jsonl")
                .display()
                .to_string()
        );
    }

    #[test]
    fn o_reel_abre_no_player_do_sistema_na_versao_final_ou_na_previa() {
        let (cenario, abrir) = com_abrir_falso();
        cenario.roteiro(&json!([
            { "id": "c01", "titulo": "Um", "trechos": [[0, 10]] },
            { "id": "c02", "titulo": "Dois", "trechos": [[0, 10]] }
        ]));
        let previa = cenario.publicar("prévias/c01 - Um.mp4");
        cenario.publicar("prévias/c02 - Dois.mp4");
        let final_do_dois = cenario.publicar("c02 - Dois.mp4");

        cenario
            .nucleo
            .abrir_no_sistema(ID, AlvoParaAbrir::Reel("c01".to_owned()))
            .unwrap();
        assert_eq!(aberto(&abrir), previa);

        cenario
            .nucleo
            .abrir_no_sistema(ID, AlvoParaAbrir::Reel("c02".to_owned()))
            .unwrap();
        assert_eq!(aberto(&abrir), final_do_dois);
    }

    #[test]
    fn o_codigo_fonte_abre_a_release_desta_versao_no_navegador() {
        let (cenario, abrir) = com_abrir_falso();

        cenario.nucleo.abrir_codigo_fonte().unwrap();

        let pagina = aberto(&abrir);
        assert_eq!(
            pagina,
            format!(
                "https://github.com/pedro-oscar/shorts-ai/releases/tag/v{}",
                env!("CARGO_PKG_VERSION")
            )
        );
        assert_eq!(cenario.nucleo.estado_inicial().codigo_fonte, pagina);
    }

    #[test]
    fn o_que_nao_existe_ou_sem_o_programa_de_abrir_e_erro() {
        let (cenario, _) = com_abrir_falso();
        let roteiro = cenario
            .projeto
            .join("edit/roteiro.json")
            .display()
            .to_string();

        assert!(matches!(
            cenario.nucleo.abrir_no_sistema(ID, AlvoParaAbrir::Roteiro),
            Err(Erro::NaoAbriu { caminho, .. }) if caminho == roteiro
        ));

        cenario.roteiro(&json!([{ "id": "c01", "titulo": "Um", "trechos": [[0, 10]] }]));
        assert!(matches!(
            cenario
                .nucleo
                .abrir_no_sistema(ID, AlvoParaAbrir::Reel("c01".to_owned())),
            Err(Erro::ProjetoNaoLido { detalhe, .. }) if detalhe.contains("c01")
        ));

        let sem_programa = Cenario::abrindo_com(|tmp| Some(tmp.join("nao-existe")));
        assert!(matches!(
            sem_programa
                .nucleo
                .abrir_no_sistema(ID, AlvoParaAbrir::Pasta),
            Err(Erro::NaoAbriu { .. })
        ));
    }
}
