//! O kit de marca pela interface pública do núcleo: os kits salvos, a cópia no projeto e a
//! validação do roteiro contra o catálogo de fontes.

use std::fs;
use std::path::PathBuf;

use nucleo::roteiro::validar_na_pasta;
use nucleo::{Config, Erro, Kit, Logo, Nucleo, Padroes, PosicaoDaLogo, ProjetoResumo};

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
        logo: None,
    }
}

/// Um PNG só com os chunks que importam: IHDR com o tipo de cor, os extras e um IEND.
fn png(largura: u32, altura: u32, tipo_de_cor: u8, extras: &[&[u8; 4]]) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut chunk = |nome: &[u8], dados: &[u8]| {
        bytes.extend((dados.len() as u32).to_be_bytes());
        bytes.extend(nome);
        bytes.extend(dados);
        bytes.extend([0; 4]);
    };
    let mut ihdr = Vec::new();
    ihdr.extend(largura.to_be_bytes());
    ihdr.extend(altura.to_be_bytes());
    ihdr.extend([8, tipo_de_cor, 0, 0, 0]);
    chunk(b"IHDR", &ihdr);
    for extra in extras {
        chunk(*extra, &[0]);
    }
    chunk(b"IEND", &[]);
    bytes
}

fn com_logo(cenario: &Cenario, nome: &str, bytes: &[u8]) -> Kit {
    let arquivo = cenario.tmp.path().join(nome);
    fs::write(&arquivo, bytes).unwrap();
    Kit {
        logo: Some(Logo::nova(arquivo.display().to_string())),
        ..canal()
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

#[test]
fn png_sem_alfa_nem_trns_recebe_aviso_e_com_um_dos_dois_nao() {
    let cenario = Cenario::novo();
    let verificar = |nome: &str, bytes: Vec<u8>| {
        let arquivo = cenario.tmp.path().join(nome);
        fs::write(&arquivo, bytes).unwrap();
        cenario
            .nucleo
            .verificar_logo(&arquivo.display().to_string())
            .unwrap()
    };

    let opaco = verificar("a.png", png(200, 100, 2, &[]));
    let alfa = verificar("b.png", png(200, 100, 6, &[]));
    let trns = verificar("c.png", png(200, 100, 3, &[b"tRNS"]));
    let svg = verificar(
        "d.svg",
        br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"></svg>"#.to_vec(),
    );

    assert!(!opaco.com_transparencia);
    assert!(alfa.com_transparencia);
    assert!(trns.com_transparencia);
    assert_eq!(opaco.proporcao, 0.5);
    assert!(svg.com_transparencia);
    assert_eq!(svg.proporcao, 0.25);
}

#[test]
fn logo_que_nao_e_png_nem_svg_ou_nao_existe_e_recusada() {
    let cenario = Cenario::novo();
    let jpg = cenario.tmp.path().join("a.jpg");
    fs::write(&jpg, b"jpg").unwrap();
    let falso = cenario.tmp.path().join("b.png");
    fs::write(&falso, b"nao sou png").unwrap();

    for caminho in [jpg, falso, cenario.tmp.path().join("sumiu.png")] {
        let resultado = cenario
            .nucleo
            .verificar_logo(&caminho.display().to_string());
        assert!(matches!(resultado, Err(Erro::PadroesInvalidos { .. })));
    }
}

#[test]
fn largura_e_opacidade_da_logo_tem_limites_e_o_kit_guarda_a_proporcao() {
    let cenario = Cenario::novo();
    let kit = com_logo(&cenario, "logo.png", &png(300, 150, 6, &[]));
    let recusado = |ajuste: fn(&mut Logo)| {
        let mut kit = kit.clone();
        ajuste(kit.logo.as_mut().unwrap());
        assert!(matches!(
            cenario.nucleo.salvar_kit(kit),
            Err(Erro::PadroesInvalidos { .. })
        ));
    };

    recusado(|logo| logo.largura = 5);
    recusado(|logo| logo.largura = 31);
    recusado(|logo| logo.opacidade = 19);
    recusado(|logo| logo.opacidade = 101);
    let kits = cenario.nucleo.salvar_kit(kit).unwrap();

    let logo = kits[1].logo.as_ref().unwrap();
    assert_eq!((logo.largura, logo.opacidade), (14, 80));
    assert_eq!(logo.proporcao, 0.5);
}

#[test]
fn kit_com_logo_inexistente_nao_e_salvo() {
    let cenario = Cenario::novo();
    let kit = Kit {
        logo: Some(Logo::nova(
            cenario.tmp.path().join("sumiu.png").display().to_string(),
        )),
        ..canal()
    };

    assert!(matches!(
        cenario.nucleo.salvar_kit(kit),
        Err(Erro::PadroesInvalidos { .. })
    ));
}

#[test]
fn a_logo_e_copiada_para_o_remotion_do_projeto_e_vira_a_marca_do_estilo() {
    let cenario = Cenario::novo();
    let mut kit = com_logo(&cenario, "logo.png", &png(300, 150, 6, &[]));
    kit.logo.as_mut().unwrap().posicao = PosicaoDaLogo::InferiorDireito;
    cenario.nucleo.salvar_kit(kit.clone()).unwrap();
    let padroes = Padroes {
        kit: "Canal".to_owned(),
        ..Padroes::default()
    };

    let projetos = cenario
        .nucleo
        .criar_lote(&[cenario.video()], &padroes)
        .unwrap();

    let pasta = PathBuf::from(&projetos[0].pasta);
    assert!(pasta.join("remotion/public/logo.png").is_file());
    let marca = kit_gravado(&projetos[0]).estilo()["marca"].clone();
    assert_eq!(marca["arquivo"], "remotion/public/logo.png");
    assert_eq!(marca["posicao"], "inferiorDireito");
    assert_eq!(marca["largura"], 0.14);
    assert_eq!(marca["opacidade"], 0.8);
    assert_eq!(marca["proporcao"], 0.5);
}

#[test]
fn a_validacao_do_roteiro_confere_se_o_arquivo_da_logo_existe_no_projeto() {
    let cenario = Cenario::novo();
    let kit = com_logo(&cenario, "logo.png", &png(100, 100, 6, &[]));
    cenario.nucleo.salvar_kit(kit).unwrap();
    let padroes = Padroes {
        kit: "Canal".to_owned(),
        ..Padroes::default()
    };
    let projetos = cenario
        .nucleo
        .criar_lote(&[cenario.video()], &padroes)
        .unwrap();
    let pasta = PathBuf::from(&projetos[0].pasta);
    fs::create_dir_all(pasta.join("edit")).unwrap();
    fs::write(
        pasta.join("edit/transcricao.json"),
        r#"{"idioma": "pt", "segmentos": []}"#,
    )
    .unwrap();
    let roteiro = serde_json::json!({
        "fonte": "bruto/a.mp4",
        "estilo": kit_gravado(&projetos[0]).estilo(),
        "cortes": [],
    })
    .to_string();

    let com_arquivo = validar_na_pasta(&pasta, &roteiro);
    fs::remove_file(pasta.join("remotion/public/logo.png")).unwrap();
    let sem_arquivo = validar_na_pasta(&pasta, &roteiro);

    assert!(!com_arquivo.tem_erros(), "{}", com_arquivo.relatorio());
    assert!(sem_arquivo.relatorio().contains("logo.png"));
}

#[test]
fn o_resumo_do_kit_diz_ao_claude_onde_esta_a_logo() {
    let kit = Kit {
        logo: Some(Logo {
            posicao: PosicaoDaLogo::SuperiorDireito,
            ..Logo::nova("logo.png")
        }),
        ..Kit::default()
    };

    assert!(kit.resumo().contains("canto superior direito"));
    assert!(!Kit::default().resumo().contains("Logo"));
}
