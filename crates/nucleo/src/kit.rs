//! O kit de marca: as cores e as fontes da legenda e dos títulos (ADR 0007). Os kits ficam nas
//! preferências; ao criar um projeto, o kit escolhido é copiado para `kit.json` dentro dele.

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use specta::Type;

use crate::Erro;
use crate::files::write_json;

/// O nome do kit que sempre existe e não pode ser apagado.
pub const NOME_DO_KIT_PADRAO: &str = "Padrão";
const ARQUIVO: &str = "kit.json";

/// As fontes embutidas, todas OFL, com o jeito de cada uma para o resumo que o Claude lê.
const FONTES: [(&str, Largura); 8] = [
    ("Montserrat", Largura::Larga),
    ("Anton", Largura::Condensada),
    ("Bebas Neue", Largura::Condensada),
    ("Archivo Black", Largura::Larga),
    ("Bangers", Largura::Condensada),
    ("Oswald", Largura::Condensada),
    ("Poppins", Largura::Larga),
    ("Inter", Largura::Larga),
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Largura {
    Larga,
    Condensada,
}

/// Os nomes das fontes embutidas, que a validação do roteiro confere.
pub fn catalogo_de_fontes() -> BTreeSet<String> {
    FONTES.iter().map(|(nome, _)| (*nome).to_owned()).collect()
}

/// As fontes que a interface oferece na galeria, na ordem do catálogo.
pub fn fontes_embutidas() -> Vec<String> {
    FONTES.iter().map(|(nome, _)| (*nome).to_owned()).collect()
}

/// Um kit de marca.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Kit {
    pub nome: String,
    /// `#RRGGBB`: títulos, palavras-chave e palavras de ênfase.
    pub cor_de_destaque: String,
    /// `#RRGGBB`: a palavra sendo falada na legenda.
    pub cor_da_palavra: String,
    pub fonte_da_legenda: String,
    pub fonte_dos_titulos: String,
}

impl Default for Kit {
    /// O kit Padrão: como os reels saem sem kit.
    fn default() -> Self {
        Self {
            nome: NOME_DO_KIT_PADRAO.to_owned(),
            cor_de_destaque: "#FF2D2D".to_owned(),
            cor_da_palavra: "#FFE600".to_owned(),
            fonte_da_legenda: "Montserrat".to_owned(),
            fonte_dos_titulos: "Montserrat".to_owned(),
        }
    }
}

impl Kit {
    /// Confere o nome, as cores e as fontes; o nome sai sem os espaços das pontas.
    pub(crate) fn validar(mut self) -> Result<Self, Erro> {
        let invalido = |opcao: &str, motivo: &str| Erro::PadroesInvalidos {
            opcao: opcao.to_owned(),
            motivo: motivo.to_owned(),
        };
        self.nome = self.nome.trim().to_owned();
        if self.nome.is_empty() {
            return Err(invalido("nome", "não pode ficar vazio"));
        }
        for (opcao, cor) in [
            ("corDeDestaque", &self.cor_de_destaque),
            ("corDaPalavra", &self.cor_da_palavra),
        ] {
            if !e_cor(cor) {
                return Err(invalido(opcao, "tem de ser #RRGGBB"));
            }
        }
        for (opcao, fonte) in [
            ("fonteDaLegenda", &self.fonte_da_legenda),
            ("fonteDosTitulos", &self.fonte_dos_titulos),
        ] {
            if !FONTES.iter().any(|(nome, _)| nome == fonte) {
                return Err(invalido(opcao, "não está entre as fontes embutidas"));
            }
        }
        Ok(self)
    }

    /// O `estilo` do roteiro que o kit define.
    pub fn estilo(&self) -> Map<String, Value> {
        let Value::Object(estilo) = json!({
            "accent": self.cor_de_destaque,
            "highlight": self.cor_da_palavra,
            "fontes": {
                "legenda": self.fonte_da_legenda,
                "titulos": self.fonte_dos_titulos,
            },
        }) else {
            unreachable!("o json! acima é um objeto")
        };
        estilo
    }

    /// O resumo que o prompt do roteiro recebe: o Claude encurta os títulos nas fontes
    /// condensadas ou largas.
    pub fn resumo(&self) -> String {
        let jeito = |fonte: &str| {
            match FONTES.iter().find(|(nome, _)| *nome == fonte) {
                Some((_, Largura::Condensada)) => "condensada, cabe mais texto por linha",
                _ => "larga, cabe menos texto por linha",
            }
            .to_owned()
        };
        format!(
            "- Fonte da legenda: {} ({}).\n- Fonte dos títulos: {} ({}).\n",
            self.fonte_da_legenda,
            jeito(&self.fonte_da_legenda),
            self.fonte_dos_titulos,
            jeito(&self.fonte_dos_titulos),
        )
    }

    /// Copia o kit para dentro do projeto.
    pub(crate) fn gravar(&self, pasta: &Path) -> io::Result<()> {
        write_json(&pasta.join(ARQUIVO), self)
    }

    /// O kit copiado para o projeto; `None` se o projeto não tem um.
    pub(crate) fn ler(pasta: &Path) -> Option<Self> {
        serde_json::from_slice(&fs::read(pasta.join(ARQUIVO)).ok()?).ok()
    }
}

fn e_cor(texto: &str) -> bool {
    texto.len() == 7 && texto.starts_with('#') && texto[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// O kit Padrão seguido dos kits salvos; um salvo com o nome do Padrão não vale.
pub(crate) fn todos(salvos: &[Kit]) -> Vec<Kit> {
    std::iter::once(Kit::default())
        .chain(
            salvos
                .iter()
                .filter(|kit| kit.nome != NOME_DO_KIT_PADRAO)
                .cloned(),
        )
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_estilo_do_kit_padrao_tem_as_cores_e_a_fonte_de_antes() {
        let estilo = Kit::default().estilo();

        assert_eq!(estilo["accent"], "#FF2D2D");
        assert_eq!(estilo["highlight"], "#FFE600");
        assert_eq!(estilo["fontes"]["legenda"], "Montserrat");
    }

    #[test]
    fn o_resumo_diz_se_a_fonte_e_condensada() {
        let kit = Kit {
            fonte_dos_titulos: "Anton".to_owned(),
            ..Kit::default()
        };

        let resumo = kit.resumo();

        assert!(resumo.contains("Montserrat (larga"));
        assert!(resumo.contains("Anton (condensada"));
    }
}
