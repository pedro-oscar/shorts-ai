//! A Galeria: o que a pessoa vê de um projeto depois da Produção, lido do roteiro e dos
//! arquivos publicados, e o que ela pode abrir no sistema.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::custo::ResumoDeCusto;
use crate::process::hide_console;
use crate::producao::{PREVIAS, PUBLICAR, nome_do_reel};
use crate::roteiro::{ROTEIRO, Roteiro, StatusDoCorte};

const LOG_DO_ROTEIRO: &str = "edit/sessao-roteiro.jsonl";
const PASTA_DE_EDICAO: &str = "edit";

/// O que a Galeria abre no sistema.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AlvoParaAbrir {
    /// A pasta do projeto, no Explorador ou no gerenciador de arquivos.
    Pasta,
    Roteiro,
    /// O log da sessão do Claude e, sem ele, a pasta `edit/`.
    Logs,
    /// O reel publicado do corte com este id, no player do sistema: onde o app não toca o
    /// reel, como no Linux (ADR 0008).
    Reel(String),
}

/// Um corte a produzir, com o arquivo publicado dele se já existe.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReelDoProjeto {
    pub id: String,
    pub titulo: Option<String>,
    pub duracao_em_segundos: f64,
    pub nota: Option<f64>,
    pub categoria: Option<String>,
    pub gancho: Option<String>,
    pub payoff: Option<String>,
    pub porque: Option<String>,
    /// O texto do post.
    pub descricao: Option<String>,
    /// O caminho do reel publicado; `None` enquanto ele não foi renderizado.
    pub arquivo: Option<String>,
    /// O arquivo é a prévia em meia resolução, não a versão final.
    pub previa: bool,
}

/// Um corte que o Claude deixou de reserva: não é renderizado.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Reserva {
    pub id: String,
    pub titulo: Option<String>,
    pub nota: Option<f64>,
    pub porque: Option<String>,
}

/// Os reels e as reservas de um projeto, na ordem do roteiro.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DadosDoProjeto {
    pub reels: Vec<ReelDoProjeto>,
    pub reservas: Vec<Reserva>,
    /// O custo do projeto e o rateio por reel; só `Nucleo::dados_do_projeto` o preenche.
    pub custo: ResumoDeCusto,
}

/// Lê o roteiro da pasta do projeto; sem roteiro ainda, a Galeria dele está vazia.
pub(crate) fn ler(pasta: &Path) -> Result<DadosDoProjeto, String> {
    let texto = match fs::read_to_string(pasta.join(ROTEIRO)) {
        Ok(texto) => texto,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DadosDoProjeto::default());
        }
        Err(error) => return Err(error.to_string()),
    };
    let roteiro: Roteiro = serde_json::from_str(&texto).map_err(|error| error.to_string())?;
    let mut dados = DadosDoProjeto::default();
    let publicado = pasta.join(PUBLICAR);
    for corte in roteiro.cortes {
        if corte.status == StatusDoCorte::Reserva {
            dados.reservas.push(Reserva {
                id: corte.id,
                titulo: corte.titulo,
                nota: corte.nota,
                porque: corte.porque,
            });
            continue;
        }
        let nome = nome_do_reel(&corte.id, corte.titulo.as_deref());
        let (arquivo, previa) = [
            (publicado.join(&nome), false),
            (publicado.join(PREVIAS).join(&nome), true),
        ]
        .into_iter()
        .find(|(caminho, _)| caminho.is_file())
        .map_or((None, false), |(caminho, previa)| {
            (Some(caminho.display().to_string()), previa)
        });
        dados.reels.push(ReelDoProjeto {
            duracao_em_segundos: corte
                .trechos
                .iter()
                .map(|(inicio, fim)| fim.0 - inicio.0)
                .sum(),
            id: corte.id,
            titulo: corte.titulo,
            nota: corte.nota,
            categoria: corte.categoria,
            gancho: corte.gancho,
            payoff: corte.payoff,
            porque: corte.porque,
            descricao: corte.descricao,
            arquivo,
            previa,
        });
    }
    Ok(dados)
}

/// O que abrir no sistema para o alvo, com o separador do sistema: o Explorador não entende
/// `/` no meio do caminho. Só o reel pode faltar: o roteiro não lido ou o corte sem reel
/// publicado.
pub(crate) fn caminho_para_abrir(pasta: &Path, alvo: &AlvoParaAbrir) -> Result<PathBuf, String> {
    let dentro = |relativo: &str| pasta.join(Path::new(relativo).iter().collect::<PathBuf>());
    Ok(match alvo {
        AlvoParaAbrir::Pasta => pasta.to_owned(),
        AlvoParaAbrir::Roteiro => dentro(ROTEIRO),
        AlvoParaAbrir::Logs => {
            let log = dentro(LOG_DO_ROTEIRO);
            if log.is_file() {
                log
            } else {
                dentro(PASTA_DE_EDICAO)
            }
        }
        AlvoParaAbrir::Reel(corte) => ler(pasta)?
            .reels
            .into_iter()
            .find(|reel| &reel.id == corte)
            .and_then(|reel| reel.arquivo)
            .map(PathBuf::from)
            .ok_or_else(|| format!("o corte {corte} não tem reel publicado"))?,
    })
}

/// O programa do sistema que abre arquivos e pastas no programa padrão de cada um.
pub(crate) fn programa_de_abrir() -> PathBuf {
    PathBuf::from(if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    })
}

/// Entrega o caminho, que tem de existir, ao programa de abrir, sem esperar por ele.
pub(crate) fn abrir_no_sistema(programa: &Path, caminho: &Path) -> std::io::Result<()> {
    fs::metadata(caminho)?;
    let mut comando = Command::new(programa);
    comando.arg(caminho);
    hide_console(&mut comando);
    let mut filho = comando.spawn()?;
    // O `xdg-open` pode ficar preso ao programa que abriu, e o Explorador sai com código 1
    // mesmo quando abre: ninguém espera pelo resultado, só colhe o processo para ele não
    // ficar zumbi.
    std::thread::spawn(move || filho.wait());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logs_abrem_o_log_da_sessao_e_na_falta_dele_a_pasta_de_edicao() {
        let pasta = tempfile::tempdir().unwrap();
        assert_eq!(
            caminho_para_abrir(pasta.path(), &AlvoParaAbrir::Logs),
            Ok(pasta.path().join("edit"))
        );
        fs::create_dir(pasta.path().join("edit")).unwrap();
        fs::write(pasta.path().join(LOG_DO_ROTEIRO), "").unwrap();
        assert_eq!(
            caminho_para_abrir(pasta.path(), &AlvoParaAbrir::Logs),
            Ok(pasta.path().join(LOG_DO_ROTEIRO))
        );
        assert_eq!(
            caminho_para_abrir(pasta.path(), &AlvoParaAbrir::Roteiro),
            Ok(pasta.path().join("edit/roteiro.json"))
        );
    }
}
