//! O Diagnóstico: o que a máquina tem e o que falta, para a pessoa saber antes de começar.
//! O núcleo só informa os fatos; o texto do relatório é da interface.

use std::path::{Path, PathBuf};

use serde::Serialize;
use specta::Type;

use crate::conta::EstadoDaConta;

/// Onde os trabalhos pesados rodam: na GPU, por Vulkan, ou só na CPU.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Gpu {
    Vulkan,
    SoCpu,
}

/// Uma dependência que o app confere.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum NomeDaDependencia {
    Ffmpeg,
    YtDlp,
    Whisper,
    ModeloDeTranscricao,
    Node,
    DependenciasDoRemotion,
    Chrome,
}

/// O que o Diagnóstico achou de uma dependência.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(
    tag = "tipo",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Situacao {
    Presente {
        versao: Option<String>,
    },
    Ausente,
    /// Achado, mas sem alguns encoders ou filtros de que o app precisa.
    Incompleta {
        faltam: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Dependencia {
    pub nome: NomeDaDependencia,
    pub situacao: Situacao,
}

/// O retrato da máquina.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostico {
    pub gpu: Gpu,
    /// Em MB, no disco da Biblioteca; `None` quando o sistema não informa.
    pub espaco_livre_em_mb: Option<u32>,
    pub dependencias: Vec<Dependencia>,
    pub conta: EstadoDaConta,
}

/// Os encoders que o app pede ao ffmpeg.
const ENCODERS: [&str; 3] = ["libx264", "aac", "wrapped_avframe"];
/// Os filtros que o app pede ao ffmpeg.
const FILTROS: [&str; 3] = ["zscale", "loudnorm", "signalstats"];

pub(crate) fn dependencia(nome: NomeDaDependencia, situacao: Situacao) -> Dependencia {
    Dependencia { nome, situacao }
}

/// Presente ou ausente, conforme o booleano.
pub(crate) fn por_presenca(nome: NomeDaDependencia, presente: bool) -> Dependencia {
    dependencia(
        nome,
        if presente {
            Situacao::Presente { versao: None }
        } else {
            Situacao::Ausente
        },
    )
}

/// Um programa que diz a versão na primeira linha de `args`; ausente se não está no disco ou
/// não roda.
pub(crate) fn programa(
    nome: NomeDaDependencia,
    caminho: Option<&Path>,
    args: &[&str],
) -> Dependencia {
    let versao = caminho.and_then(|caminho| saida(caminho, args));
    let situacao = match (caminho, versao) {
        (Some(_), Some(saida)) => Situacao::Presente {
            versao: saida.lines().next().map(versao_da_linha),
        },
        _ => Situacao::Ausente,
    };
    dependencia(nome, situacao)
}

/// `ffmpeg version 6.1 Copyright...` vira `6.1`; outras linhas ficam como estão.
fn versao_da_linha(linha: &str) -> String {
    let mut palavras = linha.split_whitespace();
    match (palavras.next(), palavras.next(), palavras.next()) {
        (Some("ffmpeg"), Some("version"), Some(versao)) => versao.to_owned(),
        _ => linha.trim().to_owned(),
    }
}

/// O ffmpeg com a versão e os encoders e filtros que faltam nele.
pub(crate) fn ffmpeg(caminho: Option<&Path>) -> Dependencia {
    let Some(caminho) = caminho else {
        return dependencia(NomeDaDependencia::Ffmpeg, Situacao::Ausente);
    };
    let Some(versao) = saida(caminho, &["-version"]) else {
        return dependencia(NomeDaDependencia::Ffmpeg, Situacao::Ausente);
    };
    let encoders = saida(caminho, &["-hide_banner", "-encoders"]).unwrap_or_default();
    let filtros = saida(caminho, &["-hide_banner", "-filters"]).unwrap_or_default();
    let faltam: Vec<String> = ENCODERS
        .iter()
        .filter(|nome| !lista_tem(&encoders, nome))
        .chain(FILTROS.iter().filter(|nome| !lista_tem(&filtros, nome)))
        .map(|nome| (*nome).to_owned())
        .collect();
    let situacao = if faltam.is_empty() {
        Situacao::Presente {
            versao: versao.lines().next().map(versao_da_linha),
        }
    } else {
        Situacao::Incompleta { faltam }
    };
    dependencia(NomeDaDependencia::Ffmpeg, situacao)
}

/// A listagem de `-encoders` ou `-filters` tem `nome` numa coluna (as de cima são flags).
fn lista_tem(listagem: &str, nome: &str) -> bool {
    listagem
        .lines()
        .any(|linha| linha.split_whitespace().nth(1) == Some(nome))
}

fn saida(caminho: &Path, args: &[&str]) -> Option<String> {
    let mut comando = crate::process::comando(caminho);
    comando.args(args);
    let saida = comando.output().ok()?;
    saida
        .status
        .success()
        .then(|| String::from_utf8_lossy(&saida.stdout).into_owned())
}

/// Onde o carregador do Vulkan costuma estar, por sistema.
pub(crate) fn candidatos_do_vulkan() -> Vec<PathBuf> {
    if cfg!(windows) {
        let raiz = std::env::var_os("SystemRoot")
            .map_or_else(|| PathBuf::from(r"C:\Windows"), PathBuf::from);
        vec![raiz.join("System32").join("vulkan-1.dll")]
    } else if cfg!(target_os = "macos") {
        Vec::new()
    } else {
        [
            "/usr/lib",
            "/usr/lib64",
            "/usr/lib/x86_64-linux-gnu",
            "/lib/x86_64-linux-gnu",
            "/usr/local/lib",
        ]
        .into_iter()
        .map(|pasta| PathBuf::from(pasta).join("libvulkan.so.1"))
        .collect()
    }
}

/// Vulkan quando há o whisper-cli de Vulkan e o carregador do driver; senão, só CPU.
pub(crate) fn gpu(whisper_vulkan: bool, carregadores: &[PathBuf]) -> Gpu {
    if whisper_vulkan && carregadores.iter().any(|caminho| caminho.is_file()) {
        Gpu::Vulkan
    } else {
        Gpu::SoCpu
    }
}
