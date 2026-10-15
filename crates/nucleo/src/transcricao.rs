//! A Transcrição (ADR 0005): o áudio sai do vídeo com o ffmpeg, o whisper-cli o transcreve no
//! computador (GPU por Vulkan, CPU como reserva) e o núcleo monta as palavras com o tempo no
//! áudio original. O whisper-cli é um processo separado, chamado só por linha de comando.
//!
//! O contrato com o whisper.cpp é o `-ojf` e a tabela `vad_segment_info` que ele escreve no
//! stderr. O `-ojf` grava os tempos dos tokens no áudio cortado pelo VAD; o núcleo os devolve
//! ao áudio original pela regra de `whisper_map_token_time_segment_aware`, monta as palavras
//! como o `split_tokens_on_spaces` e aplica o pós-processamento do faster-whisper 1.2.1.

use std::ffi::OsString;
use std::fmt::Write as _;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;

use serde::{Deserialize, Serialize};

use crate::files::write_json;
use crate::process::{self, Interrupted, Stream};
use crate::projeto::Faixa;

/// O modelo do Whisper escolhido no spike (ADR 0005), que a preparação baixa.
pub const MODEL_FILE: &str = "ggml-large-v3-q5_0.bin";
/// O modelo do VAD (Silero v6.2.0) no formato do whisper.cpp.
pub const VAD_MODEL_FILE: &str = "ggml-silero-v6.2.0.bin";

/// Primeiro token especial do vocabulário multilíngue do Whisper; abaixo dele, só texto.
const EOT: i64 = 50257;
/// A pontuação ASCII (`string.punctuation` do Python) separa palavras no alinhamento.
const ASCII_PUNCTUATION: &str = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const PREPEND_PUNCTUATIONS: &str = "\"'“¿([{-";
const APPEND_PUNCTUATIONS: &str = "\"'.。,，!！?？:：”)]}、";
const SENTENCE_END: &str = ".。!！?？";
/// Cada palavra dura pelo menos 50 ms.
const DURACAO_MINIMA: f64 = 0.05;
/// Uma pausa de 0,5 s ou mais separa as frases da transcrição compactada.
const PAUSA_ENTRE_FRASES: f64 = 0.5;
/// Quanto áudio a detecção de idioma escuta.
const LANGUAGE_DETECTION_SECONDS: u32 = 30;
/// O áudio de 16 kHz, mono, 16 bits: bytes por segundo.
const WAV_BYTES_PER_SECOND: u64 = 32_000;
/// Um WAV sem amostras tem só o cabeçalho, de 44 bytes.
const WAV_HEADER_BYTES: u64 = 44;
/// De onde, no máximo, a detecção de idioma escuta.
const LANGUAGE_DETECTION_MAX_START: u64 = 120;
/// Os arquivos da pasta de trabalho que o whisper-cli lê e grava, pelo nome (`run_whisper`).
const AUDIO: &str = "audio.wav";
const AMOSTRA: &str = "amostra.wav";
const TRANSCRICAO: &str = "transcricao";
const DETECCAO: &str = "deteccao";

const PROMPT_PT: &str =
    "Ahn, então, tipo... é, hum, né? Aí, tipo assim, eu acho que, hã, a gente... É isso.";
const PROMPT_EN: &str = "Um, so, like... uh, you know? And, like, I think, uh, we... That's it.";

/// Uma palavra da transcrição, em segundos no vídeo original, como o `transcricao.json` a
/// grava.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PalavraTranscrita {
    #[serde(rename = "text")]
    pub texto: String,
    #[serde(rename = "start")]
    pub inicio: f64,
    #[serde(rename = "end")]
    pub fim: f64,
    /// Sempre `word`: o whisper.cpp não separa espaços nem eventos de áudio.
    #[serde(rename = "type")]
    pub tipo: String,
    /// O whisper.cpp não separa falantes: todas as palavras são do `speaker_0`.
    #[serde(rename = "speaker_id")]
    pub falante: String,
    /// A probabilidade média dos tokens da palavra, de 0 a 1.
    #[serde(rename = "logprob")]
    pub probabilidade: f64,
}

/// O resultado da Transcrição.
#[derive(Debug, Clone, PartialEq)]
pub struct Transcricao {
    pub idioma: String,
    pub palavras: Vec<PalavraTranscrita>,
}

/// O que o pedido de uma Transcrição define.
pub struct Pedido<'a> {
    pub video: &'a Path,
    /// A pasta `edit/` do projeto, onde saem `transcricao.json` e a transcrição compactada.
    pub pasta_de_saida: &'a Path,
    /// O idioma definido pelos padrões ou pelas exceções; `None` detecta o idioma do vídeo.
    pub idioma: Option<&'a str>,
    pub nomes_proprios: &'a [String],
    /// Transcreve só esta faixa do vídeo; os tempos das palavras continuam os do vídeo inteiro.
    pub faixa: Option<Faixa>,
}

#[derive(Debug, thiserror::Error)]
pub enum ErroDaTranscricao {
    #[error("transcrição cancelada")]
    Cancelado,
    #[error("{programa} falhou: {detalhe}")]
    Falhou {
        programa: &'static str,
        detalhe: String,
    },
    #[error("a saída do whisper-cli não pôde ser lida: {0}")]
    SaidaIlegivel(String),
    #[error(transparent)]
    Io(#[from] io::Error),
}

/// Os programas e modelos da Transcrição, por caminho configurável.
pub struct Transcritor {
    ffmpeg: PathBuf,
    /// O whisper-cli com Vulkan.
    whisper: PathBuf,
    /// O whisper-cli só de CPU, a reserva de quando o de Vulkan não abre ou falha.
    whisper_cpu: Option<PathBuf>,
    model: PathBuf,
    vad_model: PathBuf,
    threads: u32,
}

impl Transcritor {
    pub fn new(ffmpeg: PathBuf, whisper: PathBuf, model: PathBuf, vad_model: PathBuf) -> Self {
        Self {
            ffmpeg,
            whisper,
            whisper_cpu: None,
            model,
            vad_model,
            threads: std::thread::available_parallelism().map_or(4, |n| n.get().min(8) as u32),
        }
    }

    /// A reserva de CPU: o whisper-cli que roda, com `-ng`, quando o de Vulkan não abre (sem o
    /// driver, por exemplo) ou falha no meio.
    #[must_use]
    pub fn with_cpu_fallback(mut self, whisper_cpu: PathBuf) -> Self {
        self.whisper_cpu = Some(whisper_cpu);
        self
    }

    /// Transcreve o vídeo e grava `transcricao.json` e `transcricao-compactada.txt` em
    /// `pasta_de_saida`. `progresso` recebe a fração (0 a 1); ligar `cancelar` mata o processo
    /// em curso.
    pub fn transcrever(
        &self,
        pedido: &Pedido<'_>,
        cancelar: &AtomicBool,
        progresso: &mut dyn FnMut(f64),
    ) -> Result<Transcricao, ErroDaTranscricao> {
        fs::create_dir_all(pedido.pasta_de_saida)?;
        let work_dir = work_dir(pedido.pasta_de_saida)?;
        let resultado = self.transcrever_em(pedido, &work_dir, cancelar, progresso);
        let _ = fs::remove_dir_all(&work_dir);
        let transcricao = resultado?;
        gravar(pedido.pasta_de_saida, &transcricao)?;
        progresso(1.0);
        Ok(transcricao)
    }

    fn transcrever_em(
        &self,
        pedido: &Pedido<'_>,
        work_dir: &Path,
        cancelar: &AtomicBool,
        progresso: &mut dyn FnMut(f64),
    ) -> Result<Transcricao, ErroDaTranscricao> {
        let audio = work_dir.join(AUDIO);
        self.extract_audio(pedido.video, pedido.faixa, &audio, cancelar)?;
        // Se o Vulkan falha uma vez, o resto desta transcrição vai direto para a CPU.
        let mut cpu_only = false;
        let idioma = match pedido.idioma {
            Some(idioma) => idioma.to_owned(),
            None => self.detectar_idioma(&audio, work_dir, cancelar, &mut cpu_only)?,
        };

        let mut args = vec![
            "-m".to_owned(),
            self.model.display().to_string(),
            "-f".to_owned(),
            AUDIO.to_owned(),
            "-l".to_owned(),
            idioma.clone(),
            "-t".to_owned(),
            self.threads.to_string(),
        ];
        if let Some(prompt) = prompt(&idioma, pedido.nomes_proprios) {
            args.extend([
                "--prompt".to_owned(),
                prompt,
                "--carry-initial-prompt".to_owned(),
            ]);
        }
        args.extend([
            "--vad".to_owned(),
            "-vm".to_owned(),
            self.vad_model.display().to_string(),
            "--vad-min-silence-duration-ms".to_owned(),
            "2000".to_owned(),
            "--vad-speech-pad-ms".to_owned(),
            "400".to_owned(),
            "-ojf".to_owned(),
            "-of".to_owned(),
            TRANSCRICAO.to_owned(),
            "-dtw".to_owned(),
            "large.v3".to_owned(),
            "-nfa".to_owned(),
            "-pp".to_owned(),
        ]);
        let stderr = self.whisper(
            &args,
            work_dir,
            "whisper.txt",
            cancelar,
            &mut cpu_only,
            &mut |line| {
                if let Some(percent) = progress_percent(line) {
                    progresso(percent / 100.0);
                }
            },
        )?;
        let whisper = read_whisper_json(&work_dir.join(TRANSCRICAO))?;
        let vad = vad_segments(&stderr);
        let idioma = whisper.result.language.unwrap_or(idioma);
        let mut palavras = palavras_do_whisper(&whisper.transcription, &vad);
        if let Some(faixa) = pedido.faixa {
            let deslocamento = f64::from(faixa.inicio);
            for palavra in &mut palavras {
                palavra.inicio = round_ms(palavra.inicio + deslocamento);
                palavra.fim = round_ms(palavra.fim + deslocamento);
            }
        }
        Ok(Transcricao { idioma, palavras })
    }

    /// Extrai o áudio (só o da `faixa`, se houver) em 16 kHz mono, o que o whisper.cpp lê.
    fn extract_audio(
        &self,
        video: &Path,
        faixa: Option<Faixa>,
        audio: &Path,
        cancel: &AtomicBool,
    ) -> Result<(), ErroDaTranscricao> {
        let mut args: Vec<OsString> = vec!["-y".into()];
        if let Some(faixa) = faixa {
            args.extend(["-ss".into(), faixa.inicio.to_string().into()]);
            if let Some(duracao) = faixa.duracao() {
                args.extend(["-t".into(), duracao.to_string().into()]);
            }
        }
        args.extend([
            "-i".into(),
            video.into(),
            "-vn".into(),
            "-ac".into(),
            "1".into(),
            "-ar".into(),
            "16000".into(),
            "-c:a".into(),
            "pcm_s16le".into(),
            audio.into(),
        ]);
        self.ffmpeg(args, cancel)
    }

    /// Detecta o idioma numa amostra do áudio, deixando o whisper-cli em `-l auto`.
    fn detectar_idioma(
        &self,
        audio: &Path,
        work_dir: &Path,
        cancelar: &AtomicBool,
        cpu_only: &mut bool,
    ) -> Result<String, ErroDaTranscricao> {
        let size = fs::metadata(audio)?.len();
        let start = (size / WAV_BYTES_PER_SECOND / 3).min(LANGUAGE_DETECTION_MAX_START);
        let sample = work_dir.join(AMOSTRA);
        self.ffmpeg(
            vec![
                "-y".into(),
                "-i".into(),
                audio.into(),
                "-ss".into(),
                start.to_string().into(),
                "-t".into(),
                LANGUAGE_DETECTION_SECONDS.to_string().into(),
                "-c:a".into(),
                "pcm_s16le".into(),
                sample.clone().into(),
            ],
            cancelar,
        )?;
        if fs::metadata(&sample)?.len() <= WAV_HEADER_BYTES {
            return Err(ErroDaTranscricao::Falhou {
                programa: "ffmpeg",
                detalhe: "o trecho de detecção do idioma saiu sem áudio".to_owned(),
            });
        }
        let args = [
            "-m".to_owned(),
            self.model.display().to_string(),
            "-f".to_owned(),
            AMOSTRA.to_owned(),
            "-l".to_owned(),
            "auto".to_owned(),
            "-t".to_owned(),
            self.threads.to_string(),
            "-oj".to_owned(),
            "-of".to_owned(),
            DETECCAO.to_owned(),
        ];
        self.whisper(
            &args,
            work_dir,
            "deteccao.txt",
            cancelar,
            cpu_only,
            &mut |_| {},
        )?;
        read_whisper_json(&work_dir.join(DETECCAO))?
            .result
            .language
            .ok_or_else(|| ErroDaTranscricao::SaidaIlegivel("sem idioma detectado".to_owned()))
    }

    /// Roda o whisper-cli e devolve o stderr dele. Se o de Vulkan não abre ou falha, roda de
    /// novo só na CPU (`-ng`), e liga `cpu_only` para as próximas chamadas. Cancelar não passa
    /// para a CPU.
    fn whisper(
        &self,
        args: &[String],
        work_dir: &Path,
        response_file: &str,
        cancel: &AtomicBool,
        cpu_only: &mut bool,
        on_stderr: &mut dyn FnMut(&str),
    ) -> Result<String, ErroDaTranscricao> {
        let Some(whisper_cpu) = &self.whisper_cpu else {
            return run_whisper(
                &self.whisper,
                args,
                work_dir,
                response_file,
                cancel,
                on_stderr,
            );
        };
        if !*cpu_only {
            match run_whisper(
                &self.whisper,
                args,
                work_dir,
                response_file,
                cancel,
                on_stderr,
            ) {
                Err(ErroDaTranscricao::Cancelado) => return Err(ErroDaTranscricao::Cancelado),
                Err(_) => *cpu_only = true,
                stderr => return stderr,
            }
        }
        let args = [args, &["-ng".to_owned()]].concat();
        run_whisper(
            whisper_cpu,
            &args,
            work_dir,
            response_file,
            cancel,
            on_stderr,
        )
    }

    fn ffmpeg(&self, args: Vec<OsString>, cancel: &AtomicBool) -> Result<(), ErroDaTranscricao> {
        let mut command = Command::new(&self.ffmpeg);
        command
            .args(["-hide_banner", "-nostats", "-v", "error"])
            .args(args);
        run_program("ffmpeg", command, cancel, &mut |_, _| {}).map(drop)
    }
}

/// Um whisper-cli com os argumentos num arquivo de resposta, rodando na pasta de trabalho. No
/// Windows ele lê o argv na página de código do sistema, e o arquivo, em UTF-8, preserva os
/// acentos do prompt. Os caminhos, porém, ele confere na página de código: um em UTF-8 com
/// acento não é achado. Por isso os arquivos de trabalho vão pelo nome, relativo à pasta, e o
/// título do vídeo no nome do projeto não chega ao whisper-cli. Os modelos, a biblioteca abre
/// em UTF-8 e o cli confere na página de código, então só funcionam num caminho ASCII.
fn run_whisper(
    program: &Path,
    args: &[String],
    work_dir: &Path,
    response_file: &str,
    cancel: &AtomicBool,
    on_stderr: &mut dyn FnMut(&str),
) -> Result<String, ErroDaTranscricao> {
    fs::write(work_dir.join(response_file), args.join("\n"))?;
    let mut command = Command::new(program);
    command
        .current_dir(work_dir)
        .arg(format!("@{response_file}"));
    run_program("whisper-cli", command, cancel, &mut |stream, line| {
        if stream == Stream::Stderr {
            on_stderr(line);
        }
    })
}

/// Roda um programa da Transcrição e devolve o stderr dele. Um programa que não está onde
/// devia vira falha com o caminho em que foi procurado.
fn run_program(
    name: &'static str,
    command: Command,
    cancel: &AtomicBool,
    on_line: &mut dyn FnMut(Stream, &str),
) -> Result<String, ErroDaTranscricao> {
    let program = PathBuf::from(command.get_program());
    let output =
        process::run(command, cancel, on_line).map_err(|interrupted| match interrupted {
            Interrupted::Cancelled => ErroDaTranscricao::Cancelado,
            Interrupted::Io(error) if error.kind() == io::ErrorKind::NotFound => {
                ErroDaTranscricao::Falhou {
                    programa: name,
                    detalhe: format!("não encontrado em {}", program.display()),
                }
            }
            Interrupted::Io(error) => ErroDaTranscricao::Io(error),
        })?;
    if output.status.success() {
        Ok(output.stderr)
    } else {
        Err(ErroDaTranscricao::Falhou {
            programa: name,
            detalhe: reason(&output).to_owned(),
        })
    }
}

/// Por que o programa falhou. O whisper-cli diz numa linha `error: …` e, quando não acha um
/// arquivo, imprime a ajuda depois dela; sem essa linha, vale a última do stderr.
fn reason(output: &process::Output) -> &str {
    output
        .stderr
        .lines()
        .find(|line| line.starts_with("error: "))
        .unwrap_or_else(|| output.last_stderr_line())
}

/// Lê o JSON que o whisper-cli gravou em `<base>.json`.
fn read_whisper_json(base: &Path) -> Result<WhisperOutput, ErroDaTranscricao> {
    let unreadable =
        |error: &dyn std::fmt::Display| ErroDaTranscricao::SaidaIlegivel(error.to_string());
    let json = fs::read_to_string(base.with_extension("json")).map_err(|e| unreadable(&e))?;
    serde_json::from_str(&json).map_err(|e| unreadable(&e))
}

/// Uma pasta de trabalho só desta transcrição, dentro de `base`.
fn work_dir(base: &Path) -> io::Result<PathBuf> {
    let dir = base.join(".transcricao");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// O prompt "verbatim" no idioma do vídeo (pt e en) mais os nomes próprios; nos outros
/// idiomas, só os nomes.
pub fn prompt(idioma: &str, nomes_proprios: &[String]) -> Option<String> {
    let base = match idioma {
        "pt" => Some(PROMPT_PT),
        "en" => Some(PROMPT_EN),
        _ => None,
    };
    let nomes = nomes_proprios
        .iter()
        .map(|nome| nome.trim())
        .filter(|nome| !nome.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    match (base, nomes.is_empty()) {
        (Some(base), true) => Some(base.to_owned()),
        (Some(base), false) => Some(format!("{base} {nomes}")),
        (None, false) => Some(nomes),
        (None, true) => None,
    }
}

/// A porcentagem de uma linha `whisper_print_progress_callback: progress =  10%`.
pub fn progress_percent(line: &str) -> Option<f64> {
    let rest = line.split("progress =").nth(1)?;
    rest.trim().strip_suffix('%')?.trim().parse().ok()
}

// ------------------------------------------------------------------ saída do whisper-cli

#[derive(Deserialize)]
struct WhisperOutput {
    #[serde(default)]
    result: WhisperResult,
    #[serde(default)]
    transcription: Vec<WhisperSegment>,
}

#[derive(Deserialize, Default)]
struct WhisperResult {
    language: Option<String>,
}

#[derive(Deserialize)]
struct WhisperSegment {
    offsets: Offsets,
    #[serde(default)]
    tokens: Vec<WhisperToken>,
}

#[derive(Deserialize, Clone, Copy)]
struct Offsets {
    from: i64,
    to: i64,
}

#[derive(Deserialize)]
struct WhisperToken {
    text: String,
    id: i64,
    #[serde(default)]
    p: f64,
    #[serde(default = "no_dtw")]
    t_dtw: i64,
    offsets: Option<Offsets>,
}

fn no_dtw() -> i64 {
    -1
}

/// Um segmento de fala do VAD, em centésimos de segundo, como o whisper.cpp o registra em
/// `vad_segment_info`: onde ele está no áudio original e no áudio cortado.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VadSegment {
    pub original_start: i64,
    pub original_end: i64,
    pub vad_start: i64,
    pub vad_end: i64,
}

/// A tabela do VAD que o whisper.cpp escreve no stderr, uma linha por segmento.
pub fn vad_segments(stderr: &str) -> Vec<VadSegment> {
    stderr
        .lines()
        .filter_map(|line| {
            let rest = line.split("vad_segment_info:").nth(1)?;
            let mut values = ["orig_start:", "orig_end:", "vad_start:", "vad_end:"]
                .iter()
                .map(|key| {
                    let text = rest.split(key).nth(1)?.trim_start();
                    let number = text.split([',', ' ']).next()?;
                    number.parse::<f64>().ok().map(centiseconds)
                });
            Some(VadSegment {
                original_start: values.next()??,
                original_end: values.next()??,
                vad_start: values.next()??,
                vad_end: values.next()??,
            })
        })
        .collect()
}

#[allow(clippy::cast_possible_truncation)]
fn centiseconds(seconds: f64) -> i64 {
    (seconds * 100.0).round() as i64
}

/// Leva um tempo (centésimos) do áudio cortado pelo VAD para o original, pela regra de
/// `whisper_map_token_time_segment_aware` (whisper.cpp v1.9.5): dentro de um segmento de fala
/// interpola; no silêncio removido entre dois, encosta na borda mais próxima.
pub fn to_original_time(t: i64, vad: &[VadSegment]) -> i64 {
    let (Some(first), Some(last)) = (vad.first(), vad.last()) else {
        return t;
    };
    if t <= first.vad_start {
        return first.original_start;
    }
    if t >= last.vad_end {
        return last.original_end;
    }
    for (i, s) in vad.iter().enumerate() {
        if t >= s.vad_start && t <= s.vad_end {
            let length = s.vad_end - s.vad_start;
            if length <= 0 {
                return s.original_start;
            }
            return s.original_start
                + (t - s.vad_start) * (s.original_end - s.original_start) / length;
        }
        if let Some(next) = vad.get(i + 1)
            && t > s.vad_end
            && t < next.vad_start
        {
            let middle = (s.vad_end + next.vad_start) / 2;
            return if t <= middle {
                s.original_end
            } else {
                next.original_start
            };
        }
    }
    t
}

// ------------------------------------------------------------------ palavras

/// Uma palavra do alinhamento antes de juntar a pontuação: o texto mantém o espaço inicial.
struct PalavraAlinhada {
    texto: String,
    inicio: f64,
    fim: f64,
    segmento: usize,
    probabilidade: f64,
}

/// Divide os tokens de texto de um segmento em palavras, como o `split_tokens_on_spaces` do
/// Whisper: um token com espaço inicial ou de pontuação abre uma palavra.
fn dividir_em_palavras(segmento: &WhisperSegment) -> Vec<Vec<&WhisperToken>> {
    let mut grupos: Vec<Vec<&WhisperToken>> = Vec::new();
    for token in segmento.tokens.iter().filter(|t| t.id < EOT) {
        match grupos.last_mut() {
            Some(atual)
                if !token.text.starts_with(' ')
                    && !ASCII_PUNCTUATION.contains(token.text.trim()) =>
            {
                atual.push(token);
            }
            _ => grupos.push(vec![token]),
        }
    }
    grupos
}

/// As palavras do whisper-cli no áudio original, prontas para o `transcricao.json`.
///
/// A palavra termina no `t_dtw` do último token, que é o fim dele, e começa no fim da anterior;
/// se o DTW voltou no tempo (outra janela), vale o `t0` do primeiro token.
fn palavras_do_whisper(segmentos: &[WhisperSegment], vad: &[VadSegment]) -> Vec<PalavraTranscrita> {
    let tempo = |cs: i64| to_original_time(cs, vad) as f64 / 100.0;
    let mut palavras: Vec<PalavraAlinhada> = Vec::new();
    for (indice, segmento) in segmentos.iter().enumerate() {
        for tokens in dividir_em_palavras(segmento) {
            let fim = tempo(tokens.last().map_or(0, |t| t.t_dtw));
            let inicio = match palavras.last() {
                Some(anterior) if anterior.fim <= fim => anterior.fim,
                _ => fim.min(tempo(
                    tokens
                        .first()
                        .and_then(|t| t.offsets)
                        .map_or(0, |o| o.from / 10),
                )),
            };
            #[allow(clippy::cast_precision_loss)]
            let probabilidade =
                tokens.iter().map(|t| t.p).sum::<f64>() / tokens.len().max(1) as f64;
            palavras.push(PalavraAlinhada {
                texto: tokens.iter().map(|t| t.text.as_str()).collect(),
                inicio,
                fim,
                segmento: indice,
                probabilidade,
            });
        }
    }
    aplicar_heuristicas(&mut palavras, segmentos);
    monotonicas(&palavras)
}

/// Percentil com interpolação linear (o padrão do numpy).
fn percentile(values: &[f64], p: f64) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    #[allow(clippy::cast_precision_loss)]
    let position = (sorted.len() - 1) as f64 * p / 100.0;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let low = position.floor() as usize;
    let a = sorted[low];
    let b = sorted[(low + 1).min(sorted.len() - 1)];
    a + (b - a) * (position - low as f64)
}

/// `merge_punctuations` do faster-whisper: a pontuação passa o texto para a palavra vizinha e
/// fica vazia. Os tempos não mudam.
fn merge_punctuations(palavras: &mut [PalavraAlinhada]) {
    if palavras.len() < 2 {
        return;
    }
    let mut j = palavras.len() - 1;
    for i in (0..palavras.len() - 1).rev() {
        if palavras[i].texto.starts_with(' ')
            && PREPEND_PUNCTUATIONS.contains(palavras[i].texto.trim())
        {
            let anterior = std::mem::take(&mut palavras[i].texto);
            palavras[j].texto = anterior + &palavras[j].texto;
        } else {
            j = i;
        }
    }
    let mut i = 0;
    for j in 1..palavras.len() {
        if !palavras[i].texto.ends_with(' ') && APPEND_PUNCTUATIONS.contains(&*palavras[j].texto) {
            let seguinte = std::mem::take(&mut palavras[j].texto);
            palavras[i].texto.push_str(&seguinte);
        } else {
            i = j;
        }
    }
}

/// As heurísticas do `add_word_timestamps` do faster-whisper 1.2.1. A mediana das durações vale
/// para o vídeo todo: o faster-whisper a calcula a cada janela de 30 s, que o whisper-cli não
/// informa.
fn aplicar_heuristicas(palavras: &mut [PalavraAlinhada], segmentos: &[WhisperSegment]) {
    let duracoes: Vec<f64> = palavras
        .iter()
        .map(|p| p.fim - p.inicio)
        .filter(|d| *d != 0.0)
        .collect();
    let mediana = if duracoes.is_empty() {
        0.0
    } else {
        percentile(&duracoes, 50.0).min(0.7)
    };
    let maxima = mediana * 2.0;

    // Palavras longas na fronteira de uma frase.
    for i in 1..palavras.len() {
        if palavras[i].fim - palavras[i].inicio > maxima {
            if SENTENCE_END.contains(&*palavras[i].texto) {
                palavras[i].fim = palavras[i].inicio + maxima;
            } else if SENTENCE_END.contains(&*palavras[i - 1].texto) {
                palavras[i].inicio = palavras[i].fim - maxima;
            }
        }
    }
    merge_punctuations(palavras);

    let mut ultima_fala = 0.0;
    for (indice, segmento) in segmentos.iter().enumerate() {
        let no_segmento: Vec<usize> = palavras
            .iter()
            .enumerate()
            .filter(|(_, p)| p.segmento == indice && !p.texto.is_empty())
            .map(|(i, _)| i)
            .collect();
        let (Some(&primeira), Some(&ultima)) = (no_segmento.first(), no_segmento.last()) else {
            continue;
        };
        let segunda = no_segmento.get(1).copied();
        #[allow(clippy::cast_precision_loss)]
        let inicio_do_segmento = segmento.offsets.from as f64 / 1000.0;
        #[allow(clippy::cast_precision_loss)]
        let mut fim_do_segmento = segmento.offsets.to as f64 / 1000.0;

        // A primeira e a segunda palavra depois de uma pausa não passam do dobro da mediana.
        let longa = palavras[primeira].fim - palavras[primeira].inicio > maxima
            || segunda.is_some_and(|s| palavras[s].fim - palavras[primeira].inicio > maxima * 2.0);
        if palavras[primeira].fim - ultima_fala > mediana * 4.0 && longa {
            if let Some(s) = segunda
                && palavras[s].fim - palavras[s].inicio > maxima
            {
                let fronteira = (palavras[s].fim / 2.0).max(palavras[s].fim - maxima);
                palavras[primeira].fim = fronteira;
                palavras[s].inicio = fronteira;
            }
            palavras[primeira].inicio = (palavras[primeira].fim - maxima).max(0.0);
        }

        // Prefere o início e o fim do segmento se a primeira ou a última palavra for longa.
        if inicio_do_segmento < palavras[primeira].fim
            && inicio_do_segmento - 0.5 > palavras[primeira].inicio
        {
            palavras[primeira].inicio = (palavras[primeira].fim - mediana)
                .min(inicio_do_segmento)
                .max(0.0);
        }
        if fim_do_segmento > palavras[ultima].inicio && fim_do_segmento + 0.5 < palavras[ultima].fim
        {
            palavras[ultima].fim = (palavras[ultima].inicio + mediana).max(fim_do_segmento);
        } else {
            fim_do_segmento = palavras[ultima].fim;
        }
        ultima_fala = fim_do_segmento;
    }
}

fn round_ms(seconds: f64) -> f64 {
    (seconds * 1000.0).round() / 1000.0
}

/// Tempos monotônicos e pelo menos 50 ms por palavra.
fn monotonicas(palavras: &[PalavraAlinhada]) -> Vec<PalavraTranscrita> {
    let mut saida: Vec<PalavraTranscrita> = Vec::new();
    for palavra in palavras {
        let texto = palavra.texto.trim();
        if texto.is_empty() {
            continue;
        }
        let mut inicio = round_ms(palavra.inicio);
        let mut fim = round_ms(palavra.fim.max(palavra.inicio + DURACAO_MINIMA));
        if let Some(anterior) = saida.last()
            && inicio < anterior.fim
        {
            inicio = anterior.fim;
            fim = round_ms(fim.max(inicio + DURACAO_MINIMA));
        }
        saida.push(PalavraTranscrita {
            texto: texto.to_owned(),
            inicio,
            fim,
            tipo: "word".to_owned(),
            falante: "speaker_0".to_owned(),
            probabilidade: round_ms(palavra.probabilidade),
        });
    }
    saida
}

// ------------------------------------------------------------------ arquivos

/// A transcrição compactada que o Claude lê: frases separadas por pausas de 0,5 s ou mais, uma
/// por linha, com o intervalo em segundos (`[início-fim] texto`).
pub fn compactar(palavras: &[PalavraTranscrita]) -> String {
    let mut saida = String::new();
    let mut frase: Vec<&PalavraTranscrita> = Vec::new();
    let mut fechar = |frase: &mut Vec<&PalavraTranscrita>| {
        if let (Some(primeira), Some(ultima)) = (frase.first(), frase.last()) {
            let texto = frase
                .iter()
                .map(|p| p.texto.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            let _ = writeln!(saida, "[{:.2}-{:.2}] {texto}", primeira.inicio, ultima.fim);
        }
        frase.clear();
    };
    for palavra in palavras {
        if frase.last().is_some_and(|anterior| {
            // Os tempos têm precisão de milissegundo: a conta em ponto flutuante não decide.
            round_ms(palavra.inicio - anterior.fim) >= PAUSA_ENTRE_FRASES
        }) {
            fechar(&mut frase);
        }
        frase.push(palavra);
    }
    fechar(&mut frase);
    saida
}

#[derive(Serialize)]
struct TranscricaoJson<'a> {
    language_code: &'a str,
    text: String,
    words: &'a [PalavraTranscrita],
    source: &'static str,
}

fn gravar(pasta: &Path, transcricao: &Transcricao) -> io::Result<()> {
    let texto = transcricao
        .palavras
        .iter()
        .map(|p| p.texto.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    write_json(
        &pasta.join("transcricao.json"),
        &TranscricaoJson {
            language_code: &transcricao.idioma,
            text: texto,
            words: &transcricao.palavras,
            source: "whisper.cpp",
        },
    )?;
    fs::write(
        pasta.join("transcricao-compactada.txt"),
        compactar(&transcricao.palavras),
    )
}
