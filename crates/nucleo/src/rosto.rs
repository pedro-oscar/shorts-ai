//! O rosto do corte (ADR 0005): o YuNet em CPU, via `tract`, acha os rostos em quadros a 5 Hz;
//! o acompanhamento escolhe a pessoa, trata as trocas de cena, suaviza o movimento e respeita
//! os pins do roteiro. A saída é o `face.json` que o template do Remotion lê.

use std::io::{self, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tract_onnx::prelude::*;

use crate::corte::{ErroDoCorte, Ffmpeg};
use crate::process::hide_console;

const MODELO: &[u8] = include_bytes!("../assets/face_detection_yunet_2026may.onnx");

/// A largura dos quadros que o ffmpeg entrega.
const LARGURA_DO_QUADRO: u32 = 640;
const QUADROS_POR_SEGUNDO: f64 = 5.0;
const LIMIAR_DE_PONTUACAO: f32 = 0.7;
const LIMIAR_DO_NMS: f32 = 0.3;
const MAXIMO_DE_CAIXAS: usize = 5000;
const STRIDES: [u32; 3] = [8, 16, 32];
/// Acima disso entre dois histogramas HSV, o quadro é de outra cena.
const LIMIAR_DE_TROCA_DE_CENA: f64 = 0.45;
/// A pessoa seguida continua sendo a escolhida enquanto o rosto dela tiver pelo menos esta
/// fração da área do maior rosto do quadro.
const FRACAO_DA_AREA_QUE_AINDA_E_GRANDE: f64 = 0.5;
const ALFA_DA_SUAVIZACAO: f64 = 0.25;
const ZONA_MORTA: f64 = 0.035;
/// Abaixo disso de quadros com rosto, o corte merece aviso.
pub(crate) const PROPORCAO_MINIMA_COM_ROSTO: f64 = 0.6;
const CASAS: f64 = 10_000.0;
const ROSTO_PADRAO: Deteccao = Deteccao {
    cx: 0.5,
    cy: 0.4,
    fw: 0.17,
    fh: 0.3,
    pontuacao: 0.0,
};
const BINS_DE_MATIZ: usize = 16;
const BINS_DE_SATURACAO: usize = 4;

/// Um rosto achado, com tudo em fração do quadro.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Deteccao {
    pub cx: f64,
    pub cy: f64,
    pub fw: f64,
    pub fh: f64,
    pub pontuacao: f64,
}

impl Deteccao {
    fn area(&self) -> f64 {
        self.fw * self.fh
    }

    fn distancia(&self, outra: &Deteccao) -> f64 {
        (self.cx - outra.cx).hypot(self.cy - outra.cy)
    }
}

/// O que se viu num instante do corte.
#[derive(Debug, Clone, PartialEq)]
pub struct Amostra {
    pub t: f64,
    /// O quadro é de outra cena que o anterior.
    pub troca: bool,
    pub rostos: Vec<Deteccao>,
}

/// `pin` do roteiro: o centro horizontal fixo num intervalo, em tempos do corte.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pin {
    pub inicio: f64,
    pub fim: f64,
    pub cx: f64,
}

impl Pin {
    /// Lê `"12-18:0.30"`; o que não segue esse formato (ou tem cx fora de 0–1) é `None`.
    pub fn analisar(texto: &str) -> Option<Self> {
        let (intervalo, cx) = texto.trim().split_once(':')?;
        let (inicio, fim) = intervalo.split_once('-')?;
        let pin = Self {
            inicio: inicio.trim().parse().ok()?,
            fim: fim.trim().parse().ok()?,
            cx: cx.trim().parse().ok()?,
        };
        ((0.0..=1.0).contains(&pin.cx) && pin.inicio <= pin.fim).then_some(pin)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Chave {
    pub t: f64,
    pub cx: f64,
    pub cy: f64,
    pub fw: f64,
    pub fh: f64,
    pub cut: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Estatisticas {
    pub source: String,
    pub width: u32,
    pub height: u32,
    pub duration_sec: f64,
    pub samples: usize,
    pub face_ratio: f64,
    pub shots: usize,
    pub detector: &'static str,
}

/// O `face.json`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Rastro {
    pub version: u32,
    pub keys: Vec<Chave>,
    pub stats: Estatisticas,
}

/// O que pode merecer um aviso no projeto; a interface escreve o texto.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AvisoDoRosto {
    /// O rosto aparece em menos de 60% do corte.
    RostoRaro { proporcao: f64 },
}

impl Rastro {
    pub fn aviso(&self) -> Option<AvisoDoRosto> {
        let proporcao = self.stats.face_ratio;
        (proporcao < PROPORCAO_MINIMA_COM_ROSTO).then_some(AvisoDoRosto::RostoRaro { proporcao })
    }

    pub fn para_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("o rastro serializa")
    }
}

/// O vídeo do corte, para as estatísticas.
#[derive(Debug, Clone)]
pub struct Origem {
    pub nome: String,
    pub largura: u32,
    pub altura: u32,
    pub duracao: f64,
}

// ---- Decodificação do YuNet (portada do OpenCV) ----

#[derive(Debug, Clone, Copy, PartialEq)]
struct Caixa {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    pontuacao: f32,
}

fn iou(a: &Caixa, b: &Caixa) -> f32 {
    let x1 = a.x.max(b.x);
    let y1 = a.y.max(b.y);
    let x2 = (a.x + a.w).min(b.x + b.w);
    let y2 = (a.y + a.h).min(b.y + b.h);
    let interseccao = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    let uniao = a.w * a.h + b.w * b.h - interseccao;
    if uniao <= 0.0 {
        0.0
    } else {
        interseccao / uniao
    }
}

/// Supressão de não máximos: das caixas que se sobrepõem além de `limiar`, fica a de maior
/// pontuação.
fn nms(mut caixas: Vec<Caixa>, limiar: f32) -> Vec<Caixa> {
    caixas.sort_by(|a, b| b.pontuacao.total_cmp(&a.pontuacao));
    caixas.truncate(MAXIMO_DE_CAIXAS);
    let mut mantidas: Vec<Caixa> = Vec::new();
    for caixa in caixas {
        if mantidas.iter().all(|m| iou(m, &caixa) <= limiar) {
            mantidas.push(caixa);
        }
    }
    mantidas
}

/// As saídas do modelo de um strides: `cls`, `obj` e `bbox`, uma linha por célula da grade.
struct SaidaDoStride<'a> {
    stride: u32,
    colunas: usize,
    cls: &'a [f32],
    obj: &'a [f32],
    bbox: &'a [f32],
}

fn decodificar(saidas: &[SaidaDoStride]) -> Vec<Caixa> {
    let mut caixas = Vec::new();
    for saida in saidas {
        let stride = saida.stride as f32;
        for (i, (cls, obj)) in saida.cls.iter().zip(saida.obj).enumerate() {
            let pontuacao = (cls.clamp(0.0, 1.0) * obj.clamp(0.0, 1.0)).sqrt();
            if pontuacao < LIMIAR_DE_PONTUACAO {
                continue;
            }
            let (linha, coluna) = (i / saida.colunas, i % saida.colunas);
            let b = &saida.bbox[i * 4..i * 4 + 4];
            let cx = (coluna as f32 + b[0]) * stride;
            let cy = (linha as f32 + b[1]) * stride;
            let w = b[2].exp() * stride;
            let h = b[3].exp() * stride;
            caixas.push(Caixa {
                x: cx - w / 2.0,
                y: cy - h / 2.0,
                w,
                h,
                pontuacao,
            });
        }
    }
    nms(caixas, LIMIAR_DO_NMS)
}

/// A rede carregada para um tamanho de quadro.
type Rede = Arc<TypedSimplePlan>;

/// O YuNet em CPU.
pub struct Detector {
    redes: Vec<((usize, usize), Rede)>,
}

impl Detector {
    pub fn new() -> Self {
        Self { redes: Vec::new() }
    }

    fn rede(&mut self, largura: usize, altura: usize) -> TractResult<&Rede> {
        if let Some(i) = self.redes.iter().position(|(t, _)| *t == (largura, altura)) {
            return Ok(&self.redes[i].1);
        }
        let mut modelo = tract_onnx::onnx().model_for_read(&mut &MODELO[..])?;
        modelo.set_input_fact(0, f32::fact([1, 3, altura, largura]).into())?;
        let rede = modelo.into_optimized()?.into_runnable()?;
        self.redes.push(((largura, altura), rede));
        Ok(&self.redes.last().expect("acabou de entrar").1)
    }

    /// Os rostos de um quadro RGB, do maior para o menor pontuado.
    pub fn detectar(
        &mut self,
        rgb: &[u8],
        largura: usize,
        altura: usize,
    ) -> TractResult<Vec<Deteccao>> {
        // O modelo só aceita lados múltiplos de 32: o quadro é preenchido de zeros.
        let (lp, ap) = (largura.div_ceil(32) * 32, altura.div_ceil(32) * 32);
        let mut dados = vec![0f32; 3 * lp * ap];
        for y in 0..altura {
            for x in 0..largura {
                let p = (y * largura + x) * 3;
                // O modelo espera BGR em 0–255.
                for (canal, origem) in [2usize, 1, 0].into_iter().enumerate() {
                    dados[canal * lp * ap + y * lp + x] = f32::from(rgb[p + origem]);
                }
            }
        }
        let entrada = Tensor::from_shape(&[1, 3, ap, lp], &dados)?;
        let saidas = self.rede(lp, ap)?.run(tvec!(entrada.into()))?;
        let vistas: Vec<_> = saidas
            .iter()
            .map(|s| {
                s.to_plain_array_view::<f32>()
                    .map(|v| v.iter().copied().collect::<Vec<_>>())
            })
            .collect::<TractResult<_>>()?;
        let por_stride: Vec<SaidaDoStride> = STRIDES
            .iter()
            .enumerate()
            .map(|(i, &stride)| SaidaDoStride {
                stride,
                colunas: lp / stride as usize,
                cls: &vistas[i],
                obj: &vistas[3 + i],
                bbox: &vistas[6 + i],
            })
            .collect();
        let (l, a) = (largura as f64, altura as f64);
        Ok(decodificar(&por_stride)
            .into_iter()
            .map(|c| {
                let (x, y) = (f64::from(c.x), f64::from(c.y));
                let (w, h) = (f64::from(c.w), f64::from(c.h));
                Deteccao {
                    cx: ((x + w / 2.0) / l).clamp(0.0, 1.0),
                    cy: ((y + h / 2.0) / a).clamp(0.0, 1.0),
                    fw: (w / l).min(1.0),
                    fh: (h / a).min(1.0),
                    pontuacao: f64::from(c.pontuacao),
                }
            })
            .collect())
    }
}

impl Default for Detector {
    fn default() -> Self {
        Self::new()
    }
}

// ---- Troca de cena ----

/// Histograma de matiz × saturação (HSV) do quadro RGB, somando 1.
pub fn histograma_hsv(rgb: &[u8]) -> Vec<f64> {
    let mut histograma = vec![0.0; BINS_DE_MATIZ * BINS_DE_SATURACAO];
    for pixel in rgb.as_chunks::<3>().0 {
        let (r, g, b) = (
            f64::from(pixel[0]),
            f64::from(pixel[1]),
            f64::from(pixel[2]),
        );
        let maximo = r.max(g).max(b);
        let delta = maximo - r.min(g).min(b);
        let saturacao = if maximo == 0.0 { 0.0 } else { delta / maximo };
        let matiz = if delta == 0.0 {
            0.0
        } else if maximo == r {
            ((g - b) / delta).rem_euclid(6.0)
        } else if maximo == g {
            (b - r) / delta + 2.0
        } else {
            (r - g) / delta + 4.0
        } / 6.0;
        let m = ((matiz * BINS_DE_MATIZ as f64) as usize).min(BINS_DE_MATIZ - 1);
        let s = ((saturacao * BINS_DE_SATURACAO as f64) as usize).min(BINS_DE_SATURACAO - 1);
        histograma[m * BINS_DE_SATURACAO + s] += 1.0;
    }
    let total: f64 = histograma.iter().sum();
    if total > 0.0 {
        histograma.iter_mut().for_each(|v| *v /= total);
    }
    histograma
}

/// Distância de Bhattacharyya (0 = iguais, 1 = sem nada em comum) entre dois histogramas
/// normalizados.
pub fn distancia_de_histogramas(a: &[f64], b: &[f64]) -> f64 {
    let afinidade: f64 = a.iter().zip(b).map(|(x, y)| (x * y).sqrt()).sum();
    (1.0 - afinidade).max(0.0).sqrt()
}

pub fn trocou_de_cena(anterior: &[f64], atual: &[f64]) -> bool {
    distancia_de_histogramas(anterior, atual) > LIMIAR_DE_TROCA_DE_CENA
}

// ---- Acompanhamento ----

/// Escolhe o rosto da amostra: o mais próximo do anterior enquanto ele ainda é grande, senão
/// o maior.
fn escolher(rostos: &[Deteccao], anterior: Option<&Deteccao>) -> Option<Deteccao> {
    let maior = rostos.iter().max_by(|a, b| a.area().total_cmp(&b.area()))?;
    let Some(anterior) = anterior else {
        return Some(*maior);
    };
    let proximo = rostos
        .iter()
        .filter(|r| r.area() >= FRACAO_DA_AREA_QUE_AINDA_E_GRANDE * maior.area())
        .min_by(|a, b| a.distancia(anterior).total_cmp(&b.distancia(anterior)))?;
    Some(*proximo)
}

/// Completa as lacunas de uma série: interpola entre vizinhos e segura as pontas.
fn preencher(serie: &[Option<Deteccao>], padrao: Deteccao) -> Vec<Deteccao> {
    let presentes: Vec<usize> = (0..serie.len()).filter(|&i| serie[i].is_some()).collect();
    (0..serie.len())
        .map(|i| {
            if let Some(d) = serie[i] {
                return d;
            }
            let antes = presentes.iter().rev().find(|&&p| p < i);
            let depois = presentes.iter().find(|&&p| p > i);
            match (antes, depois) {
                (Some(&a), Some(&d)) => {
                    let (x, y) = (serie[a].expect("presente"), serie[d].expect("presente"));
                    let p = (i - a) as f64 / (d - a) as f64;
                    let mistura = |u: f64, v: f64| u + (v - u) * p;
                    Deteccao {
                        cx: mistura(x.cx, y.cx),
                        cy: mistura(x.cy, y.cy),
                        fw: mistura(x.fw, y.fw),
                        fh: mistura(x.fh, y.fh),
                        pontuacao: 0.0,
                    }
                }
                (Some(&a), None) => serie[a].expect("presente"),
                (None, Some(&d)) => serie[d].expect("presente"),
                (None, None) => padrao,
            }
        })
        .collect()
}

/// Uma passada da média móvel exponencial; a zona morta ignora variações menores que `zona`.
fn passada(valores: &[f64], zona: f64) -> Vec<f64> {
    let mut saida = Vec::with_capacity(valores.len());
    let mut estado = valores[0];
    for &v in valores {
        if (v - estado).abs() > zona {
            estado += ALFA_DA_SUAVIZACAO * (v - estado);
        }
        saida.push(estado);
    }
    saida
}

/// A média das passadas de ida e de volta: sem o atraso de uma só.
pub fn suavizar(valores: &[f64], zona: f64) -> Vec<f64> {
    if valores.is_empty() {
        return Vec::new();
    }
    let ida = passada(valores, zona);
    let mut invertidos = valores.to_vec();
    invertidos.reverse();
    let mut volta = passada(&invertidos, zona);
    volta.reverse();
    ida.iter().zip(&volta).map(|(a, b)| (a + b) / 2.0).collect()
}

fn arredondar(v: f64) -> f64 {
    (v * CASAS).round() / CASAS
}

/// O acompanhamento do rosto sobre as amostras de um corte.
pub fn rastrear(amostras: &[Amostra], pins: &[Pin], origem: &Origem) -> Rastro {
    let mut cenas: Vec<&[Amostra]> = Vec::new();
    let mut inicio = 0;
    for i in 1..amostras.len() {
        if amostras[i].troca {
            cenas.push(&amostras[inicio..i]);
            inicio = i;
        }
    }
    if !amostras.is_empty() {
        cenas.push(&amostras[inicio..]);
    }

    let mut pontos: Vec<(f64, Deteccao, bool)> = Vec::new();
    let mut com_rosto = 0;
    let mut ultimo = ROSTO_PADRAO;
    for (n, cena) in cenas.iter().enumerate() {
        let mut anterior: Option<Deteccao> = None;
        let serie: Vec<Option<Deteccao>> = cena
            .iter()
            .map(|a| {
                let escolhido = escolher(&a.rostos, anterior.as_ref());
                if escolhido.is_some() {
                    anterior = escolhido;
                    com_rosto += 1;
                }
                escolhido
            })
            .collect();
        let cheia = preencher(&serie, ultimo);
        let coluna = |f: fn(&Deteccao) -> f64| cheia.iter().map(f).collect::<Vec<_>>();
        let cx = suavizar(&coluna(|d| d.cx), ZONA_MORTA);
        let cy = suavizar(&coluna(|d| d.cy), ZONA_MORTA);
        let fw = suavizar(&coluna(|d| d.fw), 0.0);
        let fh = suavizar(&coluna(|d| d.fh), 0.0);
        for (i, a) in cena.iter().enumerate() {
            let mut d = Deteccao {
                cx: cx[i],
                cy: cy[i],
                fw: fw[i],
                fh: fh[i],
                pontuacao: 0.0,
            };
            if let Some(pin) = pins.iter().find(|p| a.t >= p.inicio && a.t <= p.fim) {
                d.cx = pin.cx;
            }
            pontos.push((a.t, d, n > 0 && i == 0));
        }
        ultimo = pontos.last().map_or(ultimo, |p| p.1);
    }

    let chaves: Vec<Chave> = pontos
        .iter()
        .map(|&(t, d, cut)| Chave {
            t: arredondar(t),
            cx: arredondar(d.cx),
            cy: arredondar(d.cy),
            fw: arredondar(d.fw),
            fh: arredondar(d.fh),
            cut,
        })
        .collect();
    let mesmo_lugar = |a: &Chave, b: &Chave| (a.cx, a.cy, a.fw, a.fh) == (b.cx, b.cy, b.fw, b.fh);
    // Uma chave igual à anterior e à seguinte não diz nada: o template interpola.
    let keys = chaves
        .iter()
        .enumerate()
        .filter(|&(i, c)| {
            c.cut
                || i == 0
                || i + 1 == chaves.len()
                || chaves[i + 1].cut
                || !(mesmo_lugar(c, &chaves[i - 1]) && mesmo_lugar(c, &chaves[i + 1]))
        })
        .map(|(_, c)| c.clone())
        .collect();

    let amostrados = amostras.len();
    Rastro {
        version: 2,
        keys,
        stats: Estatisticas {
            source: origem.nome.clone(),
            width: origem.largura,
            height: origem.altura,
            duration_sec: origem.duracao,
            samples: amostrados,
            face_ratio: if amostrados == 0 {
                0.0
            } else {
                arredondar(com_rosto as f64 / amostrados as f64)
            },
            shots: cenas.len(),
            detector: "yunet",
        },
    }
}

// ---- Do vídeo ao rastro ----

impl Ffmpeg {
    /// Segue o rosto no vídeo do corte: o ffmpeg entrega quadros a 5 Hz em 640 px, o YuNet
    /// acha os rostos e o acompanhamento escreve o rastro. `progresso` recebe a fração (0 a
    /// 1); ligar `cancelar` mata o ffmpeg.
    pub fn rastrear_rosto(
        &self,
        corte: &Path,
        pins: &[Pin],
        cancelar: &AtomicBool,
        progresso: &mut dyn FnMut(f64),
    ) -> Result<Rastro, ErroDoCorte> {
        let info = self.sondar(corte, cancelar)?;
        let (largura, altura) = match info.rotacao {
            90 | 270 => (info.altura, info.largura),
            _ => (info.largura, info.altura),
        };
        if largura == 0 || altura == 0 {
            return Err(ErroDoCorte::VideoIlegivel(corte.display().to_string()));
        }
        let quadro_l = LARGURA_DO_QUADRO.min(largura) as usize;
        let quadro_a =
            (f64::from(altura) * quadro_l as f64 / f64::from(largura) / 2.0).round() as usize * 2;
        let bytes = quadro_l * quadro_a * 3;
        let duracao = self.duracao(corte, cancelar)?;

        let mut comando = Command::new(self.caminho_do_ffmpeg());
        comando
            .args(["-hide_banner", "-nostats", "-v", "error", "-i"])
            .arg(corte)
            .arg("-vf")
            .arg(format!("fps={QUADROS_POR_SEGUNDO},scale={quadro_l}:-2"))
            .args(["-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
        hide_console(&mut comando);
        let mut filho = comando
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let mut saida = filho.stdout.take().expect("stdout em pipe");

        let mut detector = Detector::new();
        let mut amostras: Vec<Amostra> = Vec::new();
        let mut quadro = vec![0u8; bytes];
        let mut anterior: Option<Vec<f64>> = None;
        let resultado = loop {
            if cancelar.load(Ordering::Relaxed) {
                break Err(ErroDoCorte::Cancelado);
            }
            match ler_quadro(&mut saida, &mut quadro) {
                Ok(true) => {}
                Ok(false) => break Ok(()),
                Err(e) => break Err(e.into()),
            }
            let histograma = histograma_hsv(&quadro);
            let troca = anterior
                .as_deref()
                .is_some_and(|a| trocou_de_cena(a, &histograma));
            anterior = Some(histograma);
            let rostos = match detector.detectar(&quadro, quadro_l, quadro_a) {
                Ok(rostos) => rostos,
                Err(e) => {
                    break Err(ErroDoCorte::Falhou {
                        programa: "yunet",
                        detalhe: e.to_string(),
                    });
                }
            };
            let t = amostras.len() as f64 / QUADROS_POR_SEGUNDO;
            amostras.push(Amostra { t, troca, rostos });
            if duracao > 0.0 {
                progresso((t / duracao).min(1.0));
            }
        };
        if resultado.is_err() {
            let _ = filho.kill();
        }
        let status = filho.wait()?;
        resultado?;
        if !status.success() {
            return Err(ErroDoCorte::Falhou {
                programa: "ffmpeg",
                detalhe: format!("saiu com {status}"),
            });
        }
        progresso(1.0);
        let origem = Origem {
            nome: corte
                .file_name()
                .map_or_else(String::new, |n| n.to_string_lossy().into_owned()),
            largura,
            altura,
            duracao,
        };
        Ok(rastrear(&amostras, pins, &origem))
    }
}

/// Lê um quadro inteiro; `false` no fim do fluxo.
fn ler_quadro(fonte: &mut impl Read, quadro: &mut [u8]) -> io::Result<bool> {
    let mut lido = 0;
    while lido < quadro.len() {
        match fonte.read(&mut quadro[lido..])? {
            0 => return Ok(false),
            n => lido += n,
        }
    }
    Ok(true)
}
