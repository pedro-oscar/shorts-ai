//! O material de referência dos testes: o vídeo KGfmaHnBQx4 (de terceiros) e sessões reais do
//! CLI. Fica fora do repositório, numa pasta local descrita pelo `LEIA.md` dela; a variável
//! `SHORTS_AI_REFERENCIA` muda o caminho, e sem ela vale `~/shorts-ai-referencia`.

use std::path::PathBuf;

/// O `caminho` dentro da pasta de referência. Sem a pasta, o teste falha dizendo onde a
/// procurou: os testes que dependem dela nunca passam calados.
pub fn referencia(caminho: &str) -> PathBuf {
    let pasta = std::env::var_os("SHORTS_AI_REFERENCIA")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(|casa| PathBuf::from(casa).join("shorts-ai-referencia"))
        })
        .expect("sem SHORTS_AI_REFERENCIA nem pasta pessoal para achar a referência");
    assert!(
        pasta.is_dir(),
        "a pasta de referência não existe em {}; defina SHORTS_AI_REFERENCIA ou copie o material para lá (AGENTS.md)",
        pasta.display()
    );
    pasta.join(caminho)
}
