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

use crate::processo::{self, Fluxo, Interrompido};

/// Primeiro token especial do vocabulário multilíngue do Whisper; abaixo dele, só texto.
const EOT: i64 = 50257;
/// A pontuação ASCII (`string.punctuation` do Python) separa palavras no alinhamento.
const PONTUACAO_ASCII: &str = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const PONTUACAO_DE_ABERTURA: &str = "\"'“¿([{-";
const PONTUACAO_DE_FECHAMENTO: &str = "\"'.。,，!！?？:：”)]}、";
const FIM_DE_FRASE: &str = ".。!！?？";
/// Cada palavra dura pelo menos 50 ms.
const DURACAO_MINIMA: f64 = 0.05;
/// Uma pausa de 0,5 s ou mais separa as frases da transcrição compactada.
const PAUSA_ENTRE_FRASES: f64 = 0.5;
/// Quanto áudio a detecção de idioma escuta.
const SEGUNDOS_DA_DETECCAO: u32 = 30;
/// O áudio de 16 kHz, mono, 16 bits: bytes por segundo.
const BYTES_POR_SEGUNDO: u64 = 32_000;
/// De onde, no máximo, a detecção de idioma escuta.
const INICIO_MAXIMO_DA_DETECCAO: u64 = 120;

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

impl From<Interrompido> for ErroDaTranscricao {
    fn from(interrompido: Interrompido) -> Self {
        match interrompido {
            Interrompido::Cancelado => Self::Cancelado,
            Interrompido::Io(error) => Self::Io(error),
        }
    }
}

/// Os programas e modelos da Transcrição, por caminho configurável.
pub struct Transcritor {
    ffmpeg: PathBuf,
    whisper: PathBuf,
    modelo: PathBuf,
    modelo_do_vad: PathBuf,
    threads: u32,
}

impl Transcritor {
    pub fn new(ffmpeg: PathBuf, whisper: PathBuf, modelo: PathBuf, modelo_do_vad: PathBuf) -> Self {
        Self {
            ffmpeg,
            whisper,
            modelo,
            modelo_do_vad,
            threads: std::thread::available_parallelism().map_or(4, |n| n.get().min(8) as u32),
        }
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
        let trabalho = pasta_de_trabalho(pedido.pasta_de_saida)?;
        let resultado = self.transcrever_em(pedido, &trabalho, cancelar, progresso);
        let _ = fs::remove_dir_all(&trabalho);
        let transcricao = resultado?;
        gravar(pedido.pasta_de_saida, &transcricao)?;
        progresso(1.0);
        Ok(transcricao)
    }

    fn transcrever_em(
        &self,
        pedido: &Pedido<'_>,
        trabalho: &Path,
        cancelar: &AtomicBool,
        progresso: &mut dyn FnMut(f64),
    ) -> Result<Transcricao, ErroDaTranscricao> {
        let audio = trabalho.join("audio.wav");
        self.extrair_audio(pedido.video, &audio, cancelar)?;
        let idioma = match pedido.idioma {
            Some(idioma) => idioma.to_owned(),
            None => self.detectar_idioma(&audio, trabalho, cancelar)?,
        };

        let base = trabalho.join("transcricao");
        let argumentos = trabalho.join("whisper.txt");
        let mut linhas = vec![
            "-m".to_owned(),
            self.modelo.display().to_string(),
            "-f".to_owned(),
            audio.display().to_string(),
            "-l".to_owned(),
            idioma.clone(),
            "-t".to_owned(),
            self.threads.to_string(),
        ];
        if let Some(prompt) = prompt(&idioma, pedido.nomes_proprios) {
            linhas.extend([
                "--prompt".to_owned(),
                prompt,
                "--carry-initial-prompt".to_owned(),
            ]);
        }
        linhas.extend([
            "--vad".to_owned(),
            "-vm".to_owned(),
            self.modelo_do_vad.display().to_string(),
            "--vad-min-silence-duration-ms".to_owned(),
            "2000".to_owned(),
            "--vad-speech-pad-ms".to_owned(),
            "400".to_owned(),
            "-ojf".to_owned(),
            "-of".to_owned(),
            base.display().to_string(),
            "-dtw".to_owned(),
            "large.v3".to_owned(),
            "-nfa".to_owned(),
            "-pp".to_owned(),
        ]);
        // No Windows o whisper-cli lê os argumentos na página de código do sistema; o arquivo
        // de resposta preserva os acentos do prompt.
        fs::write(&argumentos, linhas.join("\n"))?;

        let mut comando = Command::new(&self.whisper);
        comando.arg(format!("@{}", argumentos.display()));
        let saida = processo::executar(comando, cancelar, &mut |fluxo, linha| {
            if fluxo == Fluxo::Stderr
                && let Some(percentual) = percentual_do_progresso(linha)
            {
                progresso(percentual / 100.0);
            }
        })?;
        if !saida.sucesso {
            return Err(falhou("whisper-cli", &saida.stderr));
        }
        let whisper = ler_saida(&base)?;
        let vad = segmentos_do_vad(&saida.stderr);
        let idioma = whisper.result.language.unwrap_or(idioma);
        Ok(Transcricao {
            idioma,
            palavras: palavras_do_whisper(&whisper.transcription, &vad),
        })
    }

    /// Extrai o áudio em 16 kHz mono, o que o whisper.cpp lê.
    fn extrair_audio(
        &self,
        video: &Path,
        audio: &Path,
        cancelar: &AtomicBool,
    ) -> Result<(), ErroDaTranscricao> {
        self.ffmpeg(
            vec![
                "-y".into(),
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
            ],
            cancelar,
        )
    }

    /// Detecta o idioma numa amostra do áudio, deixando o whisper-cli em `-l auto`.
    fn detectar_idioma(
        &self,
        audio: &Path,
        trabalho: &Path,
        cancelar: &AtomicBool,
    ) -> Result<String, ErroDaTranscricao> {
        let tamanho = fs::metadata(audio)?.len();
        let inicio = (tamanho / BYTES_POR_SEGUNDO / 3).min(INICIO_MAXIMO_DA_DETECCAO);
        let amostra = trabalho.join("amostra.wav");
        self.ffmpeg(
            vec![
                "-y".into(),
                "-ss".into(),
                inicio.to_string().into(),
                "-t".into(),
                SEGUNDOS_DA_DETECCAO.to_string().into(),
                "-i".into(),
                audio.into(),
                "-c".into(),
                "copy".into(),
                amostra.clone().into(),
            ],
            cancelar,
        )?;
        let base = trabalho.join("deteccao");
        let mut comando = Command::new(&self.whisper);
        comando
            .args(["-m"])
            .arg(&self.modelo)
            .arg("-f")
            .arg(&amostra)
            .args(["-l", "auto", "-t"])
            .arg(self.threads.to_string())
            .args(["-oj", "-of"])
            .arg(&base);
        let saida = processo::executar(comando, cancelar, &mut |_, _| {})?;
        if !saida.sucesso {
            return Err(falhou("whisper-cli", &saida.stderr));
        }
        let whisper = ler_saida(&base)?;
        whisper
            .result
            .language
            .ok_or_else(|| ErroDaTranscricao::SaidaIlegivel("sem idioma detectado".to_owned()))
    }

    fn ffmpeg(&self, args: Vec<OsString>, cancelar: &AtomicBool) -> Result<(), ErroDaTranscricao> {
        let mut comando = Command::new(&self.ffmpeg);
        comando
            .args(["-hide_banner", "-nostats", "-v", "error"])
            .args(args);
        let saida = processo::executar(comando, cancelar, &mut |_, _| {})?;
        if saida.sucesso {
            Ok(())
        } else {
            Err(falhou("ffmpeg", &saida.stderr))
        }
    }
}

/// Lê o JSON que o whisper-cli gravou em `<base>.json`.
fn ler_saida(base: &Path) -> Result<SaidaDoWhisper, ErroDaTranscricao> {
    let ilegivel =
        |erro: &dyn std::fmt::Display| ErroDaTranscricao::SaidaIlegivel(erro.to_string());
    let json = fs::read_to_string(base.with_extension("json")).map_err(|erro| ilegivel(&erro))?;
    serde_json::from_str(&json).map_err(|erro| ilegivel(&erro))
}

fn falhou(programa: &'static str, stderr: &str) -> ErroDaTranscricao {
    ErroDaTranscricao::Falhou {
        programa,
        detalhe: stderr.trim().lines().last().unwrap_or_default().to_owned(),
    }
}

/// Uma pasta de trabalho só desta transcrição, dentro de `base`.
fn pasta_de_trabalho(base: &Path) -> io::Result<PathBuf> {
    let pasta = base.join(".transcricao");
    let _ = fs::remove_dir_all(&pasta);
    fs::create_dir_all(&pasta)?;
    Ok(pasta)
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
pub fn percentual_do_progresso(linha: &str) -> Option<f64> {
    let resto = linha.split("progress =").nth(1)?;
    resto.trim().strip_suffix('%')?.trim().parse().ok()
}

// ------------------------------------------------------------------ saída do whisper-cli

#[derive(Deserialize)]
struct SaidaDoWhisper {
    #[serde(default)]
    result: ResultadoDoWhisper,
    #[serde(default)]
    transcription: Vec<SegmentoDoWhisper>,
}

#[derive(Deserialize, Default)]
struct ResultadoDoWhisper {
    language: Option<String>,
}

#[derive(Deserialize)]
struct SegmentoDoWhisper {
    offsets: Intervalo,
    #[serde(default)]
    tokens: Vec<TokenDoWhisper>,
}

#[derive(Deserialize, Clone, Copy)]
struct Intervalo {
    from: i64,
    to: i64,
}

#[derive(Deserialize)]
struct TokenDoWhisper {
    text: String,
    id: i64,
    #[serde(default)]
    p: f64,
    #[serde(default = "sem_dtw")]
    t_dtw: i64,
    offsets: Option<Intervalo>,
}

fn sem_dtw() -> i64 {
    -1
}

/// Um segmento de fala do VAD, em centésimos de segundo, como o whisper.cpp o registra em
/// `vad_segment_info`: onde ele está no áudio original e no áudio cortado.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SegmentoDoVad {
    pub inicio_original: i64,
    pub fim_original: i64,
    pub inicio_cortado: i64,
    pub fim_cortado: i64,
}

/// A tabela do VAD que o whisper.cpp escreve no stderr, uma linha por segmento.
pub fn segmentos_do_vad(stderr: &str) -> Vec<SegmentoDoVad> {
    stderr
        .lines()
        .filter_map(|linha| {
            let resto = linha.split("vad_segment_info:").nth(1)?;
            let mut valores = ["orig_start:", "orig_end:", "vad_start:", "vad_end:"]
                .iter()
                .map(|chave| {
                    let texto = resto.split(chave).nth(1)?.trim_start();
                    let numero = texto.split([',', ' ']).next()?;
                    numero.parse::<f64>().ok().map(centesimos)
                });
            Some(SegmentoDoVad {
                inicio_original: valores.next()??,
                fim_original: valores.next()??,
                inicio_cortado: valores.next()??,
                fim_cortado: valores.next()??,
            })
        })
        .collect()
}

#[allow(clippy::cast_possible_truncation)]
fn centesimos(segundos: f64) -> i64 {
    (segundos * 100.0).round() as i64
}

/// Leva um tempo (centésimos) do áudio cortado pelo VAD para o original, pela regra de
/// `whisper_map_token_time_segment_aware` (whisper.cpp v1.9.5): dentro de um segmento de fala
/// interpola; no silêncio removido entre dois, encosta na borda mais próxima.
pub fn para_o_original(t: i64, vad: &[SegmentoDoVad]) -> i64 {
    let (Some(primeiro), Some(ultimo)) = (vad.first(), vad.last()) else {
        return t;
    };
    if t <= primeiro.inicio_cortado {
        return primeiro.inicio_original;
    }
    if t >= ultimo.fim_cortado {
        return ultimo.fim_original;
    }
    for (i, s) in vad.iter().enumerate() {
        if t >= s.inicio_cortado && t <= s.fim_cortado {
            let tamanho = s.fim_cortado - s.inicio_cortado;
            if tamanho <= 0 {
                return s.inicio_original;
            }
            return s.inicio_original
                + (t - s.inicio_cortado) * (s.fim_original - s.inicio_original) / tamanho;
        }
        if let Some(seguinte) = vad.get(i + 1)
            && t > s.fim_cortado
            && t < seguinte.inicio_cortado
        {
            let meio = (s.fim_cortado + seguinte.inicio_cortado) / 2;
            return if t <= meio {
                s.fim_original
            } else {
                seguinte.inicio_original
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
fn dividir_em_palavras(segmento: &SegmentoDoWhisper) -> Vec<Vec<&TokenDoWhisper>> {
    let mut grupos: Vec<Vec<&TokenDoWhisper>> = Vec::new();
    for token in segmento.tokens.iter().filter(|t| t.id < EOT) {
        match grupos.last_mut() {
            Some(atual)
                if !token.text.starts_with(' ') && !PONTUACAO_ASCII.contains(token.text.trim()) =>
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
fn palavras_do_whisper(
    segmentos: &[SegmentoDoWhisper],
    vad: &[SegmentoDoVad],
) -> Vec<PalavraTranscrita> {
    let tempo = |cs: i64| para_o_original(cs, vad) as f64 / 100.0;
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
fn percentil(valores: &[f64], p: f64) -> f64 {
    if valores.is_empty() {
        return f64::NAN;
    }
    let mut ordenados = valores.to_vec();
    ordenados.sort_by(f64::total_cmp);
    #[allow(clippy::cast_precision_loss)]
    let posicao = (ordenados.len() - 1) as f64 * p / 100.0;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let baixo = posicao.floor() as usize;
    let a = ordenados[baixo];
    let b = ordenados[(baixo + 1).min(ordenados.len() - 1)];
    a + (b - a) * (posicao - baixo as f64)
}

/// `merge_punctuations` do faster-whisper: a pontuação passa o texto para a palavra vizinha e
/// fica vazia. Os tempos não mudam.
fn juntar_pontuacao(palavras: &mut [PalavraAlinhada]) {
    if palavras.len() < 2 {
        return;
    }
    let mut j = palavras.len() - 1;
    for i in (0..palavras.len() - 1).rev() {
        if palavras[i].texto.starts_with(' ')
            && PONTUACAO_DE_ABERTURA.contains(palavras[i].texto.trim())
        {
            let anterior = std::mem::take(&mut palavras[i].texto);
            palavras[j].texto = anterior + &palavras[j].texto;
        } else {
            j = i;
        }
    }
    let mut i = 0;
    for j in 1..palavras.len() {
        if !palavras[i].texto.ends_with(' ')
            && PONTUACAO_DE_FECHAMENTO.contains(&*palavras[j].texto)
        {
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
fn aplicar_heuristicas(palavras: &mut [PalavraAlinhada], segmentos: &[SegmentoDoWhisper]) {
    let duracoes: Vec<f64> = palavras
        .iter()
        .map(|p| p.fim - p.inicio)
        .filter(|d| *d != 0.0)
        .collect();
    let mediana = if duracoes.is_empty() {
        0.0
    } else {
        percentil(&duracoes, 50.0).min(0.7)
    };
    let maxima = mediana * 2.0;

    // Palavras longas na fronteira de uma frase.
    for i in 1..palavras.len() {
        if palavras[i].fim - palavras[i].inicio > maxima {
            if FIM_DE_FRASE.contains(&*palavras[i].texto) {
                palavras[i].fim = palavras[i].inicio + maxima;
            } else if FIM_DE_FRASE.contains(&*palavras[i - 1].texto) {
                palavras[i].inicio = palavras[i].fim - maxima;
            }
        }
    }
    juntar_pontuacao(palavras);

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

fn arredondar_ms(segundos: f64) -> f64 {
    (segundos * 1000.0).round() / 1000.0
}

/// Tempos monotônicos e pelo menos 50 ms por palavra.
fn monotonicas(palavras: &[PalavraAlinhada]) -> Vec<PalavraTranscrita> {
    let mut saida: Vec<PalavraTranscrita> = Vec::new();
    for palavra in palavras {
        let texto = palavra.texto.trim();
        if texto.is_empty() {
            continue;
        }
        let mut inicio = arredondar_ms(palavra.inicio);
        let mut fim = arredondar_ms(palavra.fim.max(palavra.inicio + DURACAO_MINIMA));
        if let Some(anterior) = saida.last()
            && inicio < anterior.fim
        {
            inicio = anterior.fim;
            fim = arredondar_ms(fim.max(inicio + DURACAO_MINIMA));
        }
        saida.push(PalavraTranscrita {
            texto: texto.to_owned(),
            inicio,
            fim,
            tipo: "word".to_owned(),
            falante: "speaker_0".to_owned(),
            probabilidade: arredondar_ms(palavra.probabilidade),
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
            arredondar_ms(palavra.inicio - anterior.fim) >= PAUSA_ENTRE_FRASES
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
    crate::projeto::gravar_json(
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
