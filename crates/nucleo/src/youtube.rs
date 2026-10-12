//! Links do YouTube: o endereço aceito e o `yt-dlp` que consulta e baixa o vídeo.

use std::path::{MAIN_SEPARATOR, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Once};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::process::{self, Stream};
use crate::projeto::Faixa;

/// O nome do vídeo baixado em `bruto/`; o título fica no projeto, fora do caminho.
pub(crate) const NOME_DO_ARQUIVO: &str = "video.mp4";

/// H.264 até 1080p mais áudio m4a, ou um MP4 já pronto com esses mesmos limites.
const FORMATO: &str =
    "bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[vcodec^=avc1][height<=1080][ext=mp4]";

const PREFIXO_DO_PROGRESSO: &str = "SHORTS-PROGRESSO ";

/// O que o YouTube diz de um vídeo antes de baixá-lo.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InfoDoLink {
    /// O endereço no formato canônico, `https://www.youtube.com/watch?v=<id>`.
    pub url: String,
    pub titulo: String,
    pub canal: String,
    /// `None` numa live em andamento.
    pub duracao_em_segundos: Option<f64>,
}

/// Um link do lote, como a pessoa o viu e confirmou no passo Vídeos.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinkDoLote {
    pub url: String,
    pub titulo: String,
    pub canal: String,
    /// A pessoa marcou "Tenho direito de uso deste vídeo".
    pub direito_de_uso: bool,
    /// Só esta seção do vídeo é baixada.
    pub faixa: Option<Faixa>,
}

/// O endereço de um vídeo do YouTube (`youtube.com/watch`, `youtu.be`, `/shorts` ou `/live`)
/// no formato canônico, sem lista de reprodução nem outros parâmetros; `None` para o resto.
pub(crate) fn normalizar_url(url: &str) -> Option<String> {
    let url = url.trim();
    let resto = ["https://", "http://"].iter().find_map(|esquema| {
        url.get(..esquema.len())
            .filter(|inicio| inicio.eq_ignore_ascii_case(esquema))
            .map(|_| &url[esquema.len()..])
    })?;
    let (host, caminho) = resto.split('#').next()?.split_once('/')?;
    let host = host.to_ascii_lowercase();
    let (caminho, consulta) = caminho.split_once('?').unwrap_or((caminho, ""));
    let id = match host.as_str() {
        "youtu.be" => caminho.trim_end_matches('/'),
        "youtube.com" | "www.youtube.com" | "m.youtube.com" => {
            let caminho = caminho.trim_end_matches('/');
            if caminho == "watch" {
                consulta.split('&').find_map(|par| par.strip_prefix("v="))?
            } else {
                caminho
                    .strip_prefix("shorts/")
                    .or_else(|| caminho.strip_prefix("live/"))?
            }
        }
        _ => return None,
    };
    let valido = id.len() == 11
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    valido.then(|| format!("https://www.youtube.com/watch?v={id}"))
}

/// O `yt-dlp` que vai com o app. Ele se atualiza (`-U`) na primeira vez em que é usado.
#[derive(Clone)]
pub(crate) struct Ytdlp {
    programa: PathBuf,
    /// O Node, que o `yt-dlp` usa como runtime de JavaScript para resolver os desafios do
    /// YouTube; consultado a cada uso, porque o Node portátil pode ser instalado depois.
    node: Arc<dyn Fn() -> Option<PathBuf> + Send + Sync>,
    atualizado: Arc<Once>,
}

impl Ytdlp {
    pub fn new(programa: PathBuf, node: Arc<dyn Fn() -> Option<PathBuf> + Send + Sync>) -> Self {
        Self {
            programa,
            node,
            atualizado: Arc::new(Once::new()),
        }
    }

    /// Título, canal e duração do vídeo, sem baixá-lo.
    pub fn consultar(&self, url: &str) -> Result<InfoDoLink, String> {
        self.atualizar();
        let mut command = self.comando();
        command
            .args([
                "--skip-download",
                "--print",
                "%(.{title,channel,duration})j",
            ])
            .args(["--", url]);
        let saida = process::run(command, &AtomicBool::new(false), &mut |_, _| {})
            .map_err(|error| self.nao_rodou(&error))?;
        if !saida.status.success() {
            return Err(saida.last_stderr_line().to_owned());
        }
        let linha = saida
            .stdout
            .iter()
            .rev()
            .find(|linha| linha.trim_start().starts_with('{'))
            .ok_or("o yt-dlp não informou o vídeo")?;
        let dados: serde_json::Value = serde_json::from_str(linha).map_err(|e| e.to_string())?;
        let texto = |campo: &str| dados[campo].as_str().unwrap_or_default().trim().to_owned();
        Ok(InfoDoLink {
            url: url.to_owned(),
            titulo: texto("title"),
            canal: texto("channel"),
            duracao_em_segundos: dados["duration"].as_f64(),
        })
    }

    /// Baixa o vídeo para `pasta/video.mp4`, avisando o percentual (0 a 100) de cada
    /// arquivo que o `yt-dlp` baixa. Com `faixa`, baixa só a seção, cortando nos keyframes.
    pub fn baixar(
        &self,
        url: &str,
        faixa: Option<Faixa>,
        pasta: &Path,
        progresso: &mut dyn FnMut(u8),
    ) -> Result<PathBuf, String> {
        self.atualizar();
        let destino = pasta.join(NOME_DO_ARQUIVO);
        let mut command = self.comando();
        command
            .args(["-f", FORMATO, "--merge-output-format", "mp4", "--newline"])
            .args([
                "--progress-template",
                &format!("download:{PREFIXO_DO_PROGRESSO}%(progress._percent_str)s"),
            ])
            .arg("-o")
            .arg(format!(
                "{}{MAIN_SEPARATOR}video.%(ext)s",
                // Num caminho com `%`, o modelo de saída do yt-dlp o leria como campo.
                pasta.display().to_string().replace('%', "%%")
            ));
        if let Some(faixa) = faixa {
            command.args(["--download-sections", &secao(faixa)]);
        }
        command.args(["--", url]);
        let mut ultimo = None;
        let saida = process::run(command, &AtomicBool::new(false), &mut |stream, linha| {
            if stream != Stream::Stdout {
                return;
            }
            let Some(texto) = linha.trim().strip_prefix(PREFIXO_DO_PROGRESSO) else {
                return;
            };
            if let Ok(percentual) = texto.trim().trim_end_matches('%').trim().parse::<f64>() {
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let percentual = percentual.floor().clamp(0.0, 100.0) as u8;
                if ultimo.is_none_or(|anterior| percentual > anterior) {
                    ultimo = Some(percentual);
                    progresso(percentual);
                }
            }
        })
        .map_err(|error| self.nao_rodou(&error))?;
        if !saida.status.success() {
            return Err(saida.last_stderr_line().to_owned());
        }
        if destino.is_file() {
            Ok(destino)
        } else {
            Err(format!("o yt-dlp não deixou {NOME_DO_ARQUIVO} em bruto/"))
        }
    }

    /// `yt-dlp -U`, uma vez por execução do app. Quem não pode se atualizar (sem rede ou sem
    /// permissão na pasta) segue com a versão que tem.
    fn atualizar(&self) {
        self.atualizado.call_once(|| {
            let mut command = Command::new(&self.programa);
            command.arg("-U");
            let _ = process::run(command, &AtomicBool::new(false), &mut |_, _| {});
        });
    }

    fn comando(&self) -> Command {
        let mut command = Command::new(&self.programa);
        command.args(["--no-playlist", "--no-warnings"]);
        if let Some(node) = (self.node)() {
            command.arg("--js-runtimes");
            command.arg(format!("node:{}", node.display()));
        }
        command
    }

    fn nao_rodou(&self, error: &process::Interrupted) -> String {
        match error {
            process::Interrupted::Cancelled => "cancelado".to_owned(),
            process::Interrupted::Io(error) => {
                format!("{} não rodou: {error}", self.programa.display())
            }
        }
    }
}

/// `*início-fim` em segundos, o formato do `--download-sections`; sem fim, vai até o fim.
fn secao(faixa: Faixa) -> String {
    let fim = faixa
        .fim
        .map_or_else(|| "inf".to_owned(), |fim| fim.to_string());
    format!("*{}-{fim}", faixa.inicio)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CANONICA: &str = "https://www.youtube.com/watch?v=KGfmaHnBQx4";

    #[test]
    fn aceita_watch_youtu_be_shorts_e_live() {
        for url in [
            "https://www.youtube.com/watch?v=KGfmaHnBQx4",
            "  https://youtube.com/watch?list=PL1&v=KGfmaHnBQx4&t=30s ",
            "http://m.youtube.com/watch?v=KGfmaHnBQx4#x",
            "https://youtu.be/KGfmaHnBQx4?si=abc",
            "https://www.youtube.com/shorts/KGfmaHnBQx4",
            "https://www.youtube.com/live/KGfmaHnBQx4/",
            "HTTPS://WWW.YOUTUBE.COM/watch?v=KGfmaHnBQx4",
        ] {
            assert_eq!(normalizar_url(url).as_deref(), Some(CANONICA), "{url}");
        }
    }

    #[test]
    fn recusa_o_que_nao_e_um_video_do_youtube() {
        for url in [
            "",
            "KGfmaHnBQx4",
            "https://vimeo.com/123456789",
            "https://youtube.com.evil.example/watch?v=KGfmaHnBQx4",
            "https://www.youtube.com/playlist?list=PL1",
            "https://www.youtube.com/@canal",
            "https://www.youtube.com/watch",
            "https://www.youtube.com/watch?v=curto",
            "https://youtu.be/",
            "ftp://youtu.be/KGfmaHnBQx4",
            "--exec=rm https://youtu.be/KGfmaHnBQx4",
        ] {
            assert_eq!(normalizar_url(url), None, "{url}");
        }
    }
}
