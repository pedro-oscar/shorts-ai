//! Os padrões do lote: as opções que o passo Padrões escolhe para todos os projetos.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::Erro;
use crate::kit::NOME_DO_KIT_PADRAO;
use crate::projeto::{Faixa, Opcoes};

/// O modelo das sessões do Claude.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ModeloDoClaude {
    /// O que a conta usa quando nada é pedido.
    Padrao,
    Opus,
    Sonnet,
}

/// O idioma falado no vídeo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum IdiomaDoVideo {
    /// A Transcrição detecta o idioma.
    Automatico,
    Pt,
    En,
}

/// As opções do lote, como a pessoa as escolhe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Padroes {
    /// De 1 a 12.
    pub quantidade_de_reels: u8,
    pub previa: bool,
    pub pedido: String,
    /// De 0 a 3.
    pub revisoes: u8,
    pub modelo: ModeloDoClaude,
    pub nomes_proprios: Vec<String>,
    pub idioma_do_video: IdiomaDoVideo,
    /// O nome do kit de marca; os projetos do lote recebem uma cópia dele.
    #[serde(default = "kit_padrao")]
    pub kit: String,
}

fn kit_padrao() -> String {
    NOME_DO_KIT_PADRAO.to_owned()
}

impl Default for Padroes {
    fn default() -> Self {
        Self {
            quantidade_de_reels: 6,
            previa: true,
            pedido: String::new(),
            revisoes: 1,
            modelo: ModeloDoClaude::Padrao,
            nomes_proprios: Vec::new(),
            idioma_do_video: IdiomaDoVideo::Automatico,
            kit: kit_padrao(),
        }
    }
}

/// As exceções de um projeto: cada opção definida vale no lugar do padrão do lote.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct Excecoes {
    /// De 1 a 12.
    pub quantidade_de_reels: Option<u8>,
    /// Substitui o pedido do lote, inclusive por um pedido vazio.
    pub pedido: Option<String>,
    /// A parte do vídeo a que a análise se limita; o lote não tem faixa padrão.
    pub faixa: Option<Faixa>,
    pub nomes_proprios: Option<Vec<String>>,
    pub idioma_do_video: Option<IdiomaDoVideo>,
}

impl Excecoes {
    /// Confere os limites e a faixa; a faixa que pede o vídeo inteiro deixa de ser exceção.
    pub(crate) fn validar(mut self) -> Result<Self, Erro> {
        let invalido = |opcao: &str, motivo: &str| Erro::PadroesInvalidos {
            opcao: opcao.to_owned(),
            motivo: motivo.to_owned(),
        };
        if self
            .quantidade_de_reels
            .is_some_and(|quantidade| !(1..=12).contains(&quantidade))
        {
            return Err(invalido("quantidadeDeReels", "vai de 1 a 12"));
        }
        self.faixa = Faixa::validar(self.faixa).map_err(|motivo| invalido("faixa", &motivo))?;
        Ok(self)
    }
}

impl Padroes {
    /// Confere os limites das opções.
    pub(crate) fn validar(&self) -> Result<(), Erro> {
        let invalido = |opcao: &str, motivo: &str| {
            Err(Erro::PadroesInvalidos {
                opcao: opcao.to_owned(),
                motivo: motivo.to_owned(),
            })
        };
        if !(1..=12).contains(&self.quantidade_de_reels) {
            return invalido("quantidadeDeReels", "vai de 1 a 12");
        }
        if self.revisoes > 3 {
            return invalido("revisoes", "vai de 0 a 3");
        }
        Ok(())
    }

    /// As opções efetivas de um projeto: os padrões, com as exceções no lugar.
    pub(crate) fn opcoes(&self, excecoes: &Excecoes) -> Opcoes {
        let limpar = |nomes: &[String]| -> Vec<String> {
            nomes
                .iter()
                .map(|nome| nome.trim().to_owned())
                .filter(|nome| !nome.is_empty())
                .collect()
        };
        Opcoes {
            quantidade_de_reels: excecoes
                .quantidade_de_reels
                .unwrap_or(self.quantidade_de_reels),
            previa: self.previa,
            pedido: excecoes
                .pedido
                .as_deref()
                .unwrap_or(&self.pedido)
                .trim()
                .to_owned(),
            revisoes: self.revisoes,
            modelo: match self.modelo {
                ModeloDoClaude::Padrao => "padrao",
                ModeloDoClaude::Opus => "opus",
                ModeloDoClaude::Sonnet => "sonnet",
            }
            .to_owned(),
            nomes_proprios: limpar(
                excecoes
                    .nomes_proprios
                    .as_deref()
                    .unwrap_or(&self.nomes_proprios),
            ),
            faixa: excecoes.faixa,
        }
    }

    /// O idioma que já fica definido no projeto; `None` deixa a Transcrição detectar.
    pub(crate) fn idioma(&self, excecoes: &Excecoes) -> Option<&'static str> {
        match excecoes.idioma_do_video.unwrap_or(self.idioma_do_video) {
            IdiomaDoVideo::Automatico => None,
            IdiomaDoVideo::Pt => Some("pt"),
            IdiomaDoVideo::En => Some("en"),
        }
    }
}
