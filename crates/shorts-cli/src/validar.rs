//! `shorts-cli validar <roteiro>`: a validação do núcleo em frases que o Claude lê.

use std::fs;
use std::path::Path;
use std::process::ExitCode;

use nucleo::roteiro::{
    Contexto, Gravidade, Problema, Transcricao, Validacao, cenas_registradas, validar,
};

/// Onde o projeto guarda a transcrição por palavra.
const TRANSCRICAO: &str = "edit/transcricao.json";

pub fn rodar(roteiro: &Path) -> ExitCode {
    let texto = match fs::read_to_string(roteiro) {
        Ok(texto) => texto,
        Err(erro) => {
            eprintln!("Não consegui ler {}: {erro}", roteiro.display());
            return ExitCode::from(1);
        }
    };
    let transcricao = fs::read_to_string(TRANSCRICAO)
        .ok()
        .and_then(|texto| Transcricao::do_json(&texto).ok());
    let contexto = Contexto {
        cenas: cenas_registradas(Path::new("remotion")),
        fontes: None,
        pasta: ".".into(),
    };
    let validacao = validar(&texto, transcricao.as_ref(), &contexto);
    print!("{}", relatorio(&validacao));
    if validacao.tem_erros() {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

fn relatorio(validacao: &Validacao) -> String {
    let mut saida = String::new();
    for problema in &validacao.problemas {
        saida.push_str(&format!("  {} {}\n", marca(problema), frase(problema)));
    }
    for corte in &validacao.cortes {
        let erros = corte
            .problemas
            .iter()
            .filter(|p| p.gravidade() == Gravidade::Erro)
            .count();
        match (&corte.plano, erros) {
            (Some(plano), 0) => saida.push_str(&format!(
                "  ✓ {} → {}  {:.1}s  {} trecho(s)  {} motion(s)\n",
                corte.id,
                plano.chave,
                plano.duracao,
                plano.trechos.len(),
                plano.motion.motions.len()
            )),
            _ => saida.push_str(&format!("  ✗ {}\n", corte.id)),
        }
        for problema in &corte.problemas {
            saida.push_str(&format!("      {} {}\n", marca(problema), frase(problema)));
        }
    }
    let erros = contar(validacao, Gravidade::Erro);
    let avisos = contar(validacao, Gravidade::Aviso);
    if erros == 0 {
        saida.push_str(&format!("\nRoteiro válido ({avisos} aviso(s)).\n"));
    } else {
        saida.push_str(&format!(
            "\nRoteiro inválido: {erros} erro(s), {avisos} aviso(s). Corrija o roteiro.\n"
        ));
    }
    saida
}

fn contar(validacao: &Validacao, gravidade: Gravidade) -> usize {
    validacao
        .todos_os_problemas()
        .filter(|p| p.gravidade() == gravidade)
        .count()
}

fn marca(problema: &Problema) -> &'static str {
    match problema.gravidade() {
        Gravidade::Erro => "✗ erro:",
        Gravidade::Aviso => "⚠ aviso:",
    }
}

fn frase(problema: &Problema) -> String {
    match problema {
        Problema::RoteiroIlegivel(erro) => {
            format!("o roteiro não é um JSON válido do contrato: {erro}")
        }
        Problema::VersaoNaoSuportada { versao } => {
            format!("versão {versao} do roteiro não é suportada (use a versão 1)")
        }
        Problema::TranscricaoAusente => format!(
            "falta a transcrição ({TRANSCRICAO}); rode na pasta do projeto, depois da etapa Transcrição"
        ),
        Problema::CorteSemTrechos => "o corte não tem trechos".into(),
        Problema::TrechoForaDoVideo {
            inicio,
            fim,
            duracao,
        } => {
            format!("trecho {inicio:.2}–{fim:.2} fora do vídeo (0–{duracao:.0}s)")
        }
        Problema::TrechoSemPalavra { inicio, fim } => {
            format!("trecho {inicio:.2}–{fim:.2} não contém nenhuma palavra")
        }
        Problema::DuracaoAcimaDoMaximo { duracao } => {
            format!("{duracao:.1}s é mais que o máximo de 90s; enxugue os trechos")
        }
        Problema::TipoDeMotionInvalido { numero, tipo } => format!(
            "motion #{numero} com type inválido: \"{tipo}\" (use title, keyword, counter, zoom, shake, scene ou flash)"
        ),
        Problema::AtForaDosTrechos { numero, instante } => {
            format!("motion #{numero}: o tempo {instante:.2}s não está em nenhum trecho do corte")
        }
        Problema::PalavraNaoEncontrada { numero, palavra } => {
            format!("motion #{numero}: a palavra \"{palavra}\" não aparece na legenda do corte")
        }
        Problema::MotionSemAtNemWord { numero, tipo } => {
            format!("motion #{numero} ({tipo}) precisa de \"at\" ou \"word\"")
        }
        Problema::MotionCurto { numero, tipo } => {
            format!("motion #{numero} ({tipo}) tem menos de 0,3s ou cai fora do corte")
        }
        Problema::CenaNaoRegistrada { nome } => {
            format!("a cena \"{nome}\" não está registrada em remotion/src/scenes/index.ts")
        }
        Problema::FonteForaDoCatalogo { fonte } => {
            format!("a fonte \"{fonte}\" não está no catálogo")
        }
        Problema::LogoInexistente { arquivo } => {
            format!("o arquivo de logo \"{arquivo}\" não existe")
        }
        Problema::UltimoTrechoSemPontuacao { palavra } => format!(
            "o corte termina em \"{palavra}\", sem fim de frase; pode soar abrupto, prefira terminar numa frase completa"
        ),
        Problema::EncaixeMoveuBorda { pedido, encaixado } => format!(
            "trecho {:.2}–{:.2} encaixado em {:.2}–{:.2}, mais de 0,6s de diferença",
            pedido.0, pedido.1, encaixado.0, encaixado.1
        ),
        Problema::CorteCurto { duracao } => format!(
            "duração {duracao:.1}s é curta (menos de 20s); inclua o contexto e deixe o payoff respirar"
        ),
        Problema::PalavraLongeDoAt { palavra, distancia } => {
            format!(
                "a palavra \"{palavra}\" mais próxima está a {distancia:.1}s do \"at\" indicado"
            )
        }
        Problema::MotionsSobrepostas { a, b } => format!(
            "{} {:.1}s e {} {:.1}s se sobrepõem na mesma região",
            a.0, a.1, b.0, b.1
        ),
        Problema::CenasCobremDemais => {
            "cenas de tela cheia cobrem mais de 60% do corte; o rosto quase não aparece".into()
        }
    }
}
