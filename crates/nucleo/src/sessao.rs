//! A sessão do Claude da etapa Roteiro: abre o `claude -p` na pasta do projeto, transforma cada
//! linha do `stream-json` em evento e em log, lê o custo do último `result` e valida o roteiro
//! no fim. Roteiro inválido vira erro com a lista de problemas, que a próxima sessão recebe.

use std::collections::{BTreeMap, HashMap};
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf, Prefix};
use std::process::Command;
use std::sync::atomic::AtomicBool;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;

use crate::Etapa;
use crate::processo::{self, Fluxo, Interrompido};
use crate::projeto::gravar_json;
use crate::roteiro::{ROTEIRO, validar_na_pasta};

/// O log das sessões: uma linha do `stream-json` por linha, como o Claude as emitiu. Cada
/// tentativa acrescenta a sua, que começa no `init` com o `session_id`.
const LOG: &str = "edit/sessao-roteiro.jsonl";
/// Os erros do roteiro inválido, para a próxima tentativa.
const ERROS: &str = "edit/erros-do-roteiro.txt";
/// Uma linha por sessão, de todas as etapas (ADR 0007).
const CUSTOS: &str = "edit/custos.json";
const ARQUIVO_DE_APRENDIZADOS: &str = "aprendizados.md";
/// Quantos caracteres do alvo de uma ação entram no evento.
const ALVO_MAXIMO: usize = 120;
/// Quantas linhas do stderr entram no detalhe de uma sessão que caiu.
const LINHAS_DE_DETALHE: usize = 10;

const FERRAMENTAS_LIBERADAS: [&str; 21] = [
    "Read",
    "Write",
    "Edit",
    "MultiEdit",
    "Glob",
    "Grep",
    "Skill",
    "Task",
    "Agent",
    "TodoWrite",
    "Bash(shorts-cli validar:*)",
    "Bash(shorts-cli tsc:*)",
    "Bash(shorts-cli still:*)",
    "Bash(shorts-cli cena:*)",
    "Bash(grep:*)",
    "Bash(ls:*)",
    "Bash(head:*)",
    "Bash(tail:*)",
    "Bash(wc:*)",
    "Bash(sed -n:*)",
    "Bash(cat:*)",
];

const FERRAMENTAS_NEGADAS: [&str; 7] = [
    "Bash(rm:*)",
    "WebFetch",
    "WebSearch",
    "Bash(curl:*)",
    "Bash(wget:*)",
    "Bash(yt-dlp:*)",
    "Bash(ffmpeg:*)",
];

/// Um passo da sessão, para a interface mostrar ao vivo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventoDaSessao {
    /// O Claude usou uma ferramenta (`Read`, `Bash`...) ou escreveu um texto (`texto`).
    Acao {
        ferramenta: String,
        alvo: Option<String>,
    },
    /// Os tokens da sessão até agora, somados por mensagem: os de entrada e os de cache
    /// (criação e leitura).
    Tokens { entrada: u32, cache: u32 },
}

/// O que cada modelo gastou na sessão (`modelUsage` do último `result`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsoDoModelo {
    pub entrada: u64,
    pub saida: u64,
    pub cache_leitura: u64,
    pub cache_criacao: u64,
    pub custo_usd: f64,
}

/// O custo de uma sessão, como o último `result` o informa: uma linha do `custos.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Custo {
    pub etapa: Etapa,
    pub session_id: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub inicio: OffsetDateTime,
    pub custo_usd: f64,
    pub turnos: u32,
    pub duracao_ms: u64,
    /// O `result` final foi `error_during_execution`: o valor pode estar incompleto.
    pub parcial: bool,
    pub modelos: BTreeMap<String, UsoDoModelo>,
}

/// O que a sessão precisa saber do projeto.
pub struct Pedido<'a> {
    /// A pasta do projeto, diretório de trabalho do Claude.
    pub pasta: &'a Path,
    /// O nome do vídeo original, que vai no `fonte` do roteiro.
    pub video: &'a str,
    pub idioma: &'a str,
    /// Até quantos cortes com status `produzir`.
    pub cortes: u8,
    /// O pedido do lote; vazio quando não há.
    pub pedido: &'a str,
    /// O `--model`; `None` deixa o padrão do Claude Code.
    pub modelo: Option<&'a str>,
}

#[derive(Debug, thiserror::Error)]
pub enum ErroDoRoteiro {
    #[error("sessão do Claude cancelada")]
    Cancelado,
    #[error("sessão do Claude interrompida: {0}")]
    Io(#[from] io::Error),
    #[error("a sessão do Claude terminou sem resultado: {0}")]
    SessaoCaiu(String),
    #[error("o Claude terminou sem gravar o roteiro ({})", ROTEIRO)]
    SemRoteiro,
    #[error("roteiro inválido:\n{0}")]
    Invalido(String),
}

impl From<Interrompido> for ErroDoRoteiro {
    fn from(interrompido: Interrompido) -> Self {
        match interrompido {
            Interrompido::Cancelado => Self::Cancelado,
            Interrompido::Io(error) => Self::Io(error),
        }
    }
}

/// A skill e a pasta de aprendizados que a sessão enxerga.
pub struct Skill {
    /// A skill embutida: a cópia dos assets, somente leitura, trocada nas atualizações.
    pub skill: PathBuf,
    /// Onde o Claude grava as regras que aprende; sobrevive às atualizações.
    pub aprendizados: PathBuf,
}

/// Copia a skill dos assets para os dados do app, trocando a cópia anterior, e cria a pasta
/// de aprendizados com o arquivo que veio da skill, sem tocar no que já existe lá.
pub fn preparar_skill(assets: &Path, app_data_dir: &Path) -> io::Result<Skill> {
    let skill = app_data_dir.join("skill").join("corte-viral");
    let aprendizados = app_data_dir.join("aprendizados");
    let origem = assets.join("corte-viral");
    match fs::remove_dir_all(&skill) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
        _ => {}
    }
    copiar_pasta(&origem, &skill)?;
    fs::create_dir_all(&aprendizados)?;
    let inicial = skill.join("references").join(ARQUIVO_DE_APRENDIZADOS);
    let destino = aprendizados.join(ARQUIVO_DE_APRENDIZADOS);
    if inicial.is_file() {
        if !destino.exists() {
            fs::copy(&inicial, &destino)?;
        }
        fs::remove_file(&inicial)?;
    }
    Ok(Skill {
        skill,
        aprendizados,
    })
}

fn copiar_pasta(origem: &Path, destino: &Path) -> io::Result<()> {
    fs::create_dir_all(destino)?;
    for entrada in fs::read_dir(origem)? {
        let entrada = entrada?;
        let alvo = destino.join(entrada.file_name());
        if entrada.file_type()?.is_dir() {
            copiar_pasta(&entrada.path(), &alvo)?;
        } else {
            fs::copy(entrada.path(), alvo)?;
        }
    }
    Ok(())
}

/// O `claude` e as pastas que a sessão do Roteiro usa.
pub struct Roteirista {
    claude: PathBuf,
    config_dir: PathBuf,
    skill: Skill,
    /// A pasta do `shorts-cli`, posta na frente do `PATH` da sessão.
    pasta_do_cli: Option<PathBuf>,
}

impl Roteirista {
    pub fn new(
        claude: PathBuf,
        config_dir: PathBuf,
        skill: Skill,
        pasta_do_cli: Option<PathBuf>,
    ) -> Self {
        Self {
            claude,
            config_dir,
            skill,
            pasta_do_cli,
        }
    }

    /// Roda a sessão do Roteiro, grava o log e o `custos.json` no projeto e valida o roteiro.
    /// `evento` recebe cada passo do Claude enquanto ele acontece; ligar `cancelar` mata a
    /// sessão.
    pub fn roteirizar(
        &self,
        pedido: &Pedido<'_>,
        cancelar: &AtomicBool,
        evento: &mut dyn FnMut(EventoDaSessao),
    ) -> Result<(), ErroDoRoteiro> {
        let prompt = self.prompt(pedido)?;
        let inicio = OffsetDateTime::now_utc();
        let mut log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(pedido.pasta.join(LOG))?;
        let mut acompanhante = Acompanhante::default();
        let saida = processo::executar_com_entrada(
            self.comando(pedido)?,
            Some(&prompt),
            cancelar,
            &mut |fluxo, linha| {
                if fluxo == Fluxo::Stdout {
                    let _ = writeln!(log, "{linha}");
                    acompanhante.linha(linha, evento);
                }
            },
        )?;
        if let Some(custo) = acompanhante.custo(Etapa::Roteiro, inicio) {
            registrar_custo(pedido.pasta, &custo)?;
        }
        if !saida.sucesso {
            let detalhe = detalhe_da_falha(&saida.stderr, &acompanhante);
            return Err(ErroDoRoteiro::SessaoCaiu(detalhe));
        }
        if acompanhante.resultados.is_empty() {
            return Err(ErroDoRoteiro::SessaoCaiu(
                "nenhum resultado no stream".to_owned(),
            ));
        }
        validar_roteiro(pedido.pasta)
    }

    fn comando(&self, pedido: &Pedido<'_>) -> io::Result<Command> {
        let mut comando = Command::new(&self.claude);
        comando
            .current_dir(pedido.pasta)
            .env("CLAUDE_CONFIG_DIR", &self.config_dir)
            .args([
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--strict-mcp-config",
                "--permission-mode",
                "acceptEdits",
            ])
            .arg("--add-dir")
            .arg(&self.skill.skill)
            .arg("--add-dir")
            .arg(&self.skill.aprendizados)
            .arg("--allowedTools")
            .arg(FERRAMENTAS_LIBERADAS.join(","))
            .arg("--disallowedTools")
            .arg(
                FERRAMENTAS_NEGADAS
                    .iter()
                    .map(|&ferramenta| ferramenta.to_owned())
                    // A negação vence o `acceptEdits` e o `--add-dir`: a skill fica somente
                    // leitura, e os aprendizados seguem graváveis.
                    .chain([format!("Edit(/{}/**)", permission_path(&self.skill.skill))])
                    .collect::<Vec<_>>()
                    .join(","),
            );
        if let Some(modelo) = pedido.modelo {
            comando.args(["--model", modelo]);
        }
        if let Some(pasta) = &self.pasta_do_cli {
            let caminhos = std::env::var_os("PATH").unwrap_or_default();
            let todos = std::iter::once(pasta.clone()).chain(std::env::split_paths(&caminhos));
            let path: OsString = std::env::join_paths(todos)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
            comando.env("PATH", path);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // Sem a janela de console piscando a cada sessão.
            comando.creation_flags(0x0800_0000);
        }
        Ok(comando)
    }

    /// O `prompts/roteirizar.md` da skill com os dados do projeto no lugar dos `{...}`.
    fn prompt(&self, pedido: &Pedido<'_>) -> io::Result<String> {
        let modelo = fs::read_to_string(self.skill.skill.join("prompts/roteirizar.md"))?;
        let mut extra = String::new();
        if !pedido.pedido.trim().is_empty() {
            extra.push_str(&format!(
                "\n## Pedido do usuário para este lote\n\n{}\n",
                pedido.pedido.trim()
            ));
        }
        if let Ok(erros) = fs::read_to_string(pedido.pasta.join(ERROS)) {
            extra.push_str(&format!(
                "\n## Erros da tentativa anterior\n\nO roteiro anterior terminou inválido, e o \
                 projeto falhou nesta etapa. Corrija estes erros:\n\n{erros}\n"
            ));
        }
        let troca = [
            ("{SKILL}", self.skill.skill.display().to_string()),
            (
                "{APRENDIZADOS}",
                self.skill.aprendizados.display().to_string(),
            ),
            ("{VIDEO}", pedido.video.to_owned()),
            ("{ROTEIRO}", ROTEIRO.to_owned()),
            ("{CORTES}", pedido.cortes.to_string()),
            ("{IDIOMA}", pedido.idioma.to_owned()),
            ("{EXTRA}", extra),
        ];
        Ok(troca
            .iter()
            .fold(modelo, |texto, (chave, valor)| texto.replace(chave, valor)))
    }
}

fn validar_roteiro(pasta: &Path) -> Result<(), ErroDoRoteiro> {
    let texto = match fs::read_to_string(pasta.join(ROTEIRO)) {
        Ok(texto) => texto,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(ErroDoRoteiro::SemRoteiro);
        }
        Err(error) => return Err(error.into()),
    };
    let validacao = validar_na_pasta(pasta, &texto);
    if validacao.tem_erros() {
        let relatorio = validacao.relatorio();
        fs::write(pasta.join(ERROS), &relatorio)?;
        return Err(ErroDoRoteiro::Invalido(relatorio));
    }
    match fs::remove_file(pasta.join(ERROS)) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error.into()),
        _ => Ok(()),
    }
}

/// Acrescenta a linha da sessão ao `custos.json`, sem tocar nas das sessões anteriores.
fn registrar_custo(pasta: &Path, custo: &Custo) -> io::Result<()> {
    let caminho = pasta.join(CUSTOS);
    let mut custos: Vec<Value> = fs::read(&caminho)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    custos.push(serde_json::to_value(custo)?);
    gravar_json(&caminho, &custos)
}

/// The path in the form Claude Code's permission rules match: forward slashes from the root,
/// with a Windows drive as `/c`.
fn permission_path(path: &Path) -> String {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => match prefix.kind() {
                Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => {
                    parts.push(char::from(drive).to_ascii_lowercase().to_string());
                }
                _ => parts.push(prefix.as_os_str().to_string_lossy().into_owned()),
            },
            Component::RootDir | Component::CurDir => {}
            Component::ParentDir => parts.push("..".to_owned()),
            Component::Normal(name) => parts.push(name.to_string_lossy().into_owned()),
        }
    }
    format!("/{}", parts.join("/"))
}

fn detalhe_da_falha(stderr: &str, acompanhante: &Acompanhante) -> String {
    let linhas: Vec<&str> = stderr.lines().rev().take(LINHAS_DE_DETALHE).collect();
    let stderr = linhas.into_iter().rev().collect::<Vec<_>>().join("\n");
    if !stderr.trim().is_empty() {
        return stderr;
    }
    acompanhante
        .resultados
        .last()
        .and_then(|r| r["result"].as_str())
        .unwrap_or("sem detalhe")
        .to_owned()
}

/// Lê o `stream-json` linha a linha.
#[derive(Default)]
struct Acompanhante {
    /// Entrada e cache de cada mensagem, pelo `message.id`: o Claude repete o `usage` em cada
    /// bloco da mesma mensagem, então a soma é sobre as mensagens, não sobre as linhas.
    usos: HashMap<String, (u32, u32)>,
    resultados: Vec<Value>,
    session_id: Option<String>,
}

impl Acompanhante {
    fn linha(&mut self, linha: &str, evento: &mut dyn FnMut(EventoDaSessao)) {
        let Ok(valor) = serde_json::from_str::<Value>(linha) else {
            return;
        };
        if self.session_id.is_none() {
            self.session_id = valor["session_id"].as_str().map(str::to_owned);
        }
        match valor["type"].as_str() {
            Some("assistant") => self.mensagem(&valor["message"], evento),
            Some("result") => self.resultados.push(valor),
            _ => {}
        }
    }

    fn mensagem(&mut self, mensagem: &Value, evento: &mut dyn FnMut(EventoDaSessao)) {
        for bloco in mensagem["content"].as_array().into_iter().flatten() {
            match bloco["type"].as_str() {
                Some("tool_use") => evento(EventoDaSessao::Acao {
                    ferramenta: bloco["name"].as_str().unwrap_or("?").to_owned(),
                    alvo: alvo_da_ferramenta(&bloco["input"]),
                }),
                Some("text") => {
                    if let Some(alvo) = bloco["text"].as_str().and_then(resumir) {
                        evento(EventoDaSessao::Acao {
                            ferramenta: "texto".to_owned(),
                            alvo: Some(alvo),
                        });
                    }
                }
                _ => {}
            }
        }
        if let (Some(id), usage) = (mensagem["id"].as_str(), &mensagem["usage"])
            && usage.is_object()
        {
            let numero =
                |chave: &str| u32::try_from(usage[chave].as_u64().unwrap_or(0)).unwrap_or(u32::MAX);
            let cache = numero("cache_creation_input_tokens")
                .saturating_add(numero("cache_read_input_tokens"));
            self.usos
                .insert(id.to_owned(), (numero("input_tokens"), cache));
            let soma = |campo: fn(&(u32, u32)) -> u32| {
                self.usos
                    .values()
                    .fold(0u32, |total, uso| total.saturating_add(campo(uso)))
            };
            evento(EventoDaSessao::Tokens {
                entrada: soma(|uso| uso.0),
                cache: soma(|uso| uso.1),
            });
        }
    }

    /// O custo vem do **último** `result` (inclui os sub-agentes) e nunca se soma. Um último
    /// `error_during_execution` com tudo zerado cede o lugar ao `result` anterior; em
    /// qualquer caso o valor sai marcado como parcial.
    fn custo(&self, etapa: Etapa, inicio: OffsetDateTime) -> Option<Custo> {
        let ultimo = self.resultados.last()?;
        let com_erro = ultimo["subtype"] == "error_during_execution";
        let escolhido = if com_erro && zerado(ultimo) && self.resultados.len() > 1 {
            &self.resultados[self.resultados.len() - 2]
        } else {
            ultimo
        };
        let modelos = escolhido["modelUsage"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(nome, uso)| {
                let numero = |chave: &str| uso[chave].as_u64().unwrap_or(0);
                (
                    nome.clone(),
                    UsoDoModelo {
                        entrada: numero("inputTokens"),
                        saida: numero("outputTokens"),
                        cache_leitura: numero("cacheReadInputTokens"),
                        cache_criacao: numero("cacheCreationInputTokens"),
                        custo_usd: uso["costUSD"].as_f64().unwrap_or(0.0),
                    },
                )
            })
            .collect();
        Some(Custo {
            etapa,
            session_id: self.session_id.clone(),
            inicio,
            custo_usd: escolhido["total_cost_usd"].as_f64().unwrap_or(0.0),
            turnos: u32::try_from(escolhido["num_turns"].as_u64().unwrap_or(0)).unwrap_or(u32::MAX),
            duracao_ms: escolhido["duration_ms"].as_u64().unwrap_or(0),
            parcial: com_erro,
            modelos,
        })
    }
}

fn zerado(resultado: &Value) -> bool {
    resultado["total_cost_usd"].as_f64().unwrap_or(0.0) == 0.0
        && resultado["modelUsage"].as_object().is_none_or(|modelos| {
            modelos
                .values()
                .all(|uso| uso["costUSD"].as_f64().unwrap_or(0.0) == 0.0)
        })
}

/// O que a ferramenta está tocando: o arquivo, o comando ou o padrão da busca.
fn alvo_da_ferramenta(entrada: &Value) -> Option<String> {
    [
        "file_path",
        "path",
        "command",
        "pattern",
        "skill",
        "description",
    ]
    .iter()
    .find_map(|chave| entrada[*chave].as_str())
    .and_then(resumir)
}

/// A primeira linha com texto, cortada em [`ALVO_MAXIMO`] caracteres.
fn resumir(texto: &str) -> Option<String> {
    let linha = texto
        .lines()
        .map(str::trim)
        .find(|linha| !linha.is_empty())?;
    Some(linha.chars().take(ALVO_MAXIMO).collect())
}
