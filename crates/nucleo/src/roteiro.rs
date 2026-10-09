//! O roteiro que o Claude escreve e o plano de cada corte que o núcleo calcula a partir dele:
//! encaixe dos trechos nas palavras, legendas por palavra e motions no tempo do corte. A
//! validação roda sobre esse plano, então quem valida e quem produz concordam.
//!
//! Os problemas saem como códigos com parâmetros; as frases ficam com quem os mostra.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

/// Onde o projeto guarda a transcrição por palavra.
pub const TRANSCRICAO: &str = "edit/transcricao.json";

/// Onde o projeto guarda o roteiro que o Claude escreve.
pub const ROTEIRO: &str = "edit/roteiro.json";

/// A versão do contrato do roteiro que este núcleo entende.
pub const VERSAO_DO_ROTEIRO: u32 = 1;

/// A duração máxima de um reel, com 0,5 s de folga sobre os 90 s do alvo.
const DURACAO_MAXIMA: f64 = 90.5;
/// Abaixo disso o corte é curto demais para o alvo.
const DURACAO_CURTA: f64 = 20.0;
/// Uma palavra conta num trecho se ao menos esta fração dela estiver dentro.
const SOBREPOSICAO_MINIMA: f64 = 0.4;
const RECUO_DO_INICIO: f64 = 0.12;
const AVANCO_DO_FIM: f64 = 0.18;
const AVANCO_DO_ULTIMO_FIM: f64 = 0.75;
const FOLGA_ANTES_DA_PROXIMA: f64 = 0.06;
/// Uma borda movida além disso pelo encaixe merece aviso.
const BORDA_MOVIDA: f64 = 0.6;
/// Folga ao decidir se um instante do vídeo cai dentro de um trecho.
const TOLERANCIA_DO_INSTANTE: f64 = 0.05;
const MOTION_MINIMO: f64 = 0.3;
const FIM_LIVRE: f64 = 0.6;
const PALAVRA_LONGE_DO_AT: f64 = 4.0;
const CENAS_DE_TELA_CHEIA: f64 = 0.6;
const TITULO_INICIO: f64 = 0.1;
const TITULO_FIM: f64 = 2.8;
const LEGENDA_MINIMA: f64 = 0.12;
/// O motion de uma palavra entra um pouco antes dela.
const ANTECEDENCIA_DA_PALAVRA: f64 = 0.1;

const TIPOS_DE_MOTION: [&str; 7] = [
    "title", "keyword", "counter", "zoom", "shake", "scene", "flash",
];

/// A duração padrão de cada tipo de motion, em segundos.
fn duracao_padrao(tipo: &str) -> f64 {
    match tipo {
        "title" => 2.6,
        "keyword" => 1.6,
        "counter" => 2.4,
        "zoom" => 1.4,
        "shake" => 1.0,
        _ => 3.5,
    }
}

/// A região da tela que o motion ocupa; motions na mesma região não devem se sobrepor.
fn regiao(tipo: &str) -> Option<&'static str> {
    match tipo {
        "title" => Some("topo"),
        "keyword" | "counter" => Some("meio"),
        "scene" => Some("cena"),
        _ => None,
    }
}

// ---------------------------------------------------------------- contrato

/// Um instante do vídeo original: segundos (`75.5`) ou texto (`"1:15.5"`, `"01:01:15"`).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(try_from = "Value")]
pub struct Tempo(pub f64);

impl TryFrom<Value> for Tempo {
    type Error = String;

    fn try_from(valor: Value) -> Result<Self, String> {
        match &valor {
            Value::Number(numero) => numero.as_f64(),
            Value::String(texto) => texto.split(':').try_fold(0.0, |total, parte| {
                parte
                    .trim()
                    .parse::<f64>()
                    .ok()
                    .filter(|v| v.is_finite())
                    .map(|v| total * 60.0 + v)
            }),
            _ => None,
        }
        .map(Tempo)
        .ok_or_else(|| format!("instante inválido: {valor}"))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StatusDoCorte {
    #[default]
    Produzir,
    Reserva,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Motion {
    #[serde(rename = "type")]
    pub tipo: String,
    pub at: Option<Tempo>,
    pub ate: Option<Tempo>,
    pub word: Option<String>,
    pub dur: Option<f64>,
    /// Os demais campos (`text`, `scale`, `from`, `name`, `props`…) vão para o Remotion como vieram.
    #[serde(flatten)]
    pub extras: Map<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Corte {
    pub id: String,
    #[serde(default)]
    pub status: StatusDoCorte,
    pub nota: Option<f64>,
    pub categoria: Option<String>,
    pub titulo: Option<String>,
    pub gancho: Option<String>,
    pub payoff: Option<String>,
    pub porque: Option<String>,
    /// O texto do post, no idioma do vídeo.
    pub descricao: Option<String>,
    #[serde(default)]
    pub trechos: Vec<(Tempo, Tempo)>,
    #[serde(default)]
    pub enfase: Vec<String>,
    #[serde(default)]
    pub pin: Vec<String>,
    #[serde(default)]
    pub correcoes: Map<String, Value>,
    #[serde(default)]
    pub estilo: Map<String, Value>,
    #[serde(default)]
    pub motions: Vec<Motion>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Roteiro {
    /// A versão do contrato; os roteiros sem ela são da versão 1.
    #[serde(default = "versao_inicial")]
    pub versao: u32,
    pub fonte: Option<String>,
    pub titulo_video: Option<String>,
    pub prefixo: Option<String>,
    #[serde(default)]
    pub estilo: Map<String, Value>,
    #[serde(default)]
    pub correcoes: Map<String, Value>,
    #[serde(default)]
    pub cortes: Vec<Corte>,
}

fn versao_inicial() -> u32 {
    VERSAO_DO_ROTEIRO
}

/// Uma palavra da transcrição, com o tempo no vídeo original.
#[derive(Debug, Clone, Deserialize)]
pub struct Palavra {
    #[serde(rename = "text")]
    pub texto: String,
    #[serde(rename = "start")]
    pub inicio: f64,
    #[serde(rename = "end")]
    pub fim: f64,
    /// `word` para palavras; os espaços e eventos de áudio são ignorados.
    #[serde(rename = "type", default = "tipo_palavra")]
    pub tipo: String,
}

fn tipo_palavra() -> String {
    "word".into()
}

/// A transcrição por palavra (`edit/transcricao.json`).
#[derive(Debug, Clone, Deserialize)]
pub struct Transcricao {
    #[serde(default)]
    pub words: Vec<Palavra>,
}

impl Transcricao {
    pub fn do_json(texto: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(texto)
    }

    fn palavras(&self) -> Vec<&Palavra> {
        self.words.iter().filter(|p| p.tipo == "word").collect()
    }
}

// ---------------------------------------------------------------- problemas

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gravidade {
    Erro,
    Aviso,
}

/// O que a validação encontrou. `numero` é a posição do motion no corte, a partir de 1.
#[derive(Debug, Clone, PartialEq)]
pub enum Problema {
    RoteiroIlegivel(String),
    VersaoNaoSuportada {
        versao: u32,
    },
    TranscricaoAusente,
    CorteSemTrechos,
    TrechoForaDoVideo {
        inicio: f64,
        fim: f64,
        duracao: f64,
    },
    TrechoSemPalavra {
        inicio: f64,
        fim: f64,
    },
    DuracaoAcimaDoMaximo {
        duracao: f64,
    },
    TipoDeMotionInvalido {
        numero: usize,
        tipo: String,
    },
    AtForaDosTrechos {
        numero: usize,
        instante: f64,
    },
    PalavraNaoEncontrada {
        numero: usize,
        palavra: String,
    },
    MotionSemAtNemWord {
        numero: usize,
        tipo: String,
    },
    MotionCurto {
        numero: usize,
        tipo: String,
    },
    CenaNaoRegistrada {
        nome: String,
    },
    FonteForaDoCatalogo {
        fonte: String,
    },
    LogoInexistente {
        arquivo: String,
    },
    UltimoTrechoSemPontuacao {
        palavra: String,
    },
    EncaixeMoveuBorda {
        pedido: (f64, f64),
        encaixado: (f64, f64),
    },
    CorteCurto {
        duracao: f64,
    },
    PalavraLongeDoAt {
        palavra: String,
        distancia: f64,
    },
    MotionsSobrepostas {
        a: (String, f64),
        b: (String, f64),
    },
    CenasCobremDemais,
}

impl Problema {
    pub fn gravidade(&self) -> Gravidade {
        match self {
            Self::UltimoTrechoSemPontuacao { .. }
            | Self::EncaixeMoveuBorda { .. }
            | Self::CorteCurto { .. }
            | Self::PalavraLongeDoAt { .. }
            | Self::MotionsSobrepostas { .. }
            | Self::CenasCobremDemais => Gravidade::Aviso,
            _ => Gravidade::Erro,
        }
    }

    fn marca(&self) -> &'static str {
        match self.gravidade() {
            Gravidade::Erro => "✗ erro:",
            Gravidade::Aviso => "⚠ aviso:",
        }
    }

    /// A frase que descreve o problema, para o Claude e para os logs.
    pub fn frase(&self) -> String {
        match self {
            Self::RoteiroIlegivel(erro) => {
                format!("o roteiro não é um JSON válido do contrato: {erro}")
            }
            Self::VersaoNaoSuportada { versao } => {
                format!("versão {versao} do roteiro não é suportada (use a versão 1)")
            }
            Self::TranscricaoAusente => format!(
                "falta a transcrição ({TRANSCRICAO}); rode na pasta do projeto, depois da etapa Transcrição"
            ),
            Self::CorteSemTrechos => "o corte não tem trechos".into(),
            Self::TrechoForaDoVideo {
                inicio,
                fim,
                duracao,
            } => {
                format!("trecho {inicio:.2}–{fim:.2} fora do vídeo (0–{duracao:.0}s)")
            }
            Self::TrechoSemPalavra { inicio, fim } => {
                format!("trecho {inicio:.2}–{fim:.2} não contém nenhuma palavra")
            }
            Self::DuracaoAcimaDoMaximo { duracao } => {
                format!("{duracao:.1}s é mais que o máximo de 90s; enxugue os trechos")
            }
            Self::TipoDeMotionInvalido { numero, tipo } => format!(
                "motion #{numero} com type inválido: \"{tipo}\" (use title, keyword, counter, zoom, shake, scene ou flash)"
            ),
            Self::AtForaDosTrechos { numero, instante } => {
                format!(
                    "motion #{numero}: o tempo {instante:.2}s não está em nenhum trecho do corte"
                )
            }
            Self::PalavraNaoEncontrada { numero, palavra } => {
                format!("motion #{numero}: a palavra \"{palavra}\" não aparece na legenda do corte")
            }
            Self::MotionSemAtNemWord { numero, tipo } => {
                format!("motion #{numero} ({tipo}) precisa de \"at\" ou \"word\"")
            }
            Self::MotionCurto { numero, tipo } => {
                format!("motion #{numero} ({tipo}) tem menos de 0,3s ou cai fora do corte")
            }
            Self::CenaNaoRegistrada { nome } => {
                format!("a cena \"{nome}\" não está registrada em remotion/src/scenes/index.ts")
            }
            Self::FonteForaDoCatalogo { fonte } => {
                format!("a fonte \"{fonte}\" não está no catálogo")
            }
            Self::LogoInexistente { arquivo } => {
                format!("o arquivo de logo \"{arquivo}\" não existe")
            }
            Self::UltimoTrechoSemPontuacao { palavra } => format!(
                "o corte termina em \"{palavra}\", sem fim de frase; pode soar abrupto, prefira terminar numa frase completa"
            ),
            Self::EncaixeMoveuBorda { pedido, encaixado } => format!(
                "trecho {:.2}–{:.2} encaixado em {:.2}–{:.2}, mais de 0,6s de diferença",
                pedido.0, pedido.1, encaixado.0, encaixado.1
            ),
            Self::CorteCurto { duracao } => format!(
                "duração {duracao:.1}s é curta (menos de 20s); inclua o contexto e deixe o payoff respirar"
            ),
            Self::PalavraLongeDoAt { palavra, distancia } => {
                format!(
                    "a palavra \"{palavra}\" mais próxima está a {distancia:.1}s do \"at\" indicado"
                )
            }
            Self::MotionsSobrepostas { a, b } => format!(
                "{} {:.1}s e {} {:.1}s se sobrepõem na mesma região",
                a.0, a.1, b.0, b.1
            ),
            Self::CenasCobremDemais => {
                "cenas de tela cheia cobrem mais de 60% do corte; o rosto quase não aparece".into()
            }
        }
    }
}

// ---------------------------------------------------------------- plano

/// Uma palavra da legenda, no tempo do corte, no formato do `@remotion/captions`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Legenda {
    pub text: String,
    #[serde(rename = "startMs")]
    pub inicio_ms: i64,
    #[serde(rename = "endMs")]
    pub fim_ms: i64,
    #[serde(rename = "timestampMs")]
    pub meio_ms: i64,
    pub confidence: Option<f64>,
}

/// O `motion.json` do corte: o que o Remotion lê.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlanoDeMotion {
    pub style: Map<String, Value>,
    pub emphasis: Vec<String>,
    pub motions: Vec<Value>,
}

/// Tudo o que um corte precisa, calculado sem renderizar nada.
#[derive(Debug, Clone, PartialEq)]
pub struct Plano {
    pub id: String,
    /// O nome do corte nos arquivos: `<prefixo>-<id>`.
    pub chave: String,
    /// Os trechos encaixados nas palavras, no tempo do vídeo original.
    pub trechos: Vec<(f64, f64)>,
    pub duracao: f64,
    pub legendas: Vec<Legenda>,
    pub motion: PlanoDeMotion,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CorteValidado {
    pub id: String,
    /// Só existe quando o corte não tem erros.
    pub plano: Option<Plano>,
    pub problemas: Vec<Problema>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Validacao {
    /// Problemas do roteiro como um todo.
    pub problemas: Vec<Problema>,
    pub cortes: Vec<CorteValidado>,
}

impl Validacao {
    /// Os problemas do roteiro e, em seguida, os de cada corte.
    pub fn todos_os_problemas(&self) -> impl Iterator<Item = &Problema> {
        self.problemas
            .iter()
            .chain(self.cortes.iter().flat_map(|c| &c.problemas))
    }

    pub fn tem_erros(&self) -> bool {
        self.todos_os_problemas()
            .any(|p| p.gravidade() == Gravidade::Erro)
    }

    /// O relatório que o `shorts-cli validar` imprime e a sessão do Claude lê.
    pub fn relatorio(&self) -> String {
        let mut saida = String::new();
        for problema in &self.problemas {
            saida.push_str(&format!("  {} {}\n", problema.marca(), problema.frase()));
        }
        for corte in &self.cortes {
            let erros = corte
                .problemas
                .iter()
                .filter(|p| p.gravidade() == Gravidade::Erro)
                .count();
            match (&corte.plano, erros) {
                (Some(plano), 0) => saida.push_str(&format!(
                    "  ✓ {} → {}  {:.1}s  {} trecho(s)  {} motion(s)\n",
                    corte.id,
                    plano.chave,
                    plano.duracao,
                    plano.trechos.len(),
                    plano.motion.motions.len()
                )),
                _ => saida.push_str(&format!("  ✗ {}\n", corte.id)),
            }
            for problema in &corte.problemas {
                saida.push_str(&format!(
                    "      {} {}\n",
                    problema.marca(),
                    problema.frase()
                ));
            }
        }
        let erros = self.contar(Gravidade::Erro);
        let avisos = self.contar(Gravidade::Aviso);
        if erros == 0 {
            saida.push_str(&format!("\nRoteiro válido ({avisos} aviso(s)).\n"));
        } else {
            saida.push_str(&format!(
                "\nRoteiro inválido: {erros} erro(s), {avisos} aviso(s). Corrija o roteiro.\n"
            ));
        }
        saida
    }

    fn contar(&self, gravidade: Gravidade) -> usize {
        self.todos_os_problemas()
            .filter(|p| p.gravidade() == gravidade)
            .count()
    }
}

/// O que a validação confere fora do roteiro.
#[derive(Debug, Clone, Default)]
pub struct Contexto {
    /// As cenas do registro do Remotion do projeto.
    pub cenas: BTreeSet<String>,
    /// As fontes do catálogo; sem ele, as fontes não são conferidas.
    pub fontes: Option<BTreeSet<String>>,
    /// A pasta de onde se resolvem os arquivos citados no estilo, como o logo.
    pub pasta: PathBuf,
}

/// As cenas registradas em `src/scenes/index.ts` de um Remotion: as chaves de `SCENES`.
pub fn cenas_registradas(remotion: &Path) -> BTreeSet<String> {
    let Ok(texto) = fs::read_to_string(remotion.join("src/scenes/index.ts")) else {
        return BTreeSet::new();
    };
    let sem_comentarios: String = texto
        .lines()
        .map(|linha| linha.split("//").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n");
    let Some(inicio) = sem_comentarios.find("SCENES") else {
        return BTreeSet::new();
    };
    let resto = &sem_comentarios[inicio..];
    let Some(abre) = resto
        .find('=')
        .and_then(|igual| resto[igual..].find('{').map(|p| igual + p))
    else {
        return BTreeSet::new();
    };
    let corpo = &resto[abre + 1..];
    let corpo = corpo.split('}').next().unwrap_or("");
    corpo
        .split(',')
        .filter_map(|entrada| {
            let nome: String = entrada
                .trim()
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            (!nome.is_empty()).then_some(nome)
        })
        .collect()
}

/// Valida o roteiro de um projeto: a transcrição e o registro de cenas vêm da pasta dele.
pub fn validar_na_pasta(pasta: &Path, texto: &str) -> Validacao {
    let transcricao = fs::read_to_string(pasta.join(TRANSCRICAO))
        .ok()
        .and_then(|texto| Transcricao::do_json(&texto).ok());
    let contexto = Contexto {
        cenas: cenas_registradas(&pasta.join("remotion")),
        fontes: None,
        pasta: pasta.to_owned(),
    };
    validar(texto, transcricao.as_ref(), &contexto)
}

/// Valida o roteiro e calcula o plano dos cortes com status `produzir`.
pub fn validar(texto: &str, transcricao: Option<&Transcricao>, contexto: &Contexto) -> Validacao {
    let roteiro: Roteiro = match serde_json::from_str(texto) {
        Ok(roteiro) => roteiro,
        Err(erro) => {
            return Validacao {
                problemas: vec![Problema::RoteiroIlegivel(erro.to_string())],
                cortes: Vec::new(),
            };
        }
    };
    let mut validacao = Validacao::default();
    if roteiro.versao != VERSAO_DO_ROTEIRO {
        validacao.problemas.push(Problema::VersaoNaoSuportada {
            versao: roteiro.versao,
        });
        return validacao;
    }
    let Some(transcricao) = transcricao else {
        validacao.problemas.push(Problema::TranscricaoAusente);
        return validacao;
    };
    validacao
        .problemas
        .extend(conferir_estilo(&roteiro.estilo, contexto));
    let palavras = transcricao.palavras();
    let prefixo = roteiro.prefixo.clone().unwrap_or_else(|| {
        let fonte = roteiro.fonte.as_deref().unwrap_or("");
        slug(
            Path::new(fonte)
                .file_stem()
                .map_or("", |s| s.to_str().unwrap_or("")),
        )
    });
    for corte in roteiro
        .cortes
        .iter()
        .filter(|c| c.status == StatusDoCorte::Produzir)
    {
        validacao
            .cortes
            .push(planejar(&roteiro, corte, &prefixo, &palavras, contexto));
    }
    validacao
}

fn conferir_estilo(estilo: &Map<String, Value>, contexto: &Contexto) -> Vec<Problema> {
    let mut problemas = Vec::new();
    if let (Some(catalogo), Some(Value::Object(fontes))) = (&contexto.fontes, estilo.get("fontes"))
    {
        for fonte in fontes.values().filter_map(Value::as_str) {
            if !catalogo.contains(fonte) {
                problemas.push(Problema::FonteForaDoCatalogo {
                    fonte: fonte.into(),
                });
            }
        }
    }
    if let Some(arquivo) = estilo
        .get("marca")
        .and_then(|marca| marca.get("arquivo"))
        .and_then(Value::as_str)
        && !contexto.pasta.join(arquivo).is_file()
    {
        problemas.push(Problema::LogoInexistente {
            arquivo: arquivo.into(),
        });
    }
    problemas
}

fn planejar(
    roteiro: &Roteiro,
    corte: &Corte,
    prefixo: &str,
    palavras: &[&Palavra],
    contexto: &Contexto,
) -> CorteValidado {
    let mut problemas = conferir_estilo(&corte.estilo, contexto);
    let mut avisos = Vec::new();
    let plano = construir(
        roteiro,
        corte,
        prefixo,
        palavras,
        contexto,
        &mut problemas,
        &mut avisos,
    );
    let com_erro = problemas.iter().any(|p| p.gravidade() == Gravidade::Erro);
    problemas.extend(avisos);
    CorteValidado {
        id: corte.id.clone(),
        plano: if com_erro { None } else { plano },
        problemas,
    }
}

fn construir(
    roteiro: &Roteiro,
    corte: &Corte,
    prefixo: &str,
    palavras: &[&Palavra],
    contexto: &Contexto,
    erros: &mut Vec<Problema>,
    avisos: &mut Vec<Problema>,
) -> Option<Plano> {
    if corte.trechos.is_empty() {
        erros.push(Problema::CorteSemTrechos);
        return None;
    }
    let duracao_do_video = palavras.last().map_or(0.0, |p| p.fim);
    let mut trechos = Vec::new();
    let mut falhou = false;
    for (n, (a, b)) in corte.trechos.iter().enumerate() {
        let (a, b) = (a.0, b.0);
        if !(a >= 0.0 && a < b && b <= duracao_do_video + 1.0) {
            erros.push(Problema::TrechoForaDoVideo {
                inicio: a,
                fim: b,
                duracao: duracao_do_video,
            });
            falhou = true;
            continue;
        }
        let ultimo = n == corte.trechos.len() - 1;
        match encaixar(palavras, a, b, ultimo) {
            Some(encaixe) => {
                avisos.extend(encaixe.avisos);
                trechos.push((encaixe.inicio, encaixe.fim));
            }
            None => {
                erros.push(Problema::TrechoSemPalavra { inicio: a, fim: b });
                falhou = true;
            }
        }
    }
    if falhou {
        return None;
    }
    let duracao: f64 = trechos.iter().map(|(a, b)| b - a).sum();
    if duracao > DURACAO_MAXIMA {
        erros.push(Problema::DuracaoAcimaDoMaximo { duracao });
        return None;
    }
    if duracao < DURACAO_CURTA {
        avisos.push(Problema::CorteCurto { duracao });
    }
    let legendas = legendar(roteiro, corte, &trechos, palavras);
    let motion = mapear_motions(
        corte, roteiro, &trechos, duracao, &legendas, contexto, erros, avisos,
    );
    Some(Plano {
        id: corte.id.clone(),
        chave: format!("{prefixo}-{}", slug_com(&corte.id, 20)),
        trechos,
        duracao,
        legendas,
        motion,
    })
}

// ---------------------------------------------------------------- encaixe

struct Encaixe {
    inicio: f64,
    fim: f64,
    avisos: Vec<Problema>,
}

/// Expande ou encolhe `[a, b]` para os limites das palavras, com folga de respiro.
fn encaixar(palavras: &[&Palavra], a: f64, b: f64, ultimo: bool) -> Option<Encaixe> {
    let dentro: Vec<usize> = palavras
        .iter()
        .enumerate()
        .filter(|(_, p)| {
            let sobreposicao = b.min(p.fim) - a.max(p.inicio);
            sobreposicao > 0.0 && sobreposicao >= SOBREPOSICAO_MINIMA * (p.fim - p.inicio)
        })
        .map(|(i, _)| i)
        .collect();
    let (&primeira, &ultima) = (dentro.first()?, dentro.last()?);
    let (p0, p1) = (palavras[primeira], palavras[ultima]);
    let anterior = if primeira > 0 {
        palavras[primeira - 1].fim
    } else {
        0.0
    };
    let proxima = palavras.get(ultima + 1).map_or(p1.fim + 1.0, |p| p.inicio);
    let inicio = p0.inicio.min(anterior.max(p0.inicio - RECUO_DO_INICIO));
    let fim = if ultimo {
        p1.fim
            .max((proxima - FOLGA_ANTES_DA_PROXIMA).min(p1.fim + AVANCO_DO_ULTIMO_FIM))
    } else {
        p1.fim.max(proxima.min(p1.fim + AVANCO_DO_FIM))
    };
    let mut avisos = Vec::new();
    if ultimo && !termina_em_pontuacao(&p1.texto) {
        avisos.push(Problema::UltimoTrechoSemPontuacao {
            palavra: p1.texto.trim().into(),
        });
    }
    let folga_esperada = if ultimo { AVANCO_DO_ULTIMO_FIM } else { 0.0 };
    if (inicio - a).abs() > BORDA_MOVIDA
        || fim - b > BORDA_MOVIDA + folga_esperada
        || b - fim > BORDA_MOVIDA
    {
        avisos.push(Problema::EncaixeMoveuBorda {
            pedido: (a, b),
            encaixado: (arredondar(inicio), arredondar(fim)),
        });
    }
    Some(Encaixe {
        inicio: arredondar(inicio),
        fim: arredondar(fim),
        avisos,
    })
}

/// O texto termina em `.`, `!`, `?` ou `…`, ainda que seguido de aspas ou parênteses.
fn termina_em_pontuacao(texto: &str) -> bool {
    texto
        .trim_end_matches(|c: char| !(c.is_alphanumeric() || c == '_' || ".!?…".contains(c)))
        .ends_with(['.', '!', '?', '…'])
}

// ---------------------------------------------------------------- legendas

fn legendar(
    roteiro: &Roteiro,
    corte: &Corte,
    trechos: &[(f64, f64)],
    palavras: &[&Palavra],
) -> Vec<Legenda> {
    let mut legendas: Vec<Legenda> = Vec::new();
    let mut deslocamento = 0.0;
    for &(a, b) in trechos {
        for palavra in palavras
            .iter()
            .filter(|p| p.fim > a && p.inicio < b && !p.texto.trim().is_empty())
        {
            let inicio = palavra.inicio.max(a) - a + deslocamento;
            let mut fim = palavra.fim.min(b) - a + deslocamento;
            if fim <= inicio {
                fim = inicio + LEGENDA_MINIMA;
            }
            let espaco = if legendas.is_empty() { "" } else { " " };
            legendas.push(Legenda {
                text: format!("{espaco}{}", palavra.texto.trim()),
                inicio_ms: milissegundos(inicio),
                fim_ms: milissegundos(fim),
                meio_ms: milissegundos((inicio + fim) / 2.0),
                confidence: None,
            });
        }
        deslocamento += b - a;
    }
    for i in 1..legendas.len() {
        legendas[i - 1].fim_ms = legendas[i - 1].fim_ms.min(legendas[i].inicio_ms);
    }
    corrigir(&mut legendas, roteiro, corte);
    legendas
}

/// Aplica as `correcoes` do roteiro e do corte (as do corte vencem), preservando a pontuação.
fn corrigir(legendas: &mut [Legenda], roteiro: &Roteiro, corte: &Corte) {
    let mut correcoes: Vec<(String, &str)> = Vec::new();
    for (palavra, certa) in roteiro.correcoes.iter().chain(&corte.correcoes) {
        if let Some(certa) = certa.as_str() {
            let chave = normalizar(palavra);
            correcoes.retain(|(existente, _)| *existente != chave);
            correcoes.push((chave, certa));
        }
    }
    if correcoes.is_empty() {
        return;
    }
    for legenda in legendas {
        let espaco = if legenda.text.starts_with(' ') {
            " "
        } else {
            ""
        };
        let nucleo = legenda.text.trim();
        let eh_palavra = |c: char| c.is_alphanumeric() || c == '_';
        let depois_do_inicio = nucleo.trim_start_matches(|c| !eh_palavra(c));
        let antes = &nucleo[..nucleo.len() - depois_do_inicio.len()];
        let meio = depois_do_inicio.trim_end_matches(|c| !eh_palavra(c));
        let depois = &depois_do_inicio[meio.len()..];
        let chave = normalizar(meio);
        if let Some((_, certa)) = correcoes.iter().find(|(k, _)| *k == chave) {
            legenda.text = format!("{espaco}{antes}{certa}{depois}");
        }
    }
}

// ---------------------------------------------------------------- motions

#[allow(clippy::too_many_arguments)]
fn mapear_motions(
    corte: &Corte,
    roteiro: &Roteiro,
    trechos: &[(f64, f64)],
    duracao: f64,
    legendas: &[Legenda],
    contexto: &Contexto,
    erros: &mut Vec<Problema>,
    avisos: &mut Vec<Problema>,
) -> PlanoDeMotion {
    let limite = duracao - FIM_LIVRE;
    let mut saida: Vec<Value> = Vec::new();
    if let Some(titulo) = corte.titulo.as_deref().filter(|t| !t.is_empty())
        && !corte.motions.iter().any(|m| m.tipo == "title")
    {
        saida.push(json!({
            "type": "title",
            "start": TITULO_INICIO,
            "end": arredondar(TITULO_FIM.min(limite)),
            "text": titulo,
        }));
    }
    for (i, motion) in corte.motions.iter().enumerate() {
        let numero = i + 1;
        if !TIPOS_DE_MOTION.contains(&motion.tipo.as_str()) {
            erros.push(Problema::TipoDeMotionInvalido {
                numero,
                tipo: motion.tipo.clone(),
            });
            continue;
        }
        if motion.tipo == "scene" {
            let nome = motion
                .extras
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("");
            if !contexto.cenas.contains(nome) {
                erros.push(Problema::CenaNaoRegistrada { nome: nome.into() });
                continue;
            }
        }
        let Some(inicio) = inicio_do_motion(motion, numero, trechos, legendas, erros, avisos)
        else {
            continue;
        };
        let mut campos = motion.extras.clone();
        campos.insert("type".into(), motion.tipo.clone().into());
        if motion.tipo == "flash" {
            campos.insert("at".into(), arredondar(inicio).into());
            saida.push(Value::Object(campos));
            continue;
        }
        let fim = match &motion.ate {
            Some(ate) => match no_corte(trechos, ate.0) {
                Some(fim) => fim,
                None => {
                    erros.push(Problema::AtForaDosTrechos {
                        numero,
                        instante: ate.0,
                    });
                    continue;
                }
            },
            None => inicio + motion.dur.unwrap_or_else(|| duracao_padrao(&motion.tipo)),
        }
        .min(limite);
        if fim - inicio < MOTION_MINIMO {
            erros.push(Problema::MotionCurto {
                numero,
                tipo: motion.tipo.clone(),
            });
            continue;
        }
        campos.insert("start".into(), arredondar(inicio).into());
        campos.insert("end".into(), arredondar(fim).into());
        saida.push(Value::Object(campos));
    }
    avisar_sobreposicoes(&saida, duracao, avisos);
    let mut estilo = roteiro.estilo.clone();
    estilo.extend(corte.estilo.clone());
    PlanoDeMotion {
        style: estilo,
        emphasis: corte.enfase.clone(),
        motions: saida,
    }
}

/// O instante em que o motion começa, no tempo do corte, ou `None` (com o erro registrado).
fn inicio_do_motion(
    motion: &Motion,
    numero: usize,
    trechos: &[(f64, f64)],
    legendas: &[Legenda],
    erros: &mut Vec<Problema>,
    avisos: &mut Vec<Problema>,
) -> Option<f64> {
    let perto = match &motion.at {
        Some(at) => {
            let Some(instante) = no_corte(trechos, at.0) else {
                erros.push(Problema::AtForaDosTrechos {
                    numero,
                    instante: at.0,
                });
                return None;
            };
            Some(instante)
        }
        None => None,
    };
    if let Some(palavra) = &motion.word {
        let alvo = normalizar(palavra);
        let candidatas = legendas
            .iter()
            .filter(|l| normalizar(&l.text) == alvo)
            .map(|l| l.inicio_ms as f64 / 1000.0);
        let escolhida = match perto {
            None => candidatas.into_iter().next(),
            Some(perto) => {
                candidatas.min_by(|x, y| (x - perto).abs().total_cmp(&(y - perto).abs()))
            }
        };
        let Some(escolhida) = escolhida else {
            erros.push(Problema::PalavraNaoEncontrada {
                numero,
                palavra: palavra.clone(),
            });
            return None;
        };
        if let Some(perto) = perto
            && (escolhida - perto).abs() > PALAVRA_LONGE_DO_AT
        {
            avisos.push(Problema::PalavraLongeDoAt {
                palavra: palavra.clone(),
                distancia: (escolhida - perto).abs(),
            });
        }
        return Some((escolhida - ANTECEDENCIA_DA_PALAVRA).max(0.0));
    }
    if let Some(perto) = perto {
        return Some(perto);
    }
    if motion.tipo == "title" {
        return Some(TITULO_INICIO);
    }
    erros.push(Problema::MotionSemAtNemWord {
        numero,
        tipo: motion.tipo.clone(),
    });
    None
}

/// Leva um instante do vídeo original para a linha do tempo do corte.
fn no_corte(trechos: &[(f64, f64)], instante: f64) -> Option<f64> {
    let mut deslocamento = 0.0;
    for &(a, b) in trechos {
        if a - TOLERANCIA_DO_INSTANTE <= instante && instante <= b + TOLERANCIA_DO_INSTANTE {
            return Some((instante.min(b) - a).max(0.0) + deslocamento);
        }
        deslocamento += b - a;
    }
    None
}

fn avisar_sobreposicoes(motions: &[Value], duracao: f64, avisos: &mut Vec<Problema>) {
    let intervalo = |m: &Value| -> Option<(String, f64, f64)> {
        Some((
            m["type"].as_str()?.to_string(),
            m["start"].as_f64()?,
            m["end"].as_f64()?,
        ))
    };
    let intervalos: Vec<_> = motions.iter().filter_map(intervalo).collect();
    for (i, a) in intervalos.iter().enumerate() {
        for b in &intervalos[i + 1..] {
            let mesma_regiao = regiao(&a.0).is_some() && regiao(&a.0) == regiao(&b.0);
            if mesma_regiao && a.1 < b.2 && b.1 < a.2 {
                avisos.push(Problema::MotionsSobrepostas {
                    a: (a.0.clone(), a.1),
                    b: (b.0.clone(), b.1),
                });
            }
        }
    }
    let cobertos: f64 = motions
        .iter()
        .filter(|m| m["type"] == "scene" && m["layout"].as_str().unwrap_or("full") == "full")
        .filter_map(|m| Some(m["end"].as_f64()? - m["start"].as_f64()?))
        .sum();
    if cobertos > CENAS_DE_TELA_CHEIA * duracao {
        avisos.push(Problema::CenasCobremDemais);
    }
}

// ---------------------------------------------------------------- texto

/// Arredonda a milissegundos, como os tempos do plano.
fn arredondar(segundos: f64) -> f64 {
    (segundos * 1000.0).round_ties_even() / 1000.0
}

#[allow(clippy::cast_possible_truncation)]
fn milissegundos(segundos: f64) -> i64 {
    (segundos * 1000.0).round_ties_even() as i64
}

/// A letra sem acento, para os acentos do português, do espanhol e do francês.
fn sem_acento(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
        'è' | 'é' | 'ê' | 'ë' => 'e',
        'ì' | 'í' | 'î' | 'ï' => 'i',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
        'ù' | 'ú' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        'ñ' => 'n',
        'ý' | 'ÿ' => 'y',
        outro => outro,
    }
}

/// A palavra para comparar: minúscula, sem acento e só com letras, números, `_`, `$` e `%`.
fn normalizar(palavra: &str) -> String {
    palavra
        .chars()
        .flat_map(char::to_lowercase)
        .map(sem_acento)
        .filter(|c| c.is_alphanumeric() || matches!(c, '_' | '$' | '%'))
        .collect()
}

fn slug(texto: &str) -> String {
    slug_com(texto, 12)
}

/// Minúsculas ASCII com `-` entre os grupos, até `limite` caracteres.
fn slug_com(texto: &str, limite: usize) -> String {
    let mut slug = String::new();
    for c in texto.chars().flat_map(char::to_lowercase).map(sem_acento) {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug: String = slug.trim_matches('-').chars().take(limite).collect();
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "video".into()
    } else {
        slug.into()
    }
}
