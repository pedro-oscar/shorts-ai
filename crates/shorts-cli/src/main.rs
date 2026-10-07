//! `shorts-cli`: as ferramentas que o Claude roda nas sessões, no lugar do `./ae` do CLI.
//! Por ora só informa a versão; os subcomandos chegam com as etapas que os usam.

use std::env;
use std::process::ExitCode;

const USAGE: &str = "Uso: shorts-cli --version";

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["--version" | "-V"] => {
            println!("shorts-cli {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
    }
}
