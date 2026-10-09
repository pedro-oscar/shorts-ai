//! `shorts-cli validar <roteiro>`: a validação do núcleo em frases que o Claude lê.

use std::fs;
use std::path::Path;
use std::process::ExitCode;

use nucleo::roteiro::validar_na_pasta;

pub fn rodar(roteiro: &Path) -> ExitCode {
    let texto = match fs::read_to_string(roteiro) {
        Ok(texto) => texto,
        Err(erro) => {
            eprintln!("Não consegui ler {}: {erro}", roteiro.display());
            return ExitCode::from(1);
        }
    };
    let validacao = validar_na_pasta(Path::new("."), &texto);
    print!("{}", validacao.relatorio());
    if validacao.tem_erros() {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}
