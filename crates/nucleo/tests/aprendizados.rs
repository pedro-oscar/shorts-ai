//! As regras aprendidas pela interface pública do núcleo: ler, editar e apagar, e o que o
//! arquivo guarda além delas.

use std::fs;
use std::path::Path;

use nucleo::{Config, Erro, Nucleo};

const SEMENTE: &str = "# Aprendizados\n\nTexto de abertura.\n\n## Estilo\n- 2026-10-06 — Legendas aprovadas.\n- 2026-10-05 — Nunca use emoji nos títulos.\n\n## Corte\n- 2026-10-06 — Cortes de até 90 s.\n";

fn abrir(dados: &Path, assets: &Path) -> Nucleo {
    Nucleo::new(
        Config {
            app_data_dir: dados.to_path_buf(),
            assets_dir: Some(assets.to_path_buf()),
            ..Config::default()
        },
        |_| {},
    )
}

fn assets(raiz: &Path) -> std::path::PathBuf {
    let referencias = raiz.join("assets/corte-viral/references");
    fs::create_dir_all(&referencias).unwrap();
    fs::write(referencias.join("aprendizados.md"), SEMENTE).unwrap();
    raiz.join("assets")
}

#[test]
fn as_regras_vem_com_a_secao_antes_de_qualquer_sessao() {
    let tmp = tempfile::tempdir().unwrap();
    let nucleo = abrir(&tmp.path().join("dados"), &assets(tmp.path()));

    let regras = nucleo.regras_aprendidas().unwrap();

    let vistas: Vec<_> = regras
        .iter()
        .map(|r| (r.indice, r.secao.as_deref(), r.texto.as_str()))
        .collect();
    assert_eq!(
        vistas,
        [
            (0, Some("Estilo"), "2026-10-06 — Legendas aprovadas."),
            (
                1,
                Some("Estilo"),
                "2026-10-05 — Nunca use emoji nos títulos."
            ),
            (2, Some("Corte"), "2026-10-06 — Cortes de até 90 s."),
        ]
    );
}

#[test]
fn editar_e_apagar_mexem_so_na_regra_e_ficam_para_a_proxima_abertura() {
    let tmp = tempfile::tempdir().unwrap();
    let dados = tmp.path().join("dados");
    let assets = assets(tmp.path());
    let nucleo = abrir(&dados, &assets);

    nucleo
        .editar_regra_aprendida(1, "Emoji só nos ganchos.")
        .unwrap();
    let depois = nucleo.apagar_regra_aprendida(0).unwrap();

    let textos: Vec<_> = depois.iter().map(|r| r.texto.as_str()).collect();
    assert_eq!(
        textos,
        ["Emoji só nos ganchos.", "2026-10-06 — Cortes de até 90 s."]
    );
    let arquivo = fs::read_to_string(dados.join("aprendizados/aprendizados.md")).unwrap();
    assert!(arquivo.starts_with("# Aprendizados\n\nTexto de abertura.\n\n## Estilo\n"));
    assert!(arquivo.contains("## Corte\n"));
    let reaberto = abrir(&dados, &assets);
    assert_eq!(reaberto.regras_aprendidas().unwrap(), depois);
}

#[test]
fn texto_vazio_apaga_e_regra_inexistente_e_erro() {
    let tmp = tempfile::tempdir().unwrap();
    let nucleo = abrir(&tmp.path().join("dados"), &assets(tmp.path()));

    assert_eq!(nucleo.editar_regra_aprendida(2, "  ").unwrap().len(), 2);
    let erro = nucleo.apagar_regra_aprendida(5).unwrap_err();

    assert!(
        matches!(erro, Erro::AprendizadosNaoGravados { .. }),
        "{erro:?}"
    );
}

#[test]
fn sem_arquivo_nem_semente_nao_ha_regras() {
    let tmp = tempfile::tempdir().unwrap();
    let nucleo = Nucleo::new(
        Config {
            app_data_dir: tmp.path().join("dados"),
            ..Config::default()
        },
        |_| {},
    );

    assert!(nucleo.regras_aprendidas().unwrap().is_empty());
}
