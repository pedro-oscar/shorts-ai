//! A estimativa antes de gerar: quanto o lote deve custar em preço de API, quantas sessões do
//! Claude ele usa e quanto tempo leva nesta máquina. Todo valor é uma estimativa, em US$.
//!
//! Cada sessão do Claude usa tokens que crescem com o vídeo e com os cortes pedidos: o roteiro
//! tem uma parte fixa, uma parte por minuto de vídeo e uma parte por corte; a revisão, uma parte
//! fixa e uma parte por corte. Os tokens viram US$ pelos preços do modelo escolhido. Os
//! coeficientes iniciais saem da medição do vídeo de referência (744 s, 2 cortes: roteiro a
//! US$ 0,91 e revisão a US$ 0,28 no Opus); depois de 3 execuções do próprio usuário, a faixa
//! passa a ir da mediana ao percentil 90 do que ele gastou em relação ao previsto.

use std::path::Path;

use serde::Serialize;
use specta::Type;

use crate::custo::{PrecosDoModelo, TabelaDePrecos};
use crate::diagnostico::Gpu;
use crate::lote::LoteJson;
use crate::padroes::{ModeloDoClaude, Padroes};
use crate::projeto::ProjetoJson;
use crate::{Etapa, ResumoDeCusto};

/// O modelo da conta quando nada é pedido: o da medição de referência.
const MODELO_PADRAO: &str = "claude-opus-5-5";
const POR_MILHAO: f64 = 1_000_000.0;
/// Quantas execuções a pessoa precisa ter para a faixa deixar de ser "inicial".
const EXECUCOES_PARA_CALIBRAR: usize = 3;
/// Quando nenhum vídeo do lote tem a duração conhecida.
const MINUTOS_SEM_DURACAO: f64 = 10.0;
/// A faixa do custo e das sessões antes de haver execuções, em relação ao previsto.
const FAIXA_INICIAL: (f64, f64) = (0.7, 1.8);
/// A faixa do tempo da transcrição e do render, que não se calibra.
const FAIXA_DO_TEMPO_FIXO: (f64, f64) = (0.8, 1.4);

/// Tokens de uma sessão, por tipo de cobrança.
#[derive(Debug, Clone, Copy)]
struct Uso {
    entrada: f64,
    saida: f64,
    leitura: f64,
    criacao: f64,
}

impl Uso {
    const ZERO: Self = Self::de(0.0, 0.0, 0.0, 0.0);

    const fn de(entrada: f64, saida: f64, leitura: f64, criacao: f64) -> Self {
        Self {
            entrada,
            saida,
            leitura,
            criacao,
        }
    }

    fn mais(self, outro: Self, vezes: f64) -> Self {
        Self {
            entrada: self.entrada + outro.entrada * vezes,
            saida: self.saida + outro.saida * vezes,
            leitura: self.leitura + outro.leitura * vezes,
            criacao: self.criacao + outro.criacao * vezes,
        }
    }

    fn custo(self, precos: &PrecosDoModelo) -> f64 {
        (self.entrada * precos.entrada
            + self.saida * precos.saida
            + self.leitura * precos.leitura
            + self.criacao * precos.escrita1h)
            / POR_MILHAO
    }
}

/// Os tokens de uma sessão: a parte fixa, mais a parte de cada minuto e de cada corte.
struct Coeficientes {
    fixo: Uso,
    por_minuto: Uso,
    por_corte: Uso,
}

impl Coeficientes {
    fn tokens(&self, minutos: f64, cortes: f64) -> Uso {
        self.fixo
            .mais(self.por_minuto, minutos)
            .mais(self.por_corte, cortes)
    }
}

const ROTEIRO: Coeficientes = Coeficientes {
    fixo: Uso::de(20.0, 4_000.0, 300_000.0, 30_000.0),
    por_minuto: Uso::de(0.0, 400.0, 25_000.0, 2_000.0),
    por_corte: Uso::de(0.0, 2_000.0, 40_000.0, 2_500.0),
};

const REVISAO: Coeficientes = Coeficientes {
    fixo: Uso::de(10.0, 1_500.0, 200_000.0, 15_000.0),
    por_minuto: Uso::ZERO,
    por_corte: Uso::de(0.0, 500.0, 30_000.0, 3_000.0),
};

/// O tempo, em segundos, da sessão de roteiro (fixo, por minuto e por corte).
const TEMPO_DO_ROTEIRO: (f64, f64, f64) = (60.0, 5.0, 15.0);
/// O tempo, em segundos, da sessão de revisão (fixo e por corte).
const TEMPO_DA_REVISAO: (f64, f64) = (20.0, 6.0);
/// A transcrição, em segundos: fixo e por segundo de vídeo, com a GPU (Vulkan) e só com a CPU.
const TEMPO_DA_TRANSCRICAO_GPU: (f64, f64) = (15.0, 0.1);
const TEMPO_DA_TRANSCRICAO_CPU: (f64, f64) = (30.0, 5.5);
/// O render de um reel, em segundos, na prévia e na versão final direta.
const TEMPO_DO_RENDER_DA_PREVIA: f64 = 200.0;
const TEMPO_DO_RENDER_FINAL: f64 = 225.0;

/// De quanto a quanto o lote deve custar, em US$ de preço de API.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FaixaDeCusto {
    pub de_usd: f64,
    pub ate_usd: f64,
}

/// De quanto a quanto tempo o lote deve levar.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FaixaDeTempo {
    pub de_s: f64,
    pub ate_s: f64,
}

/// A estimativa do passo Padrões.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Estimativa {
    /// O custo de um vídeo do lote: a média entre eles.
    pub por_video: FaixaDeCusto,
    pub lote: FaixaDeCusto,
    /// As sessões do Claude do lote, contando todas as revisões pedidas.
    pub sessoes: u32,
    pub tempo: FaixaDeTempo,
    /// Menos de 3 execuções: a faixa vem dos coeficientes iniciais.
    pub inicial: bool,
    /// As execuções do histórico que calibram a faixa.
    pub execucoes: u32,
    /// O modelo cujos preços entram na conta não está na tabela: o custo sai zerado.
    pub sem_preco: bool,
}

/// Um projeto já feito: o que ele pediu e o que as sessões do Claude gastaram.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Execucao {
    pub minutos: f64,
    pub cortes: u32,
    pub revisoes: u32,
    pub modelo: String,
    pub custo_usd: f64,
    pub sessoes_s: f64,
}

/// Os projetos da Biblioteca com roteiro completo, para calibrar a faixa. `minutos` informa a
/// duração do vídeo de um projeto.
pub(crate) fn historico(
    biblioteca: &Path,
    minutos: impl Fn(&Path, &ProjetoJson) -> Option<f64>,
) -> Vec<Execucao> {
    LoteJson::listar(biblioteca)
        .iter()
        .flat_map(|lote| &lote.projetos)
        .filter_map(|id| {
            let pasta = biblioteca.join(id);
            let json = ProjetoJson::ler(&pasta).ok()?;
            let custo = ResumoDeCusto::do_projeto(&pasta);
            let sessoes: Vec<_> = custo
                .sessoes
                .iter()
                .filter(|s| matches!(s.etapa, Etapa::Roteiro | Etapa::Revisao))
                .collect();
            let tem_roteiro = sessoes.iter().any(|s| s.etapa == Etapa::Roteiro);
            let modelo = sessoes.first()?.modelos.first()?.clone();
            if !tem_roteiro || sessoes.iter().any(|s| s.parcial) {
                return None;
            }
            Some(Execucao {
                minutos: minutos(&pasta, &json)?,
                cortes: u32::from(json.opcoes.quantidade_de_reels),
                revisoes: u32::try_from(
                    sessoes.iter().filter(|s| s.etapa == Etapa::Revisao).count(),
                )
                .ok()?,
                modelo,
                custo_usd: sessoes.iter().map(|s| s.custo_usd).sum(),
                sessoes_s: sessoes.iter().map(|s| s.duracao_s).sum(),
            })
        })
        .collect()
}

/// O custo previsto das sessões do Claude de um vídeo.
fn custo_previsto(minutos: f64, cortes: u32, revisoes: u32, precos: &PrecosDoModelo) -> f64 {
    let cortes = f64::from(cortes);
    ROTEIRO.tokens(minutos, cortes).custo(precos)
        + f64::from(revisoes) * REVISAO.tokens(minutos, cortes).custo(precos)
}

/// O tempo previsto das sessões do Claude de um vídeo, em segundos.
fn tempo_previsto_das_sessoes(minutos: f64, cortes: u32, revisoes: u32) -> f64 {
    let cortes = f64::from(cortes);
    let (fixo, por_minuto, por_corte) = TEMPO_DO_ROTEIRO;
    let (fixo_da_revisao, por_corte_da_revisao) = TEMPO_DA_REVISAO;
    fixo + por_minuto * minutos
        + por_corte * cortes
        + f64::from(revisoes) * (fixo_da_revisao + por_corte_da_revisao * cortes)
}

/// O valor no percentil `p` (de 0 a 1) de valores já ordenados, interpolado entre vizinhos.
fn percentil(ordenados: &[f64], p: f64) -> f64 {
    let posicao = p * (ordenados.len() - 1) as f64;
    let (abaixo, acima) = (posicao.floor() as usize, posicao.ceil() as usize);
    ordenados[abaixo] + (ordenados[acima] - ordenados[abaixo]) * (posicao - posicao.floor())
}

/// De quanto a quanto o gasto real fica em relação ao previsto: da mediana ao percentil 90.
fn faixa_de_razoes(razoes: &mut [f64]) -> (f64, f64) {
    razoes.sort_by(f64::total_cmp);
    (percentil(razoes, 0.5), percentil(razoes, 0.9))
}

struct Calibragem {
    custo: (f64, f64),
    sessoes: (f64, f64),
    execucoes: usize,
}

fn calibrar(historico: &[Execucao], tabela: &TabelaDePrecos) -> Calibragem {
    let mut custos = Vec::new();
    let mut tempos = Vec::new();
    for execucao in historico {
        let Some(precos) = tabela.precos(&execucao.modelo) else {
            continue;
        };
        let previsto = custo_previsto(execucao.minutos, execucao.cortes, execucao.revisoes, precos);
        let tempo =
            tempo_previsto_das_sessoes(execucao.minutos, execucao.cortes, execucao.revisoes);
        if previsto > 0.0 && execucao.custo_usd > 0.0 {
            custos.push(execucao.custo_usd / previsto);
            tempos.push(execucao.sessoes_s / tempo);
        }
    }
    if custos.len() < EXECUCOES_PARA_CALIBRAR {
        return Calibragem {
            custo: FAIXA_INICIAL,
            sessoes: FAIXA_INICIAL,
            execucoes: custos.len(),
        };
    }
    Calibragem {
        execucoes: custos.len(),
        custo: faixa_de_razoes(&mut custos),
        sessoes: faixa_de_razoes(&mut tempos),
    }
}

/// Quantos vídeos a fila roda ao mesmo tempo e quantas sessões do Claude cabem juntas.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Fila {
    pub videos: u8,
    pub sessoes: u8,
}

/// Estima o lote: `duracoes_s` tem a duração de cada vídeo (`None` quando não se sabe). Com
/// mais de um vídeo ao mesmo tempo, o primeiro leva o tempo dele inteiro e cada um dos outros
/// leva o do recurso mais disputado: o render, a GPU, as sessões do Claude divididas pelas
/// vagas, ou o vídeo inteiro dividido pelos vídeos ao mesmo tempo. Com um vídeo de cada vez,
/// isso é a soma dos vídeos.
pub(crate) fn estimar(
    padroes: &Padroes,
    duracoes_s: &[Option<f64>],
    tabela: &TabelaDePrecos,
    historico: &[Execucao],
    gpu: Gpu,
    fila: Fila,
) -> Estimativa {
    let calibragem = calibrar(historico, tabela);
    let modelo = match padroes.modelo {
        ModeloDoClaude::Padrao | ModeloDoClaude::Opus => MODELO_PADRAO,
        ModeloDoClaude::Sonnet => "claude-sonnet-5-5",
    };
    let precos = tabela.precos(modelo);
    let conhecidas: Vec<f64> = duracoes_s.iter().flatten().copied().collect();
    let media_s = if conhecidas.is_empty() {
        MINUTOS_SEM_DURACAO * 60.0
    } else {
        conhecidas.iter().sum::<f64>() / conhecidas.len() as f64
    };
    let cortes = u32::from(padroes.quantidade_de_reels);
    let revisoes = u32::from(padroes.revisoes);
    let (transcricao_fixa, transcricao_por_s) = match gpu {
        Gpu::Vulkan => TEMPO_DA_TRANSCRICAO_GPU,
        Gpu::SoCpu => TEMPO_DA_TRANSCRICAO_CPU,
    };
    let render = if padroes.previa {
        TEMPO_DO_RENDER_DA_PREVIA
    } else {
        TEMPO_DO_RENDER_FINAL
    } * f64::from(cortes);

    let mut custo_previsto_total = 0.0;
    // O tempo de cada vídeo: as sessões do Claude, a transcrição e o render.
    let mut tempos = Vec::new();
    for duracao in duracoes_s {
        let segundos = duracao.unwrap_or(media_s);
        let minutos = segundos / 60.0;
        custo_previsto_total +=
            precos.map_or(0.0, |p| custo_previsto(minutos, cortes, revisoes, p));
        tempos.push((
            tempo_previsto_das_sessoes(minutos, cortes, revisoes),
            transcricao_fixa + transcricao_por_s * segundos,
            render,
        ));
    }
    let tempo_do_lote = |fator_das_sessoes: f64, fator_fixo: f64| {
        tempos
            .iter()
            .enumerate()
            .map(|(indice, &(sessoes, transcricao, render))| {
                let (sessoes, transcricao, render) = (
                    sessoes * fator_das_sessoes,
                    transcricao * fator_fixo,
                    render * fator_fixo,
                );
                let inteiro = sessoes + transcricao + render;
                if indice == 0 {
                    inteiro
                } else {
                    (sessoes / f64::from(fila.sessoes.max(1)))
                        .max(transcricao)
                        .max(render)
                        .max(inteiro / f64::from(fila.videos.max(1)))
                }
            })
            .sum::<f64>()
    };
    let videos = duracoes_s.len().max(1) as f64;
    let lote = FaixaDeCusto {
        de_usd: custo_previsto_total * calibragem.custo.0,
        ate_usd: custo_previsto_total * calibragem.custo.1,
    };
    Estimativa {
        por_video: FaixaDeCusto {
            de_usd: lote.de_usd / videos,
            ate_usd: lote.ate_usd / videos,
        },
        lote,
        sessoes: u32::try_from(duracoes_s.len()).unwrap_or(u32::MAX) * (1 + revisoes),
        tempo: FaixaDeTempo {
            de_s: tempo_do_lote(calibragem.sessoes.0, FAIXA_DO_TEMPO_FIXO.0),
            ate_s: tempo_do_lote(calibragem.sessoes.1, FAIXA_DO_TEMPO_FIXO.1),
        },
        inicial: calibragem.execucoes < EXECUCOES_PARA_CALIBRAR,
        execucoes: u32::try_from(calibragem.execucoes).unwrap_or(u32::MAX),
        sem_preco: precos.is_none(),
    }
}
