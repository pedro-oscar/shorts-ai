//! O Remotion do projeto (ADR 0003), pela interface pública do núcleo: as dependências
//! instaladas uma vez nos dados do app e o `remotion/` de cada projeto, com o `node_modules`
//! ligado por symlink (junction no Windows). O `npm` é falso (um script de shell), então os
//! testes da instalação só rodam no Linux e no macOS.

use std::fs;
use std::path::{Path, PathBuf};

use nucleo::{Config, Nucleo, Padroes};

#[cfg(unix)]
const FAKE_NPM: &str = "#!/bin/sh\necho \"$PWD: $@\" >> \"$(dirname \"$0\")/npm.log\"\n[ -f \"$(dirname \"$0\")/npm-fails\" ] && { echo 'sem rede' >&2; exit 1; }\nmkdir -p node_modules\ntouch node_modules/.package-lock.json\n";

struct Cenario {
    tmp: tempfile::TempDir,
    nucleo: Nucleo,
}

impl Cenario {
    fn novo() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let assets = tmp.path().join("assets/remotion");
        fs::create_dir_all(assets.join("src/scenes")).unwrap();
        fs::create_dir_all(assets.join("public/clips/demo")).unwrap();
        fs::write(assets.join("src/Root.tsx"), "root").unwrap();
        fs::write(assets.join("src/scenes/index.ts"), "cenas").unwrap();
        fs::write(assets.join("public/clips/demo/clip.json"), "{}").unwrap();
        for nome in [
            "package.json",
            "package-lock.json",
            "remotion.config.ts",
            "tsconfig.json",
        ] {
            fs::write(assets.join(nome), nome).unwrap();
        }
        let bin = tmp.path().join("bin");
        fs::create_dir(&bin).unwrap();
        let npm = npm_falso(&bin);
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: tmp.path().join("dados"),
                pasta_de_videos: Some(tmp.path().join("Videos")),
                assets_dir: Some(tmp.path().join("assets")),
                npm,
                ..Config::default()
            },
            |_| {},
        );
        Self { tmp, nucleo }
    }

    fn node_modules_compartilhado(&self) -> PathBuf {
        self.tmp.path().join("dados/remotion/node_modules")
    }

    #[cfg(unix)]
    fn log_do_npm(&self) -> String {
        fs::read_to_string(self.tmp.path().join("bin/npm.log")).unwrap_or_default()
    }

    fn projeto(&self) -> PathBuf {
        let entrada = self.tmp.path().join("aula.mp4");
        fs::write(&entrada, b"video").unwrap();
        let projetos = self
            .nucleo
            .criar_lote(&[entrada.display().to_string()], &Padroes::default())
            .unwrap();
        self.tmp
            .path()
            .join("Videos/Shorts AI")
            .join(&projetos[0].id)
    }
}

#[cfg(unix)]
fn npm_falso(bin: &Path) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let npm = bin.join("npm");
    fs::write(&npm, FAKE_NPM).unwrap();
    fs::set_permissions(&npm, fs::Permissions::from_mode(0o755)).unwrap();
    Some(npm)
}

#[cfg(not(unix))]
fn npm_falso(_bin: &Path) -> Option<PathBuf> {
    None
}

#[cfg(unix)]
#[test]
fn as_dependencias_sao_instaladas_uma_vez_numa_pasta_node_modules_dos_dados_do_app() {
    let cenario = Cenario::novo();

    cenario.nucleo.instalar_dependencias_do_remotion().unwrap();
    cenario.nucleo.instalar_dependencias_do_remotion().unwrap();

    assert!(cenario.node_modules_compartilhado().is_dir());
    let pasta = cenario.tmp.path().join("dados/remotion");
    assert_eq!(
        fs::read_to_string(pasta.join("package.json")).unwrap(),
        "package.json"
    );
    assert_eq!(
        fs::read_to_string(pasta.join("package-lock.json")).unwrap(),
        "package-lock.json"
    );
    assert_eq!(
        cenario.log_do_npm().lines().collect::<Vec<_>>(),
        [format!("{}: ci --no-audit --no-fund", pasta.display())]
    );
}

#[cfg(unix)]
#[test]
fn instalacao_que_falha_vira_erro_com_a_saida_do_npm() {
    let cenario = Cenario::novo();
    fs::write(cenario.tmp.path().join("bin/npm-fails"), "").unwrap();

    let erro = cenario
        .nucleo
        .instalar_dependencias_do_remotion()
        .unwrap_err();

    assert!(
        matches!(&erro, nucleo::Erro::DependenciasDoRemotionNaoInstaladas { detalhe } if detalhe.contains("sem rede")),
        "{erro:?}"
    );
}

#[test]
fn o_projeto_recebe_src_e_public_copiados_e_o_node_modules_ligado() {
    let cenario = Cenario::novo();

    let pasta = cenario.projeto().join("remotion");

    assert_eq!(
        fs::read_to_string(pasta.join("src/Root.tsx")).unwrap(),
        "root"
    );
    assert_eq!(
        fs::read_to_string(pasta.join("src/scenes/index.ts")).unwrap(),
        "cenas"
    );
    assert_eq!(
        fs::read_to_string(pasta.join("public/clips/demo/clip.json")).unwrap(),
        "{}"
    );
    for nome in ["package.json", "remotion.config.ts", "tsconfig.json"] {
        assert!(pasta.join(nome).is_file(), "falta {nome}");
    }
    assert!(!pasta.join("src").is_symlink());
    fs::create_dir_all(cenario.node_modules_compartilhado()).unwrap();
    fs::write(pasta.join("node_modules/pelo-projeto"), "").unwrap();
    assert!(
        cenario
            .node_modules_compartilhado()
            .join("pelo-projeto")
            .is_file()
    );
}

#[test]
fn a_cena_nova_de_um_projeto_nao_aparece_nos_outros() {
    let cenario = Cenario::novo();
    let primeiro = cenario.projeto().join("remotion");
    let segundo = cenario.projeto().join("remotion");

    fs::write(primeiro.join("src/scenes/Nova.tsx"), "nova").unwrap();

    assert!(!segundo.join("src/scenes/Nova.tsx").exists());
}

#[cfg(unix)]
#[test]
fn o_node_modules_ligado_enxerga_o_que_foi_instalado_depois() {
    let cenario = Cenario::novo();
    let pasta = cenario.projeto().join("remotion");

    cenario.nucleo.instalar_dependencias_do_remotion().unwrap();

    assert!(pasta.join("node_modules/.package-lock.json").is_file());
}
