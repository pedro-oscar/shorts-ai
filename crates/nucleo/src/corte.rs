//! O corte horizontal (ADR 0005, ADR 0006): cada trecho vira um ffmpeg próprio, com tone-map
//! de HDR, escala, fade de áudio e correção de cor; os trechos se juntam sem recodificar e
//! o áudio é normalizado em dois passes. O ffmpeg é um processo separado, chamado só por
//! linha de comando.

use std::ffi::OsString;
use std::fmt::Write as _;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;

use serde::Deserialize;

use crate::process::{self, Interrupted, Output, Stream};

/// O lado maior do vídeo horizontal.
const LADO_MAIOR: u32 = 1920;
/// O fade de entrada e de saída do áudio de cada trecho, que evita estalos na emenda.
const FADE_DO_AUDIO: f64 = 0.03;
/// Quantos quadros por segundo a medição de cor olha.
const AMOSTRAS_POR_SEGUNDO: u32 = 2;
/// O ajuste de cor nunca passa de 8% para cada lado.
const AJUSTE_MAXIMO: f64 = 0.08;
const ALVO_LUFS: f64 = -14.0;
const PICO_MAXIMO_DBTP: f64 = -1.0;
const FAIXA_LRA: f64 = 11.0;

/// Um intervalo do vídeo original, em segundos.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Trecho {
    pub inicio: f64,
    pub fim: f64,
}

impl Trecho {
    fn duracao(self) -> f64 {
        self.fim - self.inicio
    }
}

/// O que o ffprobe diz do vídeo e importa para o corte.
#[derive(Debug, Clone, PartialEq)]
pub struct InfoDoVideo {
    pub largura: u32,
    pub altura: u32,
    /// Rotação de exibição em graus (0, 90, 180 ou 270).
    pub rotacao: u32,
    pub hdr: bool,
}

#[derive(Deserialize)]
struct SondaJson {
    #[serde(default)]
    streams: Vec<SondaStream>,
}

#[derive(Deserialize)]
struct SondaStream {
    width: Option<u32>,
    height: Option<u32>,
    color_transfer: Option<String>,
    #[serde(default)]
    tags: SondaTags,
    #[serde(default)]
    side_data_list: Vec<SondaSideData>,
}

#[derive(Deserialize, Default)]
struct SondaTags {
    rotate: Option<String>,
}

#[derive(Deserialize)]
struct SondaSideData {
    rotation: Option<f64>,
}

impl InfoDoVideo {
    /// Lê a saída `-print_format json -show_streams` do ffprobe para o primeiro vídeo.
    pub fn de_ffprobe(json: &str) -> Option<Self> {
        let sonda: SondaJson = serde_json::from_str(json).ok()?;
        let stream = sonda
            .streams
            .into_iter()
            .find(|s| s.width.is_some() && s.height.is_some())?;
        let graus = stream
            .side_data_list
            .iter()
            .find_map(|d| d.rotation)
            .or_else(|| stream.tags.rotate.as_deref()?.parse().ok())
            .unwrap_or(0.0);
        let hdr = matches!(
            stream.color_transfer.as_deref(),
            Some("smpte2084" | "arib-std-b67")
        );
        Some(Self {
            largura: stream.width?,
            altura: stream.height?,
            rotacao: (graus.round().rem_euclid(360.0) as u32 / 90) * 90,
            hdr,
        })
    }

    /// O ffmpeg gira o quadro antes dos filtros, então a escala olha as dimensões já giradas.
    fn horizontal(&self) -> bool {
        let (largura, altura) = if self.rotacao % 180 == 90 {
            (self.altura, self.largura)
        } else {
            (self.largura, self.altura)
        };
        largura >= altura
    }
}

/// As médias que o `signalstats` mede num trecho.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Estatisticas {
    /// Luma média, de 0 a 255.
    pub luma_media: f64,
    /// Distância média entre o luma mais escuro e o mais claro de cada quadro.
    pub faixa_de_luma: f64,
    /// Saturação média.
    pub saturacao_media: f64,
}

impl Estatisticas {
    /// Lê a saída do `metadata=print` depois do `signalstats`; `None` sem quadros medidos.
    pub fn de_saida(texto: &str) -> Option<Self> {
        let mut yavg = Media::default();
        let mut ylow = Media::default();
        let mut yhigh = Media::default();
        let mut satavg = Media::default();
        for linha in texto.lines() {
            let Some((chave, valor)) = linha.trim().split_once('=') else {
                continue;
            };
            let Ok(valor) = valor.parse::<f64>() else {
                continue;
            };
            match chave {
                "lavfi.signalstats.YAVG" => yavg.somar(valor),
                "lavfi.signalstats.YLOW" => ylow.somar(valor),
                "lavfi.signalstats.YHIGH" => yhigh.somar(valor),
                "lavfi.signalstats.SATAVG" => satavg.somar(valor),
                _ => {}
            }
        }
        Some(Self {
            luma_media: yavg.valor()?,
            faixa_de_luma: yhigh.valor()? - ylow.valor()?,
            saturacao_media: satavg.valor()?,
        })
    }
}

#[derive(Default)]
struct Media {
    soma: f64,
    quantidade: u32,
}

impl Media {
    fn somar(&mut self, valor: f64) {
        self.soma += valor;
        self.quantidade += 1;
    }

    fn valor(&self) -> Option<f64> {
        (self.quantidade > 0).then(|| self.soma / f64::from(self.quantidade))
    }
}

/// Os parâmetros do filtro `eq`; 1,0 não muda nada.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AjusteDeCor {
    pub contraste: f64,
    pub gama: f64,
    pub saturacao: f64,
}

impl AjusteDeCor {
    pub fn filtro(&self) -> String {
        format!(
            "eq=contrast={:.3}:gamma={:.3}:saturation={:.3}",
            self.contraste, self.gama, self.saturacao
        )
    }
}

/// As regras de limiar: levanta o trecho escuro, escurece o muito claro, abre o contraste de
/// quem tem a faixa de luma curta e acerta a saturação nos extremos. Cada parâmetro cresce
/// com a distância até o limiar e para em [`AJUSTE_MAXIMO`]. `None` quando nada precisa mudar.
pub fn ajuste_de_cor(estatisticas: &Estatisticas) -> Option<AjusteDeCor> {
    let limitar = |delta: f64| 1.0 + delta.clamp(-AJUSTE_MAXIMO, AJUSTE_MAXIMO);
    let contraste = if estatisticas.faixa_de_luma < 200.0 {
        limitar((200.0 - estatisticas.faixa_de_luma) / 200.0 * 0.4)
    } else {
        1.0
    };
    let gama = if estatisticas.luma_media < 100.0 {
        limitar((100.0 - estatisticas.luma_media) / 100.0 * 0.4)
    } else if estatisticas.luma_media > 170.0 {
        limitar(-(estatisticas.luma_media - 170.0) / 85.0 * 0.4)
    } else {
        1.0
    };
    let saturacao = if estatisticas.saturacao_media < 30.0 {
        limitar((30.0 - estatisticas.saturacao_media) / 30.0 * 0.4)
    } else if estatisticas.saturacao_media > 90.0 {
        limitar(-(estatisticas.saturacao_media - 90.0) / 90.0 * 0.4)
    } else {
        1.0
    };
    let ajuste = AjusteDeCor {
        contraste,
        gama,
        saturacao,
    };
    (ajuste
        != AjusteDeCor {
            contraste: 1.0,
            gama: 1.0,
            saturacao: 1.0,
        })
    .then_some(ajuste)
}

/// O que o primeiro passe do `loudnorm` mediu, em texto como o ffmpeg o imprime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MedicaoDeLoudness {
    input_i: String,
    input_tp: String,
    input_lra: String,
    input_thresh: String,
    target_offset: String,
}

#[derive(Deserialize)]
struct LoudnormJson {
    input_i: String,
    input_tp: String,
    input_lra: String,
    input_thresh: String,
    target_offset: String,
}

impl MedicaoDeLoudness {
    /// Acha o bloco JSON no fim do stderr do ffmpeg. `None` se não houver, ou se a medição for
    /// `-inf` (áudio mudo), que o segundo passe não aceita.
    pub fn de_saida(stderr: &str) -> Option<Self> {
        let fim = stderr.rfind('}')?;
        let inicio = stderr[..fim].rfind('{')?;
        let json: LoudnormJson = serde_json::from_str(&stderr[inicio..=fim]).ok()?;
        let valores = [
            &json.input_i,
            &json.input_tp,
            &json.input_lra,
            &json.input_thresh,
            &json.target_offset,
        ];
        if !valores
            .iter()
            .all(|v| v.parse::<f64>().is_ok_and(f64::is_finite))
        {
            return None;
        }
        Some(Self {
            input_i: json.input_i,
            input_tp: json.input_tp,
            input_lra: json.input_lra,
            input_thresh: json.input_thresh,
            target_offset: json.target_offset,
        })
    }

    /// O filtro do segundo passe, linear, com a medição do primeiro.
    pub fn filtro_do_segundo_passe(&self) -> String {
        format!(
            "{}:measured_I={}:measured_TP={}:measured_LRA={}:measured_thresh={}:offset={}:linear=true",
            filtro_base_do_loudnorm(),
            self.input_i,
            self.input_tp,
            self.input_lra,
            self.input_thresh,
            self.target_offset
        )
    }
}

fn filtro_base_do_loudnorm() -> String {
    format!("loudnorm=I={ALVO_LUFS}:TP={PICO_MAXIMO_DBTP}:LRA={FAIXA_LRA}")
}

const TONE_MAP: &str = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv";

/// A cadeia de filtros de vídeo de um trecho.
pub fn filtro_de_video(info: &InfoDoVideo, cor: Option<&AjusteDeCor>) -> String {
    let mut filtros = Vec::new();
    if info.hdr {
        filtros.push(TONE_MAP.to_owned());
    }
    filtros.push(if info.horizontal() {
        format!("scale={LADO_MAIOR}:-2")
    } else {
        format!("scale=-2:{LADO_MAIOR}")
    });
    if let Some(cor) = cor {
        filtros.push(cor.filtro());
    }
    filtros.push("format=yuv420p".to_owned());
    filtros.join(",")
}

/// Fade de 30 ms na entrada e na saída do trecho.
pub fn filtro_de_audio(duracao: f64) -> String {
    let saida = (duracao - FADE_DO_AUDIO).max(0.0);
    format!("afade=t=in:d={FADE_DO_AUDIO},afade=t=out:st={saida:.3}:d={FADE_DO_AUDIO}")
}

#[derive(Debug, thiserror::Error)]
pub enum ErroDoCorte {
    #[error("corte cancelado")]
    Cancelado,
    #[error("o corte não tem trechos")]
    SemTrechos,
    #[error("não foi possível ler o vídeo: {0}")]
    VideoIlegivel(String),
    #[error("{programa} falhou: {detalhe}")]
    Falhou {
        programa: &'static str,
        detalhe: String,
    },
    #[error(transparent)]
    Io(#[from] io::Error),
}

impl From<Interrupted> for ErroDoCorte {
    fn from(interrupted: Interrupted) -> Self {
        match interrupted {
            Interrupted::Cancelled => Self::Cancelado,
            Interrupted::Io(error) => Self::Io(error),
        }
    }
}

/// Roda o comando, passando as linhas do stdout a `por_linha`.
fn executar(
    comando: Command,
    cancelar: &AtomicBool,
    por_linha: &mut dyn FnMut(&str),
) -> Result<Output, ErroDoCorte> {
    Ok(process::run(comando, cancelar, &mut |stream, linha| {
        if stream == Stream::Stdout {
            por_linha(linha);
        }
    })?)
}

/// Os programas do corte, por caminho configurável.
pub struct Ffmpeg {
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
    /// As threads da codificação de cada trecho: um quarto das da máquina, porque o corte do
    /// reel seguinte roda junto com o render do atual.
    threads: usize,
}

impl Ffmpeg {
    pub fn new(ffmpeg: PathBuf, ffprobe: PathBuf) -> Self {
        Self {
            ffmpeg,
            ffprobe,
            threads: (crate::nucleos() / 4).max(2),
        }
    }

    /// Monta o vídeo horizontal do corte em `saida`. `progresso` recebe a fração (0 a 1) já
    /// pronta; ligar `cancelar` mata o ffmpeg em curso. Os intermediários ficam em
    /// `pasta_de_trabalho`.
    pub fn montar(
        &self,
        origem: &Path,
        trechos: &[Trecho],
        saida: &Path,
        pasta_de_trabalho: &Path,
        cancelar: &AtomicBool,
        progresso: &mut dyn FnMut(f64),
    ) -> Result<(), ErroDoCorte> {
        if trechos.is_empty() {
            return Err(ErroDoCorte::SemTrechos);
        }
        fs::create_dir_all(pasta_de_trabalho)?;
        let info = self.sondar(origem, cancelar)?;
        let total: f64 = trechos.iter().map(|t| t.duracao()).sum();
        // Cada trecho vale a parte dele da duração; a normalização fica com os 10% finais.
        let peso_dos_trechos = 0.9;
        let mut feito = 0.0;
        let mut lista = String::new();
        for (indice, trecho) in trechos.iter().enumerate() {
            let cor = self.medir_cor(origem, &info, *trecho, cancelar)?;
            let arquivo = pasta_de_trabalho.join(format!("trecho-{indice:02}.mp4"));
            let base = feito;
            self.codificar_trecho(
                origem,
                &info,
                *trecho,
                cor.as_ref(),
                &arquivo,
                cancelar,
                &mut |f| {
                    progresso(peso_dos_trechos * (base + f * trecho.duracao()) / total);
                },
            )?;
            feito += trecho.duracao();
            let _ = writeln!(lista, "file '{}'", escapar(&arquivo));
        }
        let arquivo_da_lista = pasta_de_trabalho.join("trechos.txt");
        fs::write(&arquivo_da_lista, lista)?;
        let juntado = pasta_de_trabalho.join("juntado.mp4");
        self.executar_ffmpeg(
            &[
                "-y".into(),
                "-f".into(),
                "concat".into(),
                "-safe".into(),
                "0".into(),
                "-i".into(),
                arquivo_da_lista.into(),
                "-c".into(),
                "copy".into(),
                juntado.clone().into(),
            ],
            cancelar,
            &mut |_| {},
        )?;
        progresso(peso_dos_trechos);
        self.normalizar(&juntado, saida, cancelar)?;
        progresso(1.0);
        Ok(())
    }

    pub(crate) fn caminho_do_ffmpeg(&self) -> &Path {
        &self.ffmpeg
    }

    /// A duração do arquivo em segundos, pelo ffprobe.
    pub(crate) fn duracao(&self, origem: &Path, cancelar: &AtomicBool) -> Result<f64, ErroDoCorte> {
        let mut comando = crate::process::comando(&self.ffprobe);
        comando
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
            ])
            .arg(origem);
        let saida = executar(comando, cancelar, &mut |_| {})?;
        if let Some(erro) = saida.erro("ffprobe") {
            return Err(erro);
        }
        saida
            .stdout
            .first()
            .and_then(|linha| linha.trim().parse().ok())
            .ok_or_else(|| ErroDoCorte::VideoIlegivel(origem.display().to_string()))
    }

    pub(crate) fn sondar(
        &self,
        origem: &Path,
        cancelar: &AtomicBool,
    ) -> Result<InfoDoVideo, ErroDoCorte> {
        let mut comando = crate::process::comando(&self.ffprobe);
        comando
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-print_format",
                "json",
                "-show_streams",
            ])
            .arg(origem);
        let saida = executar(comando, cancelar, &mut |_| {})?;
        if let Some(erro) = saida.erro("ffprobe") {
            return Err(erro);
        }
        InfoDoVideo::de_ffprobe(&saida.stdout.join("\n"))
            .ok_or_else(|| ErroDoCorte::VideoIlegivel(origem.display().to_string()))
    }

    fn medir_cor(
        &self,
        origem: &Path,
        info: &InfoDoVideo,
        trecho: Trecho,
        cancelar: &AtomicBool,
    ) -> Result<Option<AjusteDeCor>, ErroDoCorte> {
        let mut filtros = Vec::new();
        if info.hdr {
            filtros.push(TONE_MAP.to_owned());
        }
        filtros.push(format!(
            "fps={AMOSTRAS_POR_SEGUNDO},scale=640:-2,signalstats,metadata=mode=print:file=-"
        ));
        let mut args = entrada_do_trecho(origem, trecho);
        args.extend([
            "-an".into(),
            "-vf".into(),
            filtros.join(",").into(),
            "-f".into(),
            "null".into(),
            "-".into(),
        ]);
        let saida = self.executar_ffmpeg(&args, cancelar, &mut |_| {})?;
        Ok(Estatisticas::de_saida(&saida.stdout.join("\n")).and_then(|e| ajuste_de_cor(&e)))
    }

    #[allow(clippy::too_many_arguments)]
    fn codificar_trecho(
        &self,
        origem: &Path,
        info: &InfoDoVideo,
        trecho: Trecho,
        cor: Option<&AjusteDeCor>,
        arquivo: &Path,
        cancelar: &AtomicBool,
        progresso: &mut dyn FnMut(f64),
    ) -> Result<(), ErroDoCorte> {
        let mut args = vec!["-y".into()];
        args.extend(entrada_do_trecho(origem, trecho));
        args.extend([
            "-vf".into(),
            filtro_de_video(info, cor).into(),
            "-af".into(),
            filtro_de_audio(trecho.duracao()).into(),
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "fast".into(),
            "-crf".into(),
            "18".into(),
            "-threads".into(),
            self.threads.to_string().into(),
            "-c:a".into(),
            "aac".into(),
            "-ar".into(),
            "48000".into(),
            "-b:a".into(),
            "192k".into(),
            "-progress".into(),
            "pipe:1".into(),
            arquivo.into(),
        ]);
        let duracao = trecho.duracao();
        self.executar_ffmpeg(&args, cancelar, &mut |linha| {
            if let Some(micros) = linha
                .strip_prefix("out_time_us=")
                .and_then(|v| v.parse::<f64>().ok())
            {
                progresso((micros / 1e6 / duracao).clamp(0.0, 1.0));
            }
        })?;
        Ok(())
    }

    /// Loudnorm em dois passes; se o primeiro não der medição, um passe só.
    fn normalizar(
        &self,
        entrada: &Path,
        saida: &Path,
        cancelar: &AtomicBool,
    ) -> Result<(), ErroDoCorte> {
        let medicao = self.medir_loudness(entrada, cancelar)?;
        let filtro = medicao.map_or_else(filtro_base_do_loudnorm, |m| m.filtro_do_segundo_passe());
        self.executar_ffmpeg(
            &[
                "-y".into(),
                "-i".into(),
                entrada.into(),
                "-c:v".into(),
                "copy".into(),
                "-af".into(),
                filtro.into(),
                "-c:a".into(),
                "aac".into(),
                "-ar".into(),
                "48000".into(),
                "-b:a".into(),
                "192k".into(),
                saida.into(),
            ],
            cancelar,
            &mut |_| {},
        )?;
        Ok(())
    }

    fn medir_loudness(
        &self,
        entrada: &Path,
        cancelar: &AtomicBool,
    ) -> Result<Option<MedicaoDeLoudness>, ErroDoCorte> {
        let filtro = format!("{}:print_format=json", filtro_base_do_loudnorm());
        let saida = self.executar_ffmpeg(
            &[
                "-i".into(),
                entrada.into(),
                "-vn".into(),
                "-af".into(),
                filtro.into(),
                "-f".into(),
                "null".into(),
                "-".into(),
            ],
            cancelar,
            &mut |_| {},
        );
        match saida {
            Ok(saida) => Ok(MedicaoDeLoudness::de_saida(&saida.stderr)),
            Err(ErroDoCorte::Falhou { .. }) => Ok(None),
            Err(outro) => Err(outro),
        }
    }

    /// Junta em `saida` os quadros do `reel` nos `instantes` (segundos), em grade, cada um com
    /// o tempo marcado. Se o ffmpeg não souber escrever o tempo (sem fonte), os quadros saem
    /// sem a marca. Os quadros soltos ficam em `pasta_de_trabalho`.
    pub(crate) fn folha(
        &self,
        reel: &Path,
        instantes: &[f64],
        colunas: usize,
        saida: &Path,
        pasta_de_trabalho: &Path,
        cancelar: &AtomicBool,
    ) -> Result<(), ErroDoCorte> {
        fs::create_dir_all(pasta_de_trabalho)?;
        for (indice, instante) in instantes.iter().enumerate() {
            let quadro = pasta_de_trabalho.join(format!("quadro-{indice:02}.png"));
            let marca = format!(
                "scale=-2:480,drawtext=text='{instante:.2}s':x=10:y=10:fontsize=34:\
                 fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6"
            );
            let mut resultado = Ok(());
            for filtro in [marca.as_str(), "scale=-2:480"] {
                resultado = self
                    .executar_ffmpeg(
                        &[
                            "-y".into(),
                            "-ss".into(),
                            format!("{instante:.3}").into(),
                            "-i".into(),
                            reel.into(),
                            "-frames:v".into(),
                            "1".into(),
                            "-vf".into(),
                            filtro.into(),
                            quadro.clone().into(),
                        ],
                        cancelar,
                        &mut |_| {},
                    )
                    .map(|_| ());
                if !matches!(resultado, Err(ErroDoCorte::Falhou { .. })) {
                    break;
                }
            }
            resultado?;
        }
        let linhas = instantes.len().div_ceil(colunas.max(1));
        self.executar_ffmpeg(
            &[
                "-y".into(),
                "-framerate".into(),
                "1".into(),
                "-i".into(),
                pasta_de_trabalho.join("quadro-%02d.png").into(),
                "-vf".into(),
                format!("tile={colunas}x{linhas}:padding=4:color=black").into(),
                "-frames:v".into(),
                "1".into(),
                saida.into(),
            ],
            cancelar,
            &mut |_| {},
        )?;
        Ok(())
    }

    fn executar_ffmpeg(
        &self,
        args: &[OsString],
        cancelar: &AtomicBool,
        por_linha: &mut dyn FnMut(&str),
    ) -> Result<Output, ErroDoCorte> {
        let mut comando = crate::process::comando_em_segundo_plano(&self.ffmpeg);
        comando
            .args(["-hide_banner", "-nostats", "-v", "info"])
            .args(args);
        let saida = executar(comando, cancelar, por_linha)?;
        match saida.erro("ffmpeg") {
            Some(erro) => Err(erro),
            None => Ok(saida),
        }
    }
}

/// `-ss` e `-t` antes do `-i` procuram o trecho direto no arquivo.
fn entrada_do_trecho(origem: &Path, trecho: Trecho) -> Vec<OsString> {
    vec![
        "-ss".into(),
        format!("{:.3}", trecho.inicio).into(),
        "-t".into(),
        format!("{:.3}", trecho.duracao()).into(),
        "-i".into(),
        origem.into(),
    ]
}

fn escapar(caminho: &Path) -> String {
    caminho.display().to_string().replace('\'', "'\\''")
}

impl Output {
    fn erro(&self, programa: &'static str) -> Option<ErroDoCorte> {
        (!self.status.success()).then(|| ErroDoCorte::Falhou {
            programa,
            detalhe: self.last_stderr_line().to_owned(),
        })
    }
}
