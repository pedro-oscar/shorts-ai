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

/// Um projeto com a transcrição de "Olá mundo. Tudo bem?" e o registro com a cena `Grafico`, que
/// aceita `title` e `bars`.
fn projeto() -> tempfile::TempDir {
    let pasta = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(pasta.path().join("edit")).unwrap();
    std::fs::create_dir_all(pasta.path().join("remotion/src/scenes")).unwrap();
    std::fs::write(
        pasta.path().join("remotion/src/scenes/index.ts"),
        "export const SCENES = {\n  Grafico: cena(Grafico, {title: true, bars: true}),\n};\n",
    )
    .unwrap();
    let palavras = r#"[
        {"text": "Olá", "start": 0.0, "end": 0.4, "type": "word"},
        {"text": "mundo.", "start": 0.5, "end": 0.9, "type": "word"},
        {"text": "Tudo", "start": 1.0, "end": 1.4, "type": "word"},
        {"text": "bem?", "start": 1.5, "end": 1.9, "type": "word"}
    ]"#;
    std::fs::write(
        pasta.path().join("edit/transcricao.json"),
        format!("{{\"words\": {palavras}}}"),
    )
    .unwrap();
    pasta
}

fn validar(pasta: &tempfile::TempDir, roteiro: &str) -> (Option<i32>, String) {
    std::fs::write(pasta.path().join("edit/roteiro.json"), roteiro).unwrap();
    let saida = Command::new(env!("CARGO_BIN_EXE_shorts-cli"))
        .args(["validar", "edit/roteiro.json"])
        .current_dir(pasta.path())
        .output()
        .unwrap();
    (
        saida.status.code(),
        String::from_utf8(saida.stdout).unwrap(),
    )
}

#[test]
fn validar_aceita_um_roteiro_valido_e_lista_os_avisos() {
    let pasta = projeto();
    let roteiro = r#"{"fonte": "bruto/Aula.mp4", "cortes": [
        {"id": "c01", "trechos": [[0.0, 1.9]], "titulo": "Olá",
         "motions": [{"type": "scene", "name": "Grafico", "at": 1.0}]}
    ]}"#;

    let (codigo, texto) = validar(&pasta, roteiro);

    assert_eq!(codigo, Some(0), "{texto}");
    assert!(texto.contains("✓ c01 → aula-c01"), "{texto}");
    assert!(texto.contains("⚠ aviso:"), "{texto}");
    assert!(texto.contains("Roteiro válido"), "{texto}");
}

#[test]
fn validar_sai_com_erro_quando_o_roteiro_e_invalido() {
    let pasta = projeto();
    let roteiro = r#"{"cortes": [
        {"id": "c01", "trechos": [[0.0, 1.9]],
         "motions": [{"type": "scene", "name": "Fantasma", "at": 1.0}]}
    ]}"#;

    let (codigo, texto) = validar(&pasta, roteiro);

    assert_eq!(codigo, Some(1), "{texto}");
    assert!(texto.contains("✗ c01"), "{texto}");
    assert!(
        texto.contains("\"Fantasma\" não está registrada"),
        "{texto}"
    );
    assert!(texto.contains("Roteiro inválido"), "{texto}");
}

#[test]
fn validar_aponta_a_prop_que_a_cena_nao_aceita() {
    let pasta = projeto();
    let roteiro = r#"{"cortes": [
        {"id": "c01", "trechos": [[0.0, 1.9]],
         "motions": [{"type": "scene", "name": "Grafico", "at": 1.0, "props": {"titulo": "Caixa"}}]}
    ]}"#;

    let (codigo, texto) = validar(&pasta, roteiro);

    assert_eq!(codigo, Some(1), "{texto}");
    assert!(
        texto.contains(
            "✗ erro: motion #1: a cena \"Grafico\" não aceita a prop \"titulo\" (aceita: bars, title)"
        ),
        "{texto}"
    );
}

#[test]
fn validar_aponta_o_campo_que_o_motion_nao_aceita() {
    let pasta = projeto();
    let roteiro = r#"{"cortes": [
        {"id": "c01", "trechos": [[0.0, 1.9]],
         "motions": [{"type": "keyword", "at": 1.0, "texto": "Olá"}]}
    ]}"#;

    let (codigo, texto) = validar(&pasta, roteiro);

    assert_eq!(codigo, Some(1), "{texto}");
    assert!(
        texto.contains("✗ erro: motion #1 (keyword): o campo \"texto\" não existe"),
        "{texto}"
    );
    assert!(
        texto.contains("✗ erro: motion #1 (keyword) precisa de \"text\""),
        "{texto}"
    );
}

#[test]
fn validar_sem_transcricao_e_erro() {
    let pasta = projeto();
    std::fs::remove_file(pasta.path().join("edit/transcricao.json")).unwrap();

    let (codigo, texto) = validar(&pasta, r#"{"cortes": []}"#);

    assert_eq!(codigo, Some(1));
    assert!(texto.contains("falta a transcrição"), "{texto}");
}
