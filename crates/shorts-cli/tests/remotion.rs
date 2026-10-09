//! `tsc`, `still` e `cena` no Remotion do projeto, contra um `node` falso (um script de shell)
//! que guarda onde e com que argumentos foi chamado. O teste lento, `#[ignore]`, usa o Node e
//! o Remotion de verdade.
#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const FAKE_NODE: &str = "#!/bin/sh\necho \"$PWD: $@\" >> \"$(dirname \"$0\")/node.log\"\n[ -f \"$(dirname \"$0\")/node-fails\" ] && { echo 'erro de tipos' >&2; exit 2; }\nexit 0\n";

struct Cenario {
    tmp: tempfile::TempDir,
}

impl Cenario {
    fn novo() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("projeto/remotion")).unwrap();
        fs::create_dir(tmp.path().join("bin")).unwrap();
        let node = tmp.path().join("bin/node");
        fs::write(&node, FAKE_NODE).unwrap();
        fs::set_permissions(&node, fs::Permissions::from_mode(0o755)).unwrap();
        Self { tmp }
    }

    fn projeto(&self) -> PathBuf {
        self.tmp.path().join("projeto")
    }

    fn rodar(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_shorts-cli"))
            .args(args)
            .current_dir(self.projeto())
            .env("SHORTS_NODE", self.tmp.path().join("bin/node"))
            .output()
            .unwrap()
    }

    fn chamadas(&self) -> Vec<String> {
        fs::read_to_string(self.tmp.path().join("bin/node.log"))
            .unwrap_or_default()
            .lines()
            .map(|linha| linha.replace(&format!("{}/", self.projeto().display()), ""))
            .collect()
    }
}

fn texto(bytes: &[u8]) -> String {
    String::from_utf8(bytes.to_vec()).unwrap()
}

#[test]
fn tsc_roda_o_typescript_do_projeto_sem_emitir() {
    let cenario = Cenario::novo();

    let saida = cenario.rodar(&["tsc"]);

    assert!(saida.status.success());
    assert_eq!(texto(&saida.stdout), "tipos ok\n");
    assert_eq!(
        cenario.chamadas(),
        ["remotion: node_modules/typescript/bin/tsc --noEmit"]
    );
}

#[test]
fn tsc_com_erro_de_tipos_falha_com_a_saida_dele() {
    let cenario = Cenario::novo();
    fs::write(cenario.tmp.path().join("bin/node-fails"), "").unwrap();

    let saida = cenario.rodar(&["tsc"]);

    assert!(!saida.status.success());
    assert!(texto(&saida.stderr).contains("erro de tipos"));
    assert!(!texto(&saida.stdout).contains("tipos ok"));
}

#[test]
fn still_renderiza_o_quadro_do_instante_em_30_fps() {
    let cenario = Cenario::novo();

    let saida = cenario.rodar(&["still", "abc1-c01", "1:15.5"]);

    assert!(saida.status.success(), "{}", texto(&saida.stderr));
    assert_eq!(
        texto(&saida.stdout),
        "→ remotion/out/abc1-c01_t1-15.5.png\n"
    );
    assert_eq!(
        cenario.chamadas(),
        [
            "remotion: node_modules/@remotion/cli/remotion-cli.js still reel-abc1-c01 out/abc1-c01_t1-15.5.png --frame=2265 --log=error"
        ]
    );
}

#[test]
fn cena_renderiza_a_cena_com_o_layout_pedido_e_card_por_padrao() {
    let cenario = Cenario::novo();

    let padrao = cenario.rodar(&["cena", "Dinheiro", "2"]);
    let cheia = cenario.rodar(&["cena", "Dinheiro", "2", "full"]);

    assert_eq!(
        texto(&padrao.stdout),
        "→ remotion/out/cena-Dinheiro_t2_card.png\n"
    );
    assert_eq!(
        texto(&cheia.stdout),
        "→ remotion/out/cena-Dinheiro_t2_full.png\n"
    );
    assert_eq!(
        cenario.chamadas(),
        [
            "remotion: node_modules/@remotion/cli/remotion-cli.js still cena-Dinheiro out/cena-Dinheiro_t2_card.png --frame=60 --props={\"name\":\"Dinheiro\",\"layout\":\"card\"} --log=error",
            "remotion: node_modules/@remotion/cli/remotion-cli.js still cena-Dinheiro out/cena-Dinheiro_t2_full.png --frame=60 --props={\"name\":\"Dinheiro\",\"layout\":\"full\"} --log=error",
        ]
    );
}

#[test]
fn argumentos_invalidos_falham_com_o_uso_sem_chamar_o_node() {
    let cenario = Cenario::novo();

    for args in [
        &["still", "abc1"][..],
        &["still", "../fora", "3"],
        &["still", "abc1", "tres"],
        &["cena", "Dinheiro", "2", "lado"],
        &["cena", "a\"b", "2"],
    ] {
        let saida = cenario.rodar(args);
        assert_eq!(saida.status.code(), Some(2), "{args:?}");
        assert!(texto(&saida.stderr).contains("Uso:"), "{args:?}");
    }
    assert!(cenario.chamadas().is_empty());
}

#[test]
fn fora_de_um_projeto_com_remotion_avisa() {
    let cenario = Cenario::novo();
    fs::remove_dir(cenario.projeto().join("remotion")).unwrap();

    let saida = cenario.rodar(&["tsc"]);

    assert_eq!(saida.status.code(), Some(1));
    assert!(texto(&saida.stderr).contains("remotion/"));
}

/// Empacota o template num projeto com o `node_modules` ligado por symlink e renderiza um
/// still: fecha a pergunta aberta do ADR 0003. Usa o Node do sistema e a internet (`npm ci`,
/// Chrome headless). Rode com `cargo test -p shorts-cli -- --ignored`.
#[test]
#[ignore = "lento: instala as dependências do template e renderiza com o Chrome headless"]
fn o_remotion_empacota_com_node_modules_ligado_por_symlink() {
    let template = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets/remotion");
    let tmp = tempfile::tempdir().unwrap();
    let compartilhado = tmp.path().join("dados");
    fs::create_dir(&compartilhado).unwrap();
    for nome in ["package.json", "package-lock.json"] {
        fs::copy(template.join(nome), compartilhado.join(nome)).unwrap();
    }
    let npm = Command::new("npm")
        .args(["ci", "--no-audit", "--no-fund"])
        .current_dir(&compartilhado)
        .status()
        .unwrap();
    assert!(npm.success());

    let remotion = tmp.path().join("projeto/remotion");
    fs::create_dir_all(&remotion).unwrap();
    for nome in ["package.json", "remotion.config.ts", "tsconfig.json"] {
        fs::copy(template.join(nome), remotion.join(nome)).unwrap();
    }
    for pasta in ["src", "public"] {
        let copia = Command::new("cp")
            .arg("-r")
            .arg(template.join(pasta))
            .arg(remotion.join(pasta))
            .status()
            .unwrap();
        assert!(copia.success());
    }
    std::os::unix::fs::symlink(
        compartilhado.join("node_modules"),
        remotion.join("node_modules"),
    )
    .unwrap();

    let projeto = tmp.path().join("projeto");
    let rodar = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_shorts-cli"))
            .args(args)
            .current_dir(&projeto)
            .output()
            .unwrap()
    };
    let tsc = rodar(&["tsc"]);
    assert!(tsc.status.success(), "{}", texto(&tsc.stderr));
    let still = rodar(&["still", "demo", "1"]);
    assert!(still.status.success(), "{}", texto(&still.stderr));
    assert!(remotion.join("out/demo_t1.png").is_file());
    assert!(!compartilhado.join("node_modules/.cache").exists());
}
