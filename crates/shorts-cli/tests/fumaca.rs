//! Teste de fumaça do executável, como o Claude o chama.

use std::process::Command;

fn shorts_cli(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_shorts-cli"))
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn version_imprime_a_versao() {
    let saida = shorts_cli(&["--version"]);
    assert!(saida.status.success());
    let texto = String::from_utf8(saida.stdout).unwrap();
    let versao = texto.strip_prefix("shorts-cli ").unwrap().trim_end();
    assert_eq!(versao.split('.').count(), 3, "{texto:?}");
}

#[test]
fn comando_desconhecido_falha_com_o_uso() {
    let saida = shorts_cli(&["inventado"]);
    assert_eq!(saida.status.code(), Some(2));
    assert!(String::from_utf8(saida.stderr).unwrap().starts_with("Uso:"));
}
