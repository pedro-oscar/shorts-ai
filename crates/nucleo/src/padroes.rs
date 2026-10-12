//! Os padrões do lote: as opções que o passo Padrões escolhe para todos os projetos.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::Erro;
use crate::projeto::Opcoes;

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
        }
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

    /// As opções efetivas de um projeto novo: os padrões, enquanto não há exceções.
    pub(crate) fn opcoes(&self) -> Opcoes {
        Opcoes {
            quantidade_de_reels: self.quantidade_de_reels,
            previa: self.previa,
            pedido: self.pedido.trim().to_owned(),
            revisoes: self.revisoes,
            modelo: match self.modelo {
                ModeloDoClaude::Padrao => "padrao",
                ModeloDoClaude::Opus => "opus",
                ModeloDoClaude::Sonnet => "sonnet",
            }
            .to_owned(),
            nomes_proprios: self
                .nomes_proprios
                .iter()
                .map(|nome| nome.trim().to_owned())
                .filter(|nome| !nome.is_empty())
                .collect(),
            faixa: None,
        }
    }

    /// O idioma que já fica definido no projeto; `None` deixa a Transcrição detectar.
    pub(crate) fn idioma(&self) -> Option<&'static str> {
        match self.idioma_do_video {
            IdiomaDoVideo::Automatico => None,
            IdiomaDoVideo::Pt => Some("pt"),
            IdiomaDoVideo::En => Some("en"),
        }
    }
}
