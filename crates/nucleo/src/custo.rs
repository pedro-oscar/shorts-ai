//! O custo das sessões do Claude: o preço de API que o app calcula com a tabela de preços, a
//! conferência contra o `total_cost_usd` do Claude Code e os totais por sessão, projeto e lote.
//! Todo valor é uma estimativa, sempre em US$.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::Etapa;
use crate::files::write_json;
use crate::galeria;
use crate::sessao::{Custo, UsoDoModelo};

const PRECOS_EMBUTIDOS: &str = include_str!("../assets/precos.json");
/// A última tabela baixada, nos dados do app.
const PRECOS_BAIXADOS: &str = "precos.json";
const CUSTOS: &str = "edit/custos.json";
/// A diferença, em relação ao maior dos dois valores, a partir da qual o preço fica "a conferir".
const TOLERANCIA: f64 = 0.05;
const POR_MILHAO: f64 = 1_000_000.0;

/// Os preços de um modelo, em US$ por milhão de tokens.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PrecosDoModelo {
    pub entrada: f64,
    pub escrita5min: f64,
    pub escrita1h: f64,
    pub leitura: f64,
    pub saida: f64,
}

/// A tabela de preços, datada. O Claude Code escreve o cache por uma hora, então a escrita de
/// cache do `modelUsage` vale o preço de 1 h.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TabelaDePrecos {
    /// O dia em que os preços valiam, `AAAA-MM-DD`.
    pub data: String,
    pub modelos: BTreeMap<String, PrecosDoModelo>,
}

impl TabelaDePrecos {
    /// A cópia que vai dentro do app.
    pub fn embutida() -> Self {
        Self::de_json(PRECOS_EMBUTIDOS).expect("a tabela de preços embutida é válida")
    }

    pub fn de_json(texto: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(texto)
    }

    /// A última tabela baixada para os dados do app, se for mais nova que a embutida; senão, a
    /// embutida.
    pub fn atual(app_data_dir: &Path) -> Self {
        let embutida = Self::embutida();
        fs::read_to_string(app_data_dir.join(PRECOS_BAIXADOS))
            .ok()
            .and_then(|texto| Self::de_json(&texto).ok())
            .filter(|baixada| baixada.data > embutida.data)
            .unwrap_or(embutida)
    }

    /// Baixa a tabela publicada em `url` e a guarda nos dados do app. Um texto que não é uma
    /// tabela não substitui a anterior.
    pub fn baixar(url: &str, app_data_dir: &Path) -> io::Result<Self> {
        let texto = ureq::get(url)
            .call()
            .map_err(io::Error::other)?
            .into_body()
            .read_to_string()
            .map_err(io::Error::other)?;
        let tabela = Self::de_json(&texto)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        fs::create_dir_all(app_data_dir)?;
        write_json(&app_data_dir.join(PRECOS_BAIXADOS), &tabela)?;
        Ok(tabela)
    }

    /// Os preços do modelo; `claude-haiku-4-5-20251001` vale o `claude-haiku-4-5`.
    fn precos(&self, modelo: &str) -> Option<&PrecosDoModelo> {
        self.modelos
            .iter()
            .filter(|(nome, _)| modelo.starts_with(nome.as_str()))
            .max_by_key(|(nome, _)| nome.len())
            .map(|(_, precos)| precos)
    }

    /// O preço de API dos tokens de cada modelo; `None` se algum modelo não está na tabela.
    pub fn preco_de_api(&self, modelos: &BTreeMap<String, UsoDoModelo>) -> Option<f64> {
        modelos
            .iter()
            .map(|(nome, uso)| {
                let precos = self.precos(nome)?;
                let custo = uso.entrada as f64 * precos.entrada
                    + uso.saida as f64 * precos.saida
                    + uso.cache_leitura as f64 * precos.leitura
                    + uso.cache_criacao as f64 * precos.escrita1h;
                Some(custo / POR_MILHAO)
            })
            .sum()
    }
}

/// O preço do app não bate com o do Claude Code: a diferença passa de 5%, o `costBasis` é
/// `unknown` ou o modelo não está na tabela.
pub fn preco_a_conferir(
    calculado: Option<f64>,
    informado: f64,
    modelos: &BTreeMap<String, UsoDoModelo>,
) -> bool {
    let desconhecido = modelos
        .values()
        .any(|uso| uso.custo_base.as_deref() == Some("unknown"));
    let Some(calculado) = calculado else {
        return true;
    };
    let maior = calculado.max(informado);
    desconhecido || (maior > 0.0 && (calculado - informado).abs() > maior * TOLERANCIA)
}

/// Os tokens de uma sessão, de um projeto ou de um lote.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub entrada: u32,
    pub saida: u32,
    pub cache_leitura: u32,
    pub cache_criacao: u32,
}

impl Tokens {
    fn somar(&mut self, outro: Self) {
        self.entrada = self.entrada.saturating_add(outro.entrada);
        self.saida = self.saida.saturating_add(outro.saida);
        self.cache_leitura = self.cache_leitura.saturating_add(outro.cache_leitura);
        self.cache_criacao = self.cache_criacao.saturating_add(outro.cache_criacao);
    }
}

/// Uma sessão do Claude, como a interface mostra o detalhe da etapa.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CustoDaSessao {
    pub etapa: Etapa,
    /// A posição entre as sessões da mesma etapa: a Revisão 1, a Revisão 2.
    pub ordem: u32,
    pub tokens: Tokens,
    /// O preço de API estimado: o do app e, sem ele, o do Claude Code.
    pub custo_usd: f64,
    pub duracao_s: f64,
    pub modelos: Vec<String>,
    pub parcial: bool,
    pub preco_a_conferir: bool,
}

/// O custo de um projeto (com o detalhe das sessões) ou de um lote (sem ele).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResumoDeCusto {
    pub sessoes: Vec<CustoDaSessao>,
    pub tokens: Tokens,
    pub custo_usd: f64,
    pub duracao_s: f64,
    pub parcial: bool,
    pub preco_a_conferir: bool,
    /// Os reels produzidos, sem as reservas.
    pub reels: u32,
    /// O custo dividido pelos reels produzidos; `None` enquanto não há reel.
    pub por_reel_usd: Option<f64>,
}

impl ResumoDeCusto {
    /// O resumo das sessões do `edit/custos.json` do projeto, rateado pelos reels dele.
    pub(crate) fn do_projeto(pasta: &Path) -> Self {
        let linhas: Vec<Custo> = fs::read(pasta.join(CUSTOS))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<serde_json::Value>>(&bytes).ok())
            .into_iter()
            .flatten()
            .filter_map(|linha| serde_json::from_value(linha).ok())
            .collect();
        let reels = galeria::ler(pasta).map_or(0, |dados| dados.reels.len());
        let mut por_etapa: BTreeMap<String, u32> = BTreeMap::new();
        let mut resumo = Self::default();
        for linha in linhas {
            let ordem = por_etapa
                .entry(format!("{:?}", linha.etapa))
                .and_modify(|n| *n += 1)
                .or_insert(1);
            let sessao = CustoDaSessao::de(&linha, *ordem);
            resumo.acrescentar(&sessao);
            resumo.sessoes.push(sessao);
        }
        resumo.ratear(reels);
        resumo
    }

    /// A soma dos projetos de um lote, sem o detalhe das sessões.
    pub(crate) fn do_lote<'a>(projetos: impl IntoIterator<Item = &'a Self>) -> Self {
        let mut lote = Self::default();
        for projeto in projetos {
            lote.tokens.somar(projeto.tokens);
            lote.custo_usd += projeto.custo_usd;
            lote.duracao_s += projeto.duracao_s;
            lote.parcial |= projeto.parcial;
            lote.preco_a_conferir |= projeto.preco_a_conferir;
            lote.reels += projeto.reels;
        }
        lote.ratear(lote.reels as usize);
        lote
    }

    fn acrescentar(&mut self, sessao: &CustoDaSessao) {
        self.tokens.somar(sessao.tokens);
        self.custo_usd += sessao.custo_usd;
        self.duracao_s += sessao.duracao_s;
        self.parcial |= sessao.parcial;
        self.preco_a_conferir |= sessao.preco_a_conferir;
    }

    fn ratear(&mut self, reels: usize) {
        self.reels = u32::try_from(reels).unwrap_or(u32::MAX);
        self.por_reel_usd = (reels > 0).then(|| self.custo_usd / reels as f64);
    }
}

impl CustoDaSessao {
    fn de(linha: &Custo, ordem: u32) -> Self {
        let soma = |campo: fn(&UsoDoModelo) -> u64| {
            u32::try_from(linha.modelos.values().map(campo).sum::<u64>()).unwrap_or(u32::MAX)
        };
        Self {
            etapa: linha.etapa,
            ordem,
            tokens: Tokens {
                entrada: soma(|uso| uso.entrada),
                saida: soma(|uso| uso.saida),
                cache_leitura: soma(|uso| uso.cache_leitura),
                cache_criacao: soma(|uso| uso.cache_criacao),
            },
            custo_usd: linha.custo_calculado_usd.unwrap_or(linha.custo_usd),
            duracao_s: linha.duracao_ms as f64 / 1000.0,
            modelos: linha.modelos.keys().cloned().collect(),
            parcial: linha.parcial,
            preco_a_conferir: linha.preco_a_conferir,
        }
    }
}
