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
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use time::OffsetDateTime;

use crate::Etapa;
use crate::claude_code::ClaudeCode;
use crate::custo::{TabelaDePrecos, preco_a_conferir};
use crate::files::{copy_dir, write_json};
use crate::kit::Kit;
use crate::process::{self, Interrupted, Stream};
use crate::roteiro::{ROTEIRO, VERSAO_DO_ROTEIRO, validar_na_pasta};

/// O log das sessões: uma linha do `stream-json` por linha, como o Claude as emitiu. Cada
/// tentativa acrescenta a sua, que começa no `init` com o `session_id`.
const LOG: &str = "edit/sessao-roteiro.jsonl";
/// O mesmo para a Revisão.
const LOG_DA_REVISAO: &str = "edit/sessao-revisao.jsonl";
/// Os erros do roteiro inválido, para a próxima tentativa.
const ERROS: &str = "edit/erros-do-roteiro.txt";
/// Uma linha por sessão, de todas as etapas (ADR 0007).
const CUSTOS: &str = "edit/custos.json";
const ARQUIVO_DE_APRENDIZADOS: &str = "aprendizados.md";
/// Quantos caracteres do alvo de uma ação entram no evento.
const MAX_TARGET_CHARS: usize = 120;
/// Quantas linhas do stderr entram no detalhe de uma sessão que caiu.
const STDERR_DETAIL_LINES: usize = 10;

/// As regras de `Bash` e as mesmas no formato do `PowerShell`, que o Claude Code do Windows usa
/// quando não acha o Git Bash. Com o Git Bash, as regras escopadas de `PowerShell` mantêm a
/// ferramenta ligada ao lado do `Bash`; sem elas, a negação de um `Bash(...)` a desligaria.
const ALLOWED_TOOLS: [&str; 30] = [
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
    "PowerShell(shorts-cli validar *)",
    "PowerShell(shorts-cli tsc *)",
    "PowerShell(shorts-cli still *)",
    "PowerShell(shorts-cli cena *)",
    // Os apelidos (`ls`, `cat`, `gc`, `sls`) caem no cmdlet; um pipeline precisa que cada
    // parte case com uma regra.
    "PowerShell(Get-ChildItem *)",
    "PowerShell(Get-Content *)",
    "PowerShell(Select-String *)",
    "PowerShell(Select-Object *)",
    "PowerShell(Measure-Object *)",
];

const DISALLOWED_TOOLS: [&str; 14] = [
    "Bash(rm:*)",
    "WebFetch",
    "WebSearch",
    "Bash(curl:*)",
    "Bash(wget:*)",
    "Bash(yt-dlp:*)",
    "Bash(ffmpeg:*)",
    "PowerShell(Remove-Item *)",
    "PowerShell(Invoke-WebRequest *)",
    "PowerShell(Invoke-RestMethod *)",
    // No PowerShell 7, `curl` e `wget` são os executáveis, não apelidos do Invoke-WebRequest.
    "PowerShell(curl *)",
    "PowerShell(wget *)",
    "PowerShell(yt-dlp *)",
    "PowerShell(ffmpeg *)",
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
    /// O `costBasis` do Claude Code (`list`, `unknown`...), se ele informou.
    #[serde(default)]
    pub custo_base: Option<String>,
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
    /// O preço de API que o app calcula com os tokens e a tabela de preços; `None` se algum
    /// modelo não está na tabela.
    #[serde(default)]
    pub custo_calculado_usd: Option<f64>,
    /// A data da tabela de preços usada no cálculo.
    #[serde(default)]
    pub tabela_data: Option<String>,
    /// O cálculo do app diverge do `total_cost_usd` em mais de 5% ou o `costBasis` é `unknown`.
    #[serde(default)]
    pub preco_a_conferir: bool,
    pub turnos: u32,
    pub duracao_ms: u64,
    /// O `result` final foi um `error_during_execution` com os custos zerados: o valor é o do
    /// `result` anterior (ou zero, sem ele) e pode estar incompleto.
    pub parcial: bool,
    pub modelos: BTreeMap<String, UsoDoModelo>,
}

/// Como a sessão de revisão terminou: a última linha da resposta.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResultadoDaRevisao {
    /// `ROTEIRO_ATUALIZADO`: o roteiro mudou e a Produção refaz os cortes alterados.
    Atualizado,
    /// `SEM_MUDANCAS`.
    SemMudancas,
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
    #[error("o Claude Code não foi encontrado")]
    ClaudeNaoEncontrado,
    #[error("sessão do Claude interrompida: {0}")]
    Io(#[from] io::Error),
    /// Um `rate_limit_event` de limite atingido: o projeto espera a cota liberar.
    #[error("a cota do plano acabou")]
    CotaEsgotada {
        /// Quando a cota libera, em segundos desde 1970 (`resetsAt`), se o Claude disse.
        libera_em: Option<i64>,
    },
    #[error("a sessão do Claude terminou sem resultado: {0}")]
    SessaoCaiu(String),
    #[error("o Claude terminou sem gravar o roteiro ({})", ROTEIRO)]
    SemRoteiro,
    #[error("roteiro inválido:\n{0}")]
    Invalido(String),
}

impl From<Interrupted> for ErroDoRoteiro {
    fn from(interrupted: Interrupted) -> Self {
        match interrupted {
            Interrupted::Cancelled => Self::Cancelado,
            Interrupted::Io(error) => Self::Io(error),
        }
    }
}

/// A skill e a pasta de aprendizados que a sessão enxerga.
#[derive(Debug, Clone)]
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
    match fs::remove_dir_all(&skill) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
        _ => {}
    }
    copy_dir(&assets.join("corte-viral"), &skill)?;
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

/// O `claude` e as pastas que a sessão do Roteiro usa.
pub struct Roteirista {
    claude: ClaudeCode,
    /// Os assets do app, de onde vem a skill.
    assets_dir: PathBuf,
    app_data_dir: PathBuf,
    /// A skill nos dados do app, copiada na primeira sessão desta execução do app.
    skill: Mutex<Option<Skill>>,
    /// A pasta do `shorts-cli`, posta na frente do `PATH` da sessão.
    cli_dir: Option<PathBuf>,
}

impl Roteirista {
    pub fn new(
        claude: ClaudeCode,
        assets_dir: PathBuf,
        app_data_dir: PathBuf,
        cli_dir: Option<PathBuf>,
    ) -> Self {
        Self {
            claude,
            assets_dir,
            app_data_dir,
            skill: Mutex::new(None),
            cli_dir,
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
        self.sessao(Etapa::Roteiro, pedido, cancelar, evento)
            .map(|_| ())
    }

    /// Roda uma rodada de revisão: o Claude confere as folhas de revisão (já geradas em
    /// `edit/cortes/*/revisao.png`) e corrige o roteiro. O núcleo valida o roteiro no fim.
    /// `Atualizado` vale também quando a resposta não traz a marca mas o roteiro mudou.
    pub fn revisar(
        &self,
        pedido: &Pedido<'_>,
        cancelar: &AtomicBool,
        evento: &mut dyn FnMut(EventoDaSessao),
    ) -> Result<ResultadoDaRevisao, ErroDoRoteiro> {
        let antes = fs::read(pedido.pasta.join(ROTEIRO)).ok();
        let marca = self.sessao(Etapa::Revisao, pedido, cancelar, evento)?;
        let depois = fs::read(pedido.pasta.join(ROTEIRO)).ok();
        Ok(marca.unwrap_or(if antes == depois {
            ResultadoDaRevisao::SemMudancas
        } else {
            ResultadoDaRevisao::Atualizado
        }))
    }

    fn sessao(
        &self,
        etapa: Etapa,
        pedido: &Pedido<'_>,
        cancelar: &AtomicBool,
        evento: &mut dyn FnMut(EventoDaSessao),
    ) -> Result<Option<ResultadoDaRevisao>, ErroDoRoteiro> {
        let (modelo_do_prompt, arquivo_do_log) = match etapa {
            Etapa::Revisao => ("prompts/revisar.md", LOG_DA_REVISAO),
            _ => ("prompts/roteirizar.md", LOG),
        };
        let skill = self.skill()?;
        if etapa == Etapa::Roteiro {
            semear_estilo(pedido.pasta)?;
        }
        let prompt = prompt(&skill, pedido, modelo_do_prompt)?;
        let command = self.command(&skill, pedido)?;
        let inicio = OffsetDateTime::now_utc();
        let mut log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(pedido.pasta.join(arquivo_do_log))?;
        let mut stream = StreamState::default();
        let output =
            process::run_with_input(command, Some(&prompt), cancelar, &mut |kind, line| {
                if kind == Stream::Stdout {
                    let _ = writeln!(log, "{line}");
                    stream.line(line, evento);
                }
            })?;
        let tabela = TabelaDePrecos::atual(&self.app_data_dir);
        if let Some(custo) = stream.custo(etapa, inicio, &tabela) {
            registrar_custo(pedido.pasta, &custo)?;
        }
        let sem_resposta = stream
            .results
            .last()
            .is_none_or(|result| result["is_error"].as_bool().unwrap_or(false));
        if let Some(libera_em) = stream.cota
            && (!output.status.success() || sem_resposta)
        {
            return Err(ErroDoRoteiro::CotaEsgotada { libera_em });
        }
        if !output.status.success() {
            return Err(ErroDoRoteiro::SessaoCaiu(failure_detail(
                &output.stderr,
                &stream,
            )));
        }
        if stream.results.is_empty() {
            return Err(ErroDoRoteiro::SessaoCaiu(
                "nenhum resultado no stream".to_owned(),
            ));
        }
        if etapa == Etapa::Roteiro {
            completar_estilo(pedido.pasta)?;
        }
        validar_roteiro(pedido.pasta)?;
        Ok(stream.marca_da_revisao())
    }

    /// A skill nos dados do app. A cópia sai uma vez por execução; se falhar, a próxima
    /// sessão tenta de novo.
    fn skill(&self) -> io::Result<Skill> {
        let mut skill = self.skill.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(skill) = skill.as_ref() {
            return Ok(skill.clone());
        }
        let preparada = preparar_skill(&self.assets_dir, &self.app_data_dir)?;
        *skill = Some(preparada.clone());
        Ok(preparada)
    }

    fn command(&self, skill: &Skill, pedido: &Pedido<'_>) -> Result<Command, ErroDoRoteiro> {
        let exe = self
            .claude
            .locate()
            .ok_or(ErroDoRoteiro::ClaudeNaoEncontrado)?;
        let mut command = self.claude.command(&exe);
        command
            .current_dir(pedido.pasta)
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
            .arg(&skill.skill)
            .arg("--add-dir")
            .arg(&skill.aprendizados)
            .arg("--allowedTools")
            .arg(ALLOWED_TOOLS.join(","))
            .arg("--disallowedTools")
            .arg(
                DISALLOWED_TOOLS
                    .iter()
                    .map(|&tool| tool.to_owned())
                    // A negação vence o `acceptEdits` e o `--add-dir`: a skill fica somente
                    // leitura, e os aprendizados seguem graváveis.
                    .chain([format!("Edit(/{}/**)", permission_path(&skill.skill))])
                    .collect::<Vec<_>>()
                    .join(","),
            );
        if let Some(modelo) = pedido.modelo {
            command.args(["--model", modelo]);
        }
        if let Some(cli_dir) = &self.cli_dir {
            let path = std::env::var_os("PATH").unwrap_or_default();
            let dirs = std::iter::once(cli_dir.clone()).chain(std::env::split_paths(&path));
            let path: OsString = std::env::join_paths(dirs)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
            command.env("PATH", path);
        }
        Ok(command)
    }
}

/// O prompt da skill (`prompts/roteirizar.md` ou `prompts/revisar.md`) com os dados do projeto no lugar dos `{...}`.
fn prompt(skill: &Skill, pedido: &Pedido<'_>, arquivo: &str) -> io::Result<String> {
    let modelo = fs::read_to_string(skill.skill.join(arquivo))?;
    let mut extra = String::new();
    if !pedido.pedido.trim().is_empty() {
        extra.push_str(&format!(
            "\n## Pedido do usuário para este lote\n\n{}\n",
            pedido.pedido.trim()
        ));
    }
    if let Some(kit) = Kit::ler(pedido.pasta) {
        extra.push_str(&format!(
            "\n## Kit de marca do projeto\n\nO `estilo` de `{ROTEIRO}` já traz as cores e as \
             fontes do kit: mantenha-o. Para os títulos caberem na caixa e fora do canto da \
             logo:\n\n{}",
            kit.resumo()
        ));
    }
    if let Ok(erros) = fs::read_to_string(pedido.pasta.join(ERROS)) {
        extra.push_str(&format!(
            "\n## Erros da tentativa anterior\n\nO roteiro anterior terminou inválido, e o \
             projeto falhou nesta etapa. Corrija estes erros:\n\n{erros}\n"
        ));
    }
    let troca = [
        ("{SKILL}", skill.skill.display().to_string()),
        ("{APRENDIZADOS}", skill.aprendizados.display().to_string()),
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

/// Escreve o `estilo` do kit do projeto em `edit/roteiro.json` antes do Claude. Um roteiro que já
/// existe (a tentativa anterior, inválida) fica como está.
fn semear_estilo(pasta: &Path) -> io::Result<()> {
    let caminho = pasta.join(ROTEIRO);
    let Some(kit) = Kit::ler(pasta) else {
        return Ok(());
    };
    if caminho.exists() {
        return Ok(());
    }
    write_json(
        &caminho,
        &serde_json::json!({"versao": VERSAO_DO_ROTEIRO, "estilo": kit.estilo(), "cortes": []}),
    )
}

/// Repõe no `estilo` do roteiro o que o kit define e o Claude deixou de fora; o que ele
/// escolheu de propósito fica.
fn completar_estilo(pasta: &Path) -> io::Result<()> {
    let caminho = pasta.join(ROTEIRO);
    let Some(kit) = Kit::ler(pasta) else {
        return Ok(());
    };
    let Ok(Value::Object(mut roteiro)) = fs::read(&caminho)
        .map_err(|_| ())
        .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|_| ()))
    else {
        return Ok(());
    };
    let mut estilo = match roteiro.remove("estilo") {
        Some(Value::Object(estilo)) => estilo,
        _ => Map::new(),
    };
    for (chave, valor) in kit.estilo() {
        match (estilo.get_mut(&chave), valor) {
            (Some(Value::Object(atual)), Value::Object(padrao)) => {
                for (chave, valor) in padrao {
                    atual.entry(chave).or_insert(valor);
                }
            }
            (Some(_), _) => {}
            (None, valor) => {
                estilo.insert(chave, valor);
            }
        }
    }
    roteiro.insert("estilo".to_owned(), Value::Object(estilo));
    write_json(&caminho, &roteiro)
}

fn validar_roteiro(pasta: &Path) -> Result<(), ErroDoRoteiro> {
    let texto = match fs::read_to_string(pasta.join(ROTEIRO)) {
        Ok(texto) => texto,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(ErroDoRoteiro::SemRoteiro);
        }
        Err(error) => return Err(error.into()),
    };
    if sem_cortes(&texto) {
        return Err(ErroDoRoteiro::SemRoteiro);
    }
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

/// O roteiro é o que o núcleo semeou com o `estilo`: o Claude não escreveu nenhum corte.
fn sem_cortes(texto: &str) -> bool {
    serde_json::from_str::<Value>(texto)
        .is_ok_and(|roteiro| roteiro["cortes"].as_array().is_some_and(Vec::is_empty))
}

/// Acrescenta a linha da sessão ao `custos.json`, sem tocar nas das sessões anteriores.
fn registrar_custo(pasta: &Path, custo: &Custo) -> io::Result<()> {
    let caminho = pasta.join(CUSTOS);
    let mut custos: Vec<Value> = fs::read(&caminho)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    custos.push(serde_json::to_value(custo)?);
    write_json(&caminho, &custos)
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

/// As últimas linhas do stderr; sem elas, o texto do último `result`.
fn failure_detail(stderr: &str, stream: &StreamState) -> String {
    let lines: Vec<&str> = stderr.lines().rev().take(STDERR_DETAIL_LINES).collect();
    let stderr = lines.into_iter().rev().collect::<Vec<_>>().join("\n");
    if !stderr.trim().is_empty() {
        return stderr;
    }
    stream
        .results
        .last()
        .and_then(|result| result["result"].as_str())
        .unwrap_or("sem detalhe")
        .to_owned()
}

/// O que o `stream-json` da sessão disse até agora, lido linha a linha.
#[derive(Default)]
struct StreamState {
    /// Entrada e cache de cada mensagem, pelo `message.id`: o Claude repete o `usage` em cada
    /// bloco da mesma mensagem, então a soma é sobre as mensagens, não sobre as linhas.
    usage_by_message: HashMap<String, (u32, u32)>,
    results: Vec<Value>,
    session_id: Option<String>,
    /// Um `rate_limit_event` de limite atingido, com a hora em que a cota libera.
    cota: Option<Option<i64>>,
}

impl StreamState {
    fn line(&mut self, line: &str, evento: &mut dyn FnMut(EventoDaSessao)) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return;
        };
        if self.session_id.is_none() {
            self.session_id = value["session_id"].as_str().map(str::to_owned);
        }
        match value["type"].as_str() {
            Some("assistant") => self.assistant_message(&value["message"], evento),
            Some("result") => self.results.push(value),
            Some("rate_limit_event") => {
                let info = &value["rate_limit_info"];
                let creditos = [&info["errorCode"], &value["errorCode"]]
                    .iter()
                    .any(|codigo| *codigo == "credits_required");
                if info["status"] == "rejected" || creditos {
                    self.cota = Some(info["resetsAt"].as_i64());
                }
            }
            _ => {}
        }
    }

    fn assistant_message(&mut self, message: &Value, evento: &mut dyn FnMut(EventoDaSessao)) {
        for block in message["content"].as_array().into_iter().flatten() {
            match block["type"].as_str() {
                Some("tool_use") => evento(EventoDaSessao::Acao {
                    ferramenta: block["name"].as_str().unwrap_or("?").to_owned(),
                    alvo: tool_target(&block["input"]),
                }),
                Some("text") => {
                    if let Some(alvo) = block["text"].as_str().and_then(first_line) {
                        evento(EventoDaSessao::Acao {
                            ferramenta: "texto".to_owned(),
                            alvo: Some(alvo),
                        });
                    }
                }
                _ => {}
            }
        }
        if let (Some(id), usage) = (message["id"].as_str(), &message["usage"])
            && usage.is_object()
        {
            let number =
                |key: &str| u32::try_from(usage[key].as_u64().unwrap_or(0)).unwrap_or(u32::MAX);
            let cache = number("cache_creation_input_tokens")
                .saturating_add(number("cache_read_input_tokens"));
            self.usage_by_message
                .insert(id.to_owned(), (number("input_tokens"), cache));
            let sum = |field: fn(&(u32, u32)) -> u32| {
                self.usage_by_message
                    .values()
                    .fold(0u32, |total, usage| total.saturating_add(field(usage)))
            };
            evento(EventoDaSessao::Tokens {
                entrada: sum(|usage| usage.0),
                cache: sum(|usage| usage.1),
            });
        }
    }

    /// A marca na última linha com texto da resposta final.
    fn marca_da_revisao(&self) -> Option<ResultadoDaRevisao> {
        let ultima = self
            .results
            .last()?
            .get("result")?
            .as_str()?
            .lines()
            .map(str::trim)
            .rfind(|linha| !linha.is_empty())?;
        match ultima {
            "ROTEIRO_ATUALIZADO" => Some(ResultadoDaRevisao::Atualizado),
            "SEM_MUDANCAS" => Some(ResultadoDaRevisao::SemMudancas),
            _ => None,
        }
    }

    /// O custo vem do **último** `result` (inclui os sub-agentes) e nunca se soma. Um último
    /// `error_during_execution` com tudo zerado cede o lugar ao `result` anterior, e só então
    /// o valor sai marcado como parcial.
    fn custo(
        &self,
        etapa: Etapa,
        inicio: OffsetDateTime,
        tabela: &TabelaDePrecos,
    ) -> Option<Custo> {
        let last = self.results.last()?;
        let parcial = last["subtype"] == "error_during_execution" && is_zeroed(last);
        let chosen = match self.results.len() {
            n if parcial && n > 1 => &self.results[n - 2],
            _ => last,
        };
        let modelos = chosen["modelUsage"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(name, usage)| {
                let number = |key: &str| usage[key].as_u64().unwrap_or(0);
                (
                    name.clone(),
                    UsoDoModelo {
                        entrada: number("inputTokens"),
                        saida: number("outputTokens"),
                        cache_leitura: number("cacheReadInputTokens"),
                        cache_criacao: number("cacheCreationInputTokens"),
                        custo_usd: usage["costUSD"].as_f64().unwrap_or(0.0),
                        custo_base: usage["costBasis"].as_str().map(str::to_owned),
                    },
                )
            })
            .collect();
        let custo_usd = chosen["total_cost_usd"].as_f64().unwrap_or(0.0);
        let custo_calculado_usd = tabela.preco_de_api(&modelos);
        Some(Custo {
            etapa,
            session_id: self.session_id.clone(),
            inicio,
            custo_usd,
            custo_calculado_usd,
            tabela_data: Some(tabela.data.clone()),
            preco_a_conferir: preco_a_conferir(custo_calculado_usd, custo_usd, &modelos),
            turnos: u32::try_from(chosen["num_turns"].as_u64().unwrap_or(0)).unwrap_or(u32::MAX),
            duracao_ms: chosen["duration_ms"].as_u64().unwrap_or(0),
            parcial,
            modelos,
        })
    }
}

fn is_zeroed(result: &Value) -> bool {
    result["total_cost_usd"].as_f64().unwrap_or(0.0) == 0.0
        && result["modelUsage"].as_object().is_none_or(|models| {
            models
                .values()
                .all(|usage| usage["costUSD"].as_f64().unwrap_or(0.0) == 0.0)
        })
}

/// O que a ferramenta está tocando: o arquivo, o comando ou o padrão da busca.
fn tool_target(input: &Value) -> Option<String> {
    [
        "file_path",
        "path",
        "command",
        "pattern",
        "skill",
        "description",
    ]
    .iter()
    .find_map(|key| input[*key].as_str())
    .and_then(first_line)
}

/// A primeira linha com texto, cortada em [`MAX_TARGET_CHARS`] caracteres.
fn first_line(text: &str) -> Option<String> {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    Some(line.chars().take(MAX_TARGET_CHARS).collect())
}
