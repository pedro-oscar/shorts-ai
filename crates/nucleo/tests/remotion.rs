//! O Remotion do projeto (ADR 0003), pela interface pública do núcleo: as dependências
//! instaladas nos dados do app, de novo só quando o template as muda, e o `remotion/` de cada
//! projeto, com o `node_modules` ligado por symlink (junction no Windows). O `npm` e o `node` são falsos (scripts de shell),
//! então os testes da instalação só rodam no Linux e no macOS.

use std::fs;
use std::path::{Path, PathBuf};

use nucleo::{Config, Nucleo, Padroes};

/// Como o `npm ci`, esvazia o `node_modules` antes de instalar.
const FAKE_NPM: &str = "#!/bin/sh\necho \"$PWD: $@\" >> \"$(dirname \"$0\")/npm.log\"\n[ -f \"$(dirname \"$0\")/npm-fails\" ] && { echo 'sem rede' >&2; exit 1; }\n[ -d node_modules ] && find node_modules -mindepth 1 -delete\nmkdir -p node_modules\ntouch node_modules/.package-lock.json\n";
/// Baixa o Chrome headless no `browser ensure` do Remotion.
const FAKE_NODE: &str = "#!/bin/sh\necho \"$@\" >> \"$(dirname \"$0\")/node.log\"\n[ \"$2 $3\" = \"browser ensure\" ] && mkdir -p node_modules/.remotion\nexit 0\n";

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
        // O Node portátil e o modelo de transcrição já estão lá: a preparação só mexe no
        // Remotion, sem rede.
        let dados = tmp.path().join("dados");
        fs::create_dir_all(dados.join("node/bin")).unwrap();
        fs::write(dados.join("node/bin/node"), "").unwrap();
        fs::create_dir_all(dados.join("modelos")).unwrap();
        for modelo in [
            nucleo::transcricao::MODEL_FILE,
            nucleo::transcricao::VAD_MODEL_FILE,
        ] {
            fs::write(dados.join("modelos").join(modelo), "").unwrap();
        }
        let bin = tmp.path().join("bin");
        fs::create_dir(&bin).unwrap();
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: dados,
                pasta_de_videos: Some(tmp.path().join("Videos")),
                assets_dir: Some(tmp.path().join("assets")),
                npm: executavel_falso(&bin, "npm", FAKE_NPM),
                node: executavel_falso(&bin, "node", FAKE_NODE),
                ..Config::default()
            },
            |_| {},
        );
        Self { tmp, nucleo }
    }

    fn node_modules_compartilhado(&self) -> PathBuf {
        self.tmp.path().join("dados/remotion/node_modules")
    }

    /// Troca um arquivo do template, como faz uma atualização do app.
    #[cfg(unix)]
    fn atualizar_o_template(&self, nome: &str, conteudo: &str) {
        fs::write(self.tmp.path().join("assets/remotion").join(nome), conteudo).unwrap();
    }

    #[cfg(unix)]
    fn dependencias_presentes(&self) -> bool {
        self.nucleo
            .verificar_preparacao()
            .pacotes
            .iter()
            .any(|p| p.pacote == nucleo::Pacote::DependenciasDoRemotion && p.presente)
    }

    #[cfg(unix)]
    fn log_do_npm(&self) -> String {
        fs::read_to_string(self.tmp.path().join("bin/npm.log")).unwrap_or_default()
    }

    #[cfg(unix)]
    fn log_do_node(&self) -> String {
        fs::read_to_string(self.tmp.path().join("bin/node.log")).unwrap_or_default()
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
fn executavel_falso(bin: &Path, nome: &str, conteudo: &str) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let caminho = bin.join(nome);
    fs::write(&caminho, conteudo).unwrap();
    fs::set_permissions(&caminho, fs::Permissions::from_mode(0o755)).unwrap();
    Some(caminho)
}

#[cfg(not(unix))]
fn executavel_falso(_bin: &Path, _nome: &str, _conteudo: &str) -> Option<PathBuf> {
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

#[cfg(unix)]
#[test]
fn depois_de_uma_atualizacao_que_muda_as_dependencias_elas_faltam_na_preparacao() {
    let cenario = Cenario::novo();
    assert!(cenario.nucleo.preparar().completa());

    cenario.atualizar_o_template("package-lock.json", "package-lock.json com @fontsource");

    assert!(!cenario.dependencias_presentes());
}

#[cfg(unix)]
#[test]
fn a_preparacao_reinstala_as_dependencias_do_template_novo_e_baixa_o_chrome_de_novo() {
    let cenario = Cenario::novo();
    cenario.nucleo.preparar();
    cenario.atualizar_o_template("package.json", "package.json com @fontsource");
    cenario.atualizar_o_template("package-lock.json", "package-lock.json com @fontsource");

    assert!(cenario.nucleo.preparar().completa());

    let pasta = cenario.tmp.path().join("dados/remotion");
    for nome in ["package.json", "package-lock.json"] {
        assert_eq!(
            fs::read_to_string(pasta.join(nome)).unwrap(),
            format!("{nome} com @fontsource")
        );
    }
    assert_eq!(cenario.log_do_npm().lines().count(), 2);
    assert!(
        cenario
            .node_modules_compartilhado()
            .join(".remotion")
            .is_dir()
    );
}

#[cfg(unix)]
#[test]
fn a_atualizacao_que_nao_muda_as_dependencias_nao_reinstala_nada() {
    let cenario = Cenario::novo();
    cenario.nucleo.preparar();
    cenario.atualizar_o_template("src/Root.tsx", "root com uma cena nova");
    cenario.atualizar_o_template("package.json", "package.json com outro script");

    assert!(cenario.dependencias_presentes());
    cenario.nucleo.preparar();

    assert_eq!(cenario.log_do_npm().lines().count(), 1);
    assert_eq!(cenario.log_do_node().lines().count(), 1);
}

#[cfg(unix)]
#[test]
fn a_reinstalacao_que_falha_nao_deixa_as_dependencias_antigas_como_prontas() {
    let cenario = Cenario::novo();
    cenario.nucleo.preparar();
    cenario.atualizar_o_template("package-lock.json", "package-lock.json com @fontsource");
    fs::write(cenario.tmp.path().join("bin/npm-fails"), "").unwrap();

    assert!(cenario.nucleo.instalar_dependencias_do_remotion().is_err());

    assert!(!cenario.dependencias_presentes());
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
