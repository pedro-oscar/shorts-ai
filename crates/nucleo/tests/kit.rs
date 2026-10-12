//! O kit de marca pela interface pública do núcleo: os kits salvos, a cópia no projeto e a
//! validação do roteiro contra o catálogo de fontes.

use std::fs;
use std::path::PathBuf;

use nucleo::roteiro::validar_na_pasta;
use nucleo::{Config, Erro, Kit, Nucleo, Padroes, ProjetoResumo};

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
                ..Config::default()
            },
            |_| {},
        );
        Self { tmp, nucleo }
    }

    fn video(&self) -> String {
        let path = self.tmp.path().join("aula.mp4");
        fs::write(&path, b"video de mentira").unwrap();
        path.display().to_string()
    }
}

fn canal() -> Kit {
    Kit {
        nome: "Canal".to_owned(),
        cor_de_destaque: "#00AAFF".to_owned(),
        cor_da_palavra: "#FFFFFF".to_owned(),
        fonte_da_legenda: "Inter".to_owned(),
        fonte_dos_titulos: "Anton".to_owned(),
    }
}

fn kit_gravado(projeto: &ProjetoResumo) -> Kit {
    serde_json::from_slice(&fs::read(PathBuf::from(&projeto.pasta).join("kit.json")).unwrap())
        .unwrap()
}

#[test]
fn sem_kits_salvos_so_existe_o_padrao_com_as_cores_de_sempre() {
    let cenario = Cenario::novo();

    let kits = cenario.nucleo.kits().unwrap();

    assert_eq!(kits, [Kit::default()]);
    assert_eq!(kits[0].nome, "Padrão");
    assert_eq!(kits[0].cor_de_destaque, "#FF2D2D");
    assert_eq!(kits[0].cor_da_palavra, "#FFE600");
    assert_eq!(kits[0].fonte_da_legenda, "Montserrat");
}

#[test]
fn o_kit_salvo_fica_nos_dados_do_app_e_salvar_de_novo_o_substitui() {
    let cenario = Cenario::novo();
    cenario.nucleo.salvar_kit(canal()).unwrap();
    let kits = cenario
        .nucleo
        .salvar_kit(Kit {
            fonte_dos_titulos: "Bangers".to_owned(),
            ..canal()
        })
        .unwrap();

    assert_eq!(kits.len(), 2);
    assert_eq!(kits[1].fonte_dos_titulos, "Bangers");
    assert_eq!(cenario.nucleo.kits().unwrap(), kits);
}

#[test]
fn o_kit_padrao_nao_pode_ser_apagado_nem_sobrescrito() {
    let cenario = Cenario::novo();

    let apagar = cenario.nucleo.apagar_kit("Padrão");
    let sobrescrever = cenario.nucleo.salvar_kit(Kit {
        cor_de_destaque: "#000000".to_owned(),
        ..Kit::default()
    });

    assert!(matches!(apagar, Err(Erro::PadroesInvalidos { .. })));
    assert!(matches!(sobrescrever, Err(Erro::PadroesInvalidos { .. })));
    assert_eq!(cenario.nucleo.kits().unwrap(), [Kit::default()]);
}

#[test]
fn apagar_um_kit_salvo_o_tira_da_lista() {
    let cenario = Cenario::novo();
    cenario.nucleo.salvar_kit(canal()).unwrap();

    let kits = cenario.nucleo.apagar_kit("Canal").unwrap();

    assert_eq!(kits, [Kit::default()]);
}

#[test]
fn cor_fora_do_formato_nome_vazio_e_fonte_fora_do_catalogo_sao_recusados() {
    let cenario = Cenario::novo();
    let recusado = |kit: Kit| {
        assert!(matches!(
            cenario.nucleo.salvar_kit(kit),
            Err(Erro::PadroesInvalidos { .. })
        ));
    };

    recusado(Kit {
        cor_de_destaque: "vermelho".to_owned(),
        ..canal()
    });
    recusado(Kit {
        nome: "  ".to_owned(),
        ..canal()
    });
    recusado(Kit {
        fonte_da_legenda: "Comic Sans".to_owned(),
        ..canal()
    });
    assert_eq!(cenario.nucleo.kits().unwrap(), [Kit::default()]);
}

#[test]
fn o_projeto_recebe_uma_copia_do_kit_e_mudar_o_kit_depois_nao_a_altera() {
    let cenario = Cenario::novo();
    cenario.nucleo.salvar_kit(canal()).unwrap();
    let padroes = Padroes {
        kit: "Canal".to_owned(),
        ..Padroes::default()
    };

    let projetos = cenario
        .nucleo
        .criar_lote(&[cenario.video()], &padroes)
        .unwrap();
    cenario
        .nucleo
        .salvar_kit(Kit {
            cor_de_destaque: "#00FF00".to_owned(),
            ..canal()
        })
        .unwrap();

    assert_eq!(kit_gravado(&projetos[0]), canal());
}

#[test]
fn sem_escolher_kit_o_projeto_recebe_o_padrao() {
    let cenario = Cenario::novo();

    let projetos = cenario
        .nucleo
        .criar_lote(&[cenario.video()], &Padroes::default())
        .unwrap();

    assert_eq!(kit_gravado(&projetos[0]), Kit::default());
}

#[test]
fn kit_que_nao_existe_recusa_o_lote_sem_criar_nada() {
    let cenario = Cenario::novo();
    let padroes = Padroes {
        kit: "Sumiu".to_owned(),
        ..Padroes::default()
    };

    let resultado = cenario.nucleo.criar_lote(&[cenario.video()], &padroes);

    assert!(matches!(resultado, Err(Erro::PadroesInvalidos { opcao, .. }) if opcao == "kit"));
    assert!(cenario.nucleo.lotes().is_empty());
}

#[test]
fn a_validacao_do_roteiro_na_pasta_recusa_fonte_fora_do_catalogo() {
    let cenario = Cenario::novo();
    let roteiro = |fonte: &str| {
        serde_json::json!({
            "fonte": "bruto/a.mp4",
            "estilo": {"fontes": {"legenda": fonte, "titulos": "Bebas Neue"}},
            "cortes": [],
        })
        .to_string()
    };
    let pasta = cenario.tmp.path().join("projeto");
    fs::create_dir_all(pasta.join("edit")).unwrap();
    fs::write(
        pasta.join("edit/transcricao.json"),
        r#"{"idioma": "pt", "segmentos": []}"#,
    )
    .unwrap();

    let boa = validar_na_pasta(&pasta, &roteiro("Oswald"));
    let ruim = validar_na_pasta(&pasta, &roteiro("Comic Sans"));

    assert!(!boa.tem_erros(), "{}", boa.relatorio());
    assert!(ruim.tem_erros());
    assert!(ruim.relatorio().contains("Comic Sans"));
}
