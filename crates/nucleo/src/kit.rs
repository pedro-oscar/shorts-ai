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
/// A pasta, dentro do projeto, para onde a logo é copiada: o `public/` do Remotion.
const PUBLICO: &str = "remotion/public";
const LARGURA_DA_LOGO: std::ops::RangeInclusive<u8> = 6..=30;
const OPACIDADE_DA_LOGO: std::ops::RangeInclusive<u8> = 20..=100;

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

/// Onde a logo fica no reel: o canto mais longe do rosto em cada trecho, ou um canto fixo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PosicaoDaLogo {
    Automatica,
    SuperiorEsquerdo,
    SuperiorDireito,
    InferiorEsquerdo,
    InferiorDireito,
}

/// Em que momento do reel a logo aparece.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum QuandoAparece {
    /// O reel todo.
    Sempre,
    /// Só nos 3 primeiros segundos.
    Inicio,
    /// Só nos 3 últimos segundos.
    Fim,
}

/// A logo do kit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Logo {
    /// O PNG ou SVG que a pessoa escolheu.
    pub arquivo: String,
    pub posicao: PosicaoDaLogo,
    /// Largura em % da largura do reel, de 6 a 30.
    pub largura: u8,
    /// Opacidade em %, de 20 a 100.
    pub opacidade: u8,
    pub quando: QuandoAparece,
    /// Altura ÷ largura da imagem; o núcleo a confere ao validar o kit.
    #[serde(default = "quadrada")]
    pub proporcao: f64,
}

fn quadrada() -> f64 {
    1.0
}

impl Logo {
    /// A logo com os padrões: automática, 14% de largura, 80% de opacidade, o reel todo.
    pub fn nova(arquivo: impl Into<String>) -> Self {
        Self {
            arquivo: arquivo.into(),
            posicao: PosicaoDaLogo::Automatica,
            largura: 14,
            opacidade: 80,
            quando: QuandoAparece::Sempre,
            proporcao: 1.0,
        }
    }

    fn extensao(&self) -> String {
        Path::new(&self.arquivo)
            .extension()
            .map(|extensao| extensao.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    }

    /// O nome da cópia dentro do `public/` do Remotion.
    fn nome_da_copia(&self) -> String {
        format!("logo.{}", self.extensao())
    }

    /// O resumo da posição que o prompt do roteiro recebe.
    fn resumo(&self) -> String {
        let onde = match self.posicao {
            PosicaoDaLogo::Automatica => {
                "no canto mais longe do rosto em cada trecho (o layout escolhe)"
            }
            PosicaoDaLogo::SuperiorEsquerdo => "no canto superior esquerdo",
            PosicaoDaLogo::SuperiorDireito => "no canto superior direito",
            PosicaoDaLogo::InferiorEsquerdo => "no canto inferior esquerdo",
            PosicaoDaLogo::InferiorDireito => "no canto inferior direito",
        };
        format!(
            "- Logo {onde}, com {}% da largura do reel: não ponha título nem card nesse espaço.\n",
            self.largura
        )
    }
}

/// O que se sabe de um arquivo de logo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VerificacaoDaLogo {
    /// `false` num PNG sem alfa nem `tRNS`: no vídeo sairia um retângulo.
    pub com_transparencia: bool,
    pub proporcao: f64,
    /// A imagem como `data:` URL, para a Amostra mostrá-la sem abrir o arquivo.
    pub previa: String,
}

/// Um kit de marca.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Kit {
    pub nome: String,
    /// `#RRGGBB`: títulos, palavras-chave e palavras de ênfase.
    pub cor_de_destaque: String,
    /// `#RRGGBB`: a palavra sendo falada na legenda.
    pub cor_da_palavra: String,
    pub fonte_da_legenda: String,
    pub fonte_dos_titulos: String,
    /// A logo; sem ela, o reel sai sem marca.
    #[serde(default)]
    pub logo: Option<Logo>,
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
            logo: None,
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
        if let Some(logo) = &mut self.logo {
            if !LARGURA_DA_LOGO.contains(&logo.largura) {
                return Err(invalido("logo.largura", "tem de ficar entre 6% e 30%"));
            }
            if !OPACIDADE_DA_LOGO.contains(&logo.opacidade) {
                return Err(invalido("logo.opacidade", "tem de ficar entre 20% e 100%"));
            }
            logo.proporcao = verificar_logo(Path::new(&logo.arquivo))
                .map_err(|motivo| invalido("logo.arquivo", &motivo))?
                .proporcao;
        }
        Ok(self)
    }

    /// O `estilo` do roteiro que o kit define.
    pub fn estilo(&self) -> Map<String, Value> {
        let Value::Object(mut estilo) = json!({
            "accent": self.cor_de_destaque,
            "highlight": self.cor_da_palavra,
            "fontes": {
                "legenda": self.fonte_da_legenda,
                "titulos": self.fonte_dos_titulos,
            },
        }) else {
            unreachable!("o json! acima é um objeto")
        };
        if let Some(logo) = &self.logo {
            estilo.insert(
                "marca".to_owned(),
                json!({
                    "arquivo": format!("{PUBLICO}/{}", logo.nome_da_copia()),
                    "posicao": logo.posicao,
                    "largura": f64::from(logo.largura) / 100.0,
                    "opacidade": f64::from(logo.opacidade) / 100.0,
                    "quando": logo.quando,
                    "proporcao": logo.proporcao,
                }),
            );
        }
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
            "- Fonte da legenda: {} ({}).\n- Fonte dos títulos: {} ({}).\n{}",
            self.fonte_da_legenda,
            jeito(&self.fonte_da_legenda),
            self.fonte_dos_titulos,
            jeito(&self.fonte_dos_titulos),
            self.logo.as_ref().map(Logo::resumo).unwrap_or_default(),
        )
    }

    /// Copia a logo para o `public/` do Remotion do projeto, de onde o render a lê.
    pub(crate) fn copiar_logo(&self, pasta: &Path) -> io::Result<()> {
        let Some(logo) = &self.logo else {
            return Ok(());
        };
        let destino = pasta.join(PUBLICO);
        fs::create_dir_all(&destino)?;
        fs::copy(&logo.arquivo, destino.join(logo.nome_da_copia()))?;
        Ok(())
    }

    /// O mesmo kit, sem a logo.
    pub(crate) fn sem_logo(mut self) -> Self {
        self.logo = None;
        self
    }

    /// Troca o kit do projeto: grava o `kit.json` e deixa no `public/` só a logo dele.
    pub(crate) fn regravar(&self, pasta: &Path) -> io::Result<()> {
        for extensao in ["png", "svg"] {
            match fs::remove_file(pasta.join(PUBLICO).join(format!("logo.{extensao}"))) {
                Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
                _ => {}
            }
        }
        self.gravar(pasta)?;
        self.copiar_logo(pasta)
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

/// Confere o arquivo da logo: existe, é PNG ou SVG, e se tem transparência, qual a proporção e
/// a prévia.
/// O erro é o motivo, em português.
pub fn verificar_logo(caminho: &Path) -> Result<VerificacaoDaLogo, String> {
    let extensao = caminho
        .extension()
        .map(|extensao| extensao.to_string_lossy().to_lowercase());
    let bytes = fs::read(caminho).map_err(|_| "o arquivo não existe".to_owned())?;
    match extensao.as_deref() {
        Some("png") => analisar_png(&bytes)
            .map(|(com_transparencia, proporcao)| (com_transparencia, proporcao, "image/png")),
        Some("svg") => Ok((
            true,
            proporcao_do_svg(&String::from_utf8_lossy(&bytes)),
            "image/svg+xml",
        )),
        _ => Err("a logo tem de ser PNG ou SVG".to_owned()),
    }
    .map(|(com_transparencia, proporcao, mime)| VerificacaoDaLogo {
        com_transparencia,
        proporcao,
        previa: format!("data:{mime};base64,{}", base64(&bytes)),
    })
}

fn base64(bytes: &[u8]) -> String {
    const LETRAS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut texto = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for grupo in bytes.chunks(3) {
        let valor = grupo.iter().enumerate().fold(0u32, |valor, (i, byte)| {
            valor | u32::from(*byte) << (16 - 8 * i)
        });
        for i in 0..4 {
            if i <= grupo.len() {
                texto.push(char::from(LETRAS[(valor >> (18 - 6 * i) & 63) as usize]));
            } else {
                texto.push('=');
            }
        }
    }
    texto
}

/// Lê os chunks do PNG: o IHDR dá o tamanho e o tipo de cor (4 e 6 têm alfa); um `tRNS` antes
/// dos dados também dá transparência.
fn analisar_png(bytes: &[u8]) -> Result<(bool, f64), String> {
    const ASSINATURA: &[u8] = b"\x89PNG\r\n\x1a\n";
    let invalido = || "o arquivo não é um PNG válido".to_owned();
    if !bytes.starts_with(ASSINATURA) || bytes.get(12..16) != Some(b"IHDR") || bytes.len() < 26 {
        return Err(invalido());
    }
    let numero =
        |de: usize| u32::from_be_bytes([bytes[de], bytes[de + 1], bytes[de + 2], bytes[de + 3]]);
    let (largura, altura) = (numero(16), numero(20));
    if largura == 0 || altura == 0 {
        return Err(invalido());
    }
    let mut com_transparencia = matches!(bytes[25], 4 | 6);
    let mut posicao = 8;
    while let Some(cabecalho) = bytes.get(posicao..posicao + 8) {
        let tamanho = u32::from_be_bytes([cabecalho[0], cabecalho[1], cabecalho[2], cabecalho[3]]);
        match &cabecalho[4..8] {
            b"tRNS" => com_transparencia = true,
            b"IDAT" | b"IEND" => break,
            _ => {}
        }
        posicao += 12 + tamanho as usize;
    }
    Ok((com_transparencia, f64::from(altura) / f64::from(largura)))
}

/// Altura ÷ largura do SVG, pelo `viewBox` ou por `width` e `height`; 1 se não achar.
fn proporcao_do_svg(texto: &str) -> f64 {
    let Some(inicio) = texto.find("<svg") else {
        return 1.0;
    };
    let tag = &texto[inicio
        ..texto[inicio..]
            .find('>')
            .map_or(texto.len(), |fim| inicio + fim)];
    let atributo = |nome: &str| {
        let achado = tag.find(&format!("{nome}=\""))? + nome.len() + 2;
        tag[achado..].split('"').next().map(str::to_owned)
    };
    let medidas = atributo("viewBox")
        .and_then(|caixa| {
            let numeros: Vec<f64> = caixa
                .split([' ', ','])
                .filter_map(|parte| parte.parse().ok())
                .collect();
            (numeros.len() == 4).then(|| (numeros[2], numeros[3]))
        })
        .or_else(|| {
            let numero = |nome: &str| atributo(nome)?.trim_end_matches("px").parse::<f64>().ok();
            Some((numero("width")?, numero("height")?))
        });
    match medidas {
        Some((largura, altura)) if largura > 0.0 && altura > 0.0 => altura / largura,
        _ => 1.0,
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
    fn o_base64_completa_com_igual() {
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"M"), "TQ==");
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
