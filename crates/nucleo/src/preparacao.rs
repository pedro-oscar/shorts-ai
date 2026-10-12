//! A preparação da primeira execução: o que o app baixa sozinho (o Node portátil, as
//! dependências do Remotion com o Chrome headless e os modelos da Transcrição), onde cada
//! coisa fica e como se baixa.

use std::ffi::OsString;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::process::hide_console;

/// Os pacotes que a preparação garante, na ordem em que são baixados: o Node vem antes porque
/// o `npm` das dependências do Remotion vem com ele.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Pacote {
    NodePortatil,
    DependenciasDoRemotion,
    ModeloDeTranscricao,
}

impl Pacote {
    pub const TODOS: [Self; 3] = [
        Self::NodePortatil,
        Self::DependenciasDoRemotion,
        Self::ModeloDeTranscricao,
    ];

    /// Quanto o pacote ocupa em disco depois de pronto, em MB: uma estimativa, para a
    /// pessoa liberar espaço antes de baixar.
    fn tamanho_estimado_em_mb(self) -> u32 {
        match self {
            Self::NodePortatil => 200,
            Self::DependenciasDoRemotion => 700,
            Self::ModeloDeTranscricao => 1100,
        }
    }
}

/// Um pacote como a tela de preparação o mostra.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PacoteDaPreparacao {
    pub pacote: Pacote,
    /// Já está no computador: não será baixado.
    pub presente: bool,
    /// Em MB (10⁶ bytes), estimado.
    pub tamanho_em_mb: u32,
}

/// O que falta baixar e se há espaço para isso.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EstadoDaPreparacao {
    pub pacotes: Vec<PacoteDaPreparacao>,
    /// Em MB; `None` quando o sistema não informa o espaço livre.
    pub espaco_livre_em_mb: Option<u32>,
    /// Há menos de 20 GB livres: pouco para os renders.
    pub pouco_espaco: bool,
}

impl EstadoDaPreparacao {
    pub fn completa(&self) -> bool {
        self.pacotes.iter().all(|pacote| pacote.presente)
    }
}

/// O espaço livre abaixo do qual a preparação avisa.
const ESPACO_MINIMO: u64 = 20_000_000_000;

pub(crate) fn estado(
    presentes: impl Fn(Pacote) -> bool,
    pasta_dos_dados: &Path,
) -> EstadoDaPreparacao {
    let livre = espaco_livre(pasta_dos_dados);
    EstadoDaPreparacao {
        pacotes: Pacote::TODOS
            .into_iter()
            .map(|pacote| PacoteDaPreparacao {
                pacote,
                presente: presentes(pacote),
                tamanho_em_mb: pacote.tamanho_estimado_em_mb(),
            })
            .collect(),
        espaco_livre_em_mb: livre.map(|bytes| u32::try_from(bytes / 1_000_000).unwrap_or(u32::MAX)),
        pouco_espaco: livre.is_some_and(|bytes| bytes < ESPACO_MINIMO),
    }
}

/// Os bytes livres no disco da pasta. A pasta pode não existir ainda: vale o espaço do disco
/// em que ela vai ficar.
pub(crate) fn espaco_livre(pasta: &Path) -> Option<u64> {
    pasta
        .ancestors()
        .find(|pasta| pasta.is_dir())
        .and_then(|pasta| fs4::available_space(pasta).ok())
}

/// De onde a preparação baixa cada arquivo. Os testes apontam para um servidor local.
#[derive(Debug, Clone)]
pub struct Downloads {
    /// O arquivo (`.tar.gz` ou `.zip`) do Node para este sistema, com `bin/node` ou
    /// `node.exe` dentro de uma pasta única.
    pub node: String,
    pub modelo_whisper: String,
    pub modelo_vad: String,
}

impl Default for Downloads {
    fn default() -> Self {
        const VERSAO_DO_NODE: &str = "v22.22.1";
        let (sistema, extensao) = if cfg!(windows) {
            ("win-x64", "zip")
        } else if cfg!(target_os = "macos") {
            ("darwin-arm64", "tar.gz")
        } else {
            ("linux-x64", "tar.gz")
        };
        Self {
            node: format!(
                "https://nodejs.org/dist/{VERSAO_DO_NODE}/node-{VERSAO_DO_NODE}-{sistema}.{extensao}"
            ),
            modelo_whisper: format!(
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
                crate::transcricao::MODEL_FILE
            ),
            modelo_vad: format!(
                "https://huggingface.co/ggml-org/whisper-vad/resolve/main/{}",
                crate::transcricao::VAD_MODEL_FILE
            ),
        }
    }
}

/// O Node que a preparação extrai nos dados do app.
#[derive(Debug, Clone)]
pub(crate) struct NodePortatil {
    dir: PathBuf,
}

impl NodePortatil {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            dir: app_data_dir.join("node"),
        }
    }

    /// O `node`, se já foi extraído.
    pub fn node(&self) -> Option<PathBuf> {
        let node = if cfg!(windows) {
            self.dir.join("node.exe")
        } else {
            self.dir.join("bin/node")
        };
        node.is_file().then_some(node)
    }

    /// O `npm` que vem com o Node portátil, se já foi extraído.
    pub fn npm(&self) -> Option<PathBuf> {
        self.node()?;
        Some(if cfg!(windows) {
            self.dir.join("npm.cmd")
        } else {
            self.dir.join("bin/npm")
        })
    }

    /// O `PATH` com a pasta do Node portátil na frente, para o `npm` achar o `node` dele.
    pub fn path_com_node(&self, path_env: Option<OsString>) -> Option<OsString> {
        let node = self.node()?;
        let pasta = node.parent()?.to_path_buf();
        let path_env = path_env.or_else(|| std::env::var_os("PATH"));
        let resto = path_env.as_deref().map(std::env::split_paths);
        std::env::join_paths(std::iter::once(pasta).chain(resto.into_iter().flatten())).ok()
    }

    /// Baixa o arquivo do Node e o extrai, tirando a pasta de cima. O `tar` do sistema lê
    /// `.tar.gz` e `.zip` (o do Windows 10 em diante também).
    pub fn instalar(&self, url: &str, progresso: &mut dyn FnMut(u8)) -> Result<(), String> {
        let pasta = self.dir.parent().unwrap_or(&self.dir);
        let arquivo = pasta.join("node-download");
        baixar(url, &arquivo, progresso).map_err(|erro| erro.to_string())?;
        let temporaria = pasta.join("node-extraindo");
        let _ = fs::remove_dir_all(&temporaria);
        let extraido = fs::create_dir_all(&temporaria)
            .map_err(|erro| erro.to_string())
            .and_then(|()| extrair(&arquivo, &temporaria))
            .and_then(|()| {
                let _ = fs::remove_dir_all(&self.dir);
                fs::rename(&temporaria, &self.dir).map_err(|erro| erro.to_string())
            });
        let _ = fs::remove_file(&arquivo);
        let _ = fs::remove_dir_all(&temporaria);
        extraido
    }
}

fn extrair(arquivo: &Path, destino: &Path) -> Result<(), String> {
    let mut comando = Command::new("tar");
    comando
        .arg("-xf")
        .arg(arquivo)
        .arg("-C")
        .arg(destino)
        .arg("--strip-components=1");
    hide_console(&mut comando);
    let saida = comando.output().map_err(|erro| format!("tar: {erro}"))?;
    if saida.status.success() {
        Ok(())
    } else {
        Err(format!(
            "tar: {}",
            String::from_utf8_lossy(&saida.stderr).trim()
        ))
    }
}

/// Baixa `url` para `destino`, passando o percentual a `progresso`. O arquivo só aparece no
/// nome final quando o download termina, então um download interrompido não passa por pronto.
pub(crate) fn baixar(url: &str, destino: &Path, progresso: &mut dyn FnMut(u8)) -> io::Result<()> {
    if let Some(pasta) = destino.parent() {
        fs::create_dir_all(pasta)?;
    }
    let resposta = ureq::get(url).call().map_err(io::Error::other)?;
    let total = resposta.body().content_length();
    let mut leitor = resposta.into_body().into_reader();
    let mut nome = destino.file_name().unwrap_or_default().to_owned();
    nome.push(".parcial");
    let parcial = destino.with_file_name(nome);
    let mut arquivo = fs::File::create(&parcial)?;
    let mut buffer = vec![0; 256 * 1024];
    let mut lidos: u64 = 0;
    let mut ultimo = 0;
    loop {
        let n = leitor.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        arquivo.write_all(&buffer[..n])?;
        lidos += n as u64;
        if let Some(total) = total.filter(|total| *total > 0) {
            let percentual = u8::try_from((lidos * 100 / total).min(100)).unwrap_or(100);
            if percentual != ultimo {
                ultimo = percentual;
                progresso(percentual);
            }
        }
    }
    arquivo.sync_all()?;
    drop(arquivo);
    fs::rename(parcial, destino)
}
