//! `shorts-cli`: as ferramentas que o Claude roda nas sessões, no lugar do `./ae` do CLI.
//! Roda na pasta do projeto; `validar` lê `edit/transcricao.json` e o registro de cenas do
//! Remotion, e `tsc`, `still` e `cena` usam o Remotion de `remotion/`.

mod validar;

use std::env;
use std::path::Path;
use std::process::{Command, ExitCode};

const USAGE: &str = "Uso: shorts-cli --version
     shorts-cli validar <roteiro>
     shorts-cli tsc
     shorts-cli still <chave> <seg>
     shorts-cli cena <nome> <seg> [card|full]";

const FPS: f64 = 30.0;
const TSC: &str = "node_modules/typescript/bin/tsc";
const REMOTION: &str = "node_modules/@remotion/cli/remotion-cli.js";

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
        ["validar", roteiro] => validar::rodar(Path::new(roteiro)),
        ["tsc"] => no_remotion(&[TSC, "--noEmit"], || println!("tipos ok")),
        ["still", chave, segundos] => match (nome_valido(chave), frame(segundos)) {
            (true, Some(frame)) => {
                let saida = format!("out/{chave}_t{}.png", sem_dois_pontos(segundos));
                still(&format!("reel-{chave}"), &saida, frame, None)
            }
            _ => uso(),
        },
        ["cena", nome, segundos] => cena(nome, segundos, "card"),
        ["cena", nome, segundos, layout] => cena(nome, segundos, layout),
        _ => uso(),
    }
}

fn uso() -> ExitCode {
    eprintln!("{USAGE}");
    ExitCode::from(2)
}

fn cena(nome: &str, segundos: &str, layout: &str) -> ExitCode {
    match (nome_valido(nome), frame(segundos), layout) {
        (true, Some(frame), "card" | "full") => {
            let saida = format!(
                "out/cena-{nome}_t{}_{layout}.png",
                sem_dois_pontos(segundos)
            );
            let props = format!("{{\"name\":\"{nome}\",\"layout\":\"{layout}\"}}");
            still(&format!("cena-{nome}"), &saida, frame, Some(&props))
        }
        _ => uso(),
    }
}

fn still(composicao: &str, saida: &str, frame: u64, props: Option<&str>) -> ExitCode {
    let frame = format!("--frame={frame}");
    let props = props.map(|props| format!("--props={props}"));
    let mut args = vec![REMOTION, "still", composicao, saida, &frame];
    args.extend(props.as_deref());
    args.push("--log=error");
    no_remotion(&args, || println!("→ remotion/{saida}"))
}

/// Chaves de corte e nomes de cena: letras, números, `-` e `_`, que cabem no nome de um
/// arquivo e num JSON sem escape.
fn nome_valido(nome: &str) -> bool {
    !nome.is_empty()
        && nome
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// O Windows não aceita `:` em nome de arquivo.
fn sem_dois_pontos(segundos: &str) -> String {
    segundos.replace(':', "-")
}

/// "75", "1:15" ou "01:01:15.5" em segundos, e daí o quadro a 30 fps.
fn frame(segundos: &str) -> Option<u64> {
    let mut total = 0.0;
    for parte in segundos.split(':') {
        let valor: f64 = parte
            .parse()
            .ok()
            .filter(|v: &f64| v.is_finite() && *v >= 0.0)?;
        total = total * 60.0 + valor;
    }
    // Arredondado e não negativo, então o corte para inteiro é exato.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    Some((total * FPS).round() as u64)
}

/// Roda o `node` com os argumentos dentro de `remotion/` e, se terminar bem, chama `depois`.
fn no_remotion(args: &[&str], depois: impl FnOnce()) -> ExitCode {
    if !Path::new("remotion").is_dir() {
        eprintln!("Sem remotion/ aqui: rode na pasta de um projeto do Shorts AI.");
        return ExitCode::from(1);
    }
    let node = env::var_os("SHORTS_NODE").unwrap_or_else(|| "node".into());
    match Command::new(node)
        .args(args)
        .current_dir("remotion")
        .status()
    {
        Ok(status) if status.success() => {
            depois();
            ExitCode::SUCCESS
        }
        Ok(status) => ExitCode::from(
            status
                .code()
                .and_then(|c| u8::try_from(c).ok())
                .unwrap_or(1),
        ),
        Err(error) => {
            eprintln!("Não consegui rodar o node: {error}");
            ExitCode::from(1)
        }
    }
}
