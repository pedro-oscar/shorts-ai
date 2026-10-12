//! Núcleo do Shorts AI: o domínio e as regras do app, sem depender do Tauri.
//!
//! A casca Tauri chama os métodos de [`Nucleo`] como comandos e repassa os [`Evento`]s à
//! interface. O núcleo fala por códigos e parâmetros, nunca por frases prontas: quem
//! escreve os textos, em pt-BR ou em inglês, é a interface.

mod claude_code;
mod conta;
pub mod corte;
mod fila;
mod files;
mod galeria;
mod padroes;
mod preferencias;
mod process;
pub mod producao;
mod projeto;
mod remotion;
mod revisao;
pub mod rosto;
pub mod roteiro;
pub mod sessao;
pub mod transcricao;

use std::env::consts::EXE_SUFFIX;
use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use specta::Type;
use time::OffsetDateTime;

pub use crate::claude_code::ClaudeCode;
use crate::conta::Conta;
pub use crate::conta::{Cobranca, EstadoDaConta, ModoDeLogin, VERSAO_MINIMA_DO_CLAUDE_CODE};
use crate::corte::Ffmpeg;
use crate::fila::Fila;
pub use crate::galeria::{AlvoParaAbrir, DadosDoProjeto, ReelDoProjeto, Reserva};
pub use crate::padroes::{IdiomaDoVideo, ModeloDoClaude, Padroes};
use crate::preferencias::{PreferencesFile, Preferencias};
use crate::process::hide_console;
use crate::producao::Producao;
pub use crate::projeto::{EtapaDoProjeto, ModoDeImportacao};
use crate::projeto::{Origem, ProjetoJson};
use crate::remotion::Remotion;
use crate::sessao::Roteirista;
use crate::transcricao::Transcritor;

/// Como a Importação liga o vídeo original ao projeto sem copiá-lo: um hardlink. Se falha, o
/// projeto fica só com a referência ao arquivo.
pub type LigarArquivo = Arc<dyn Fn(&Path, &Path) -> io::Result<()> + Send + Sync>;

/// As extensões de vídeo que o app aceita.
const EXTENSOES: [&str; 3] = ["mp4", "mov", "mkv"];

/// O que o núcleo recebe da casca: onde ficam os dados do app e o idioma do sistema.
#[derive(Default)]
pub struct Config {
    pub app_data_dir: PathBuf,
    /// O `PATH` em que procurar o `claude`, antes dos locais de instalação conhecidos.
    pub path_env: Option<OsString>,
    /// A pasta pessoal, base dos locais de instalação conhecidos do `claude`.
    pub home_dir: Option<PathBuf>,
    /// O idioma do sistema, como `pt-BR` ou `pt_BR.UTF-8`; `None` se não for possível lê-lo.
    pub system_locale: Option<String>,
    /// Há um `ANTHROPIC_API_KEY` no ambiente do app.
    pub chave_de_api_no_ambiente: bool,
    /// A pasta de vídeos do sistema, onde fica a Biblioteca (`Shorts AI`). Sem ela vale
    /// `Videos` na pasta pessoal e, sem esta, a pasta de dados do app.
    pub pasta_de_videos: Option<PathBuf>,
    /// Troca o hardlink da Importação, para os testes simularem volumes diferentes.
    pub ligar_arquivo: Option<LigarArquivo>,
    /// A pasta dos assets do app, com o template Remotion em `remotion/`. Sem ela os projetos
    /// nascem sem Remotion.
    pub assets_dir: Option<PathBuf>,
    /// O `npm` que instala as dependências do Remotion; `None` procura `npm` no `PATH`.
    pub npm: Option<PathBuf>,
    /// O `node` que empacota e renderiza os reels; `None` procura `node` nos sidecars e no
    /// `PATH`.
    pub node: Option<PathBuf>,
    /// A pasta dos programas que vão com o app (sidecars): `ffmpeg`, `ffprobe`, `whisper-cli`
    /// (Vulkan), `whisper-cli-cpu` e `shorts-cli`. Cada um é procurado ali e, na falta, no
    /// `PATH`. Sem ela, a Transcrição e o Roteiro ficam pendentes; o Roteiro também precisa
    /// dos assets, de onde vem a skill.
    pub sidecar_dir: Option<PathBuf>,
    /// O programa que abre pastas e arquivos no programa padrão do sistema; `None` usa o do
    /// sistema (`explorer`, `open` ou `xdg-open`).
    pub abrir_com: Option<PathBuf>,
}

/// Onde ficam, nos dados do app, os modelos da Transcrição (o do Whisper e o do VAD).
const MODELS_DIR: &str = "modelos";

pub struct Nucleo {
    biblioteca: PathBuf,
    path_env: Option<OsString>,
    sidecar_dir: Option<PathBuf>,
    abrir_com: PathBuf,
    fila: Fila,
    remotion: Remotion,
    idioma_da_interface: IdiomaDaInterface,
    chave_de_api_no_ambiente: bool,
    preferencias: Mutex<PreferencesFile>,
    conta: Conta,
    emit: Arc<dyn Fn(Evento) + Send + Sync>,
}

/// O que a interface precisa para abrir.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EstadoInicial {
    pub versao: String,
    pub idioma_da_interface: IdiomaDaInterface,
    /// `None` até a pessoa aceitar a versão atual do Aviso de uso.
    pub aceite: Option<Aceite>,
    /// O plano que a pessoa confirmou na Conta; `None` até ela confirmar.
    pub plano: Option<PlanoConfirmado>,
    /// Há um `ANTHROPIC_API_KEY` no ambiente: a Conta mostra "chave de API no ambiente".
    pub chave_de_api_no_ambiente: bool,
    /// A pasta da Biblioteca, onde ficam os projetos.
    pub biblioteca: String,
    /// Por que as preferências não puderam ser lidas; o idioma da interface é o do sistema.
    pub erro: Option<Erro>,
    /// Onde ficou, ao abrir, o `preferencias.json` que não era JSON válido. As preferências
    /// voltaram ao padrão e, sem o aceite, o Aviso de uso volta também.
    pub backup_das_preferencias: Option<String>,
}

/// O idioma dos textos do app, que segue o do sistema: `pt-*` vira pt-BR e o resto, inglês.
/// Não é o idioma do vídeo, que vale para a transcrição e os textos dos reels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum IdiomaDaInterface {
    #[serde(rename = "pt-BR")]
    PtBr,
    #[serde(rename = "en")]
    En,
}

impl IdiomaDaInterface {
    fn of_locale(locale: Option<&str>) -> Self {
        let language = locale
            .and_then(|locale| locale.split(['-', '_', '.', '@']).next())
            .unwrap_or_default();
        if language.eq_ignore_ascii_case("pt") {
            Self::PtBr
        } else {
            Self::En
        }
    }
}

/// A versão do texto do Aviso de uso. Mudou o conteúdo do Aviso (o que ele diz, não a forma)?
/// Suba a versão: os aceites de versões anteriores deixam de valer, e o Aviso volta para quem
/// já tinha aceitado.
pub const VERSAO_DO_AVISO: u32 = 1;

/// O aceite do Aviso de uso.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Aceite {
    /// A versão do Aviso aceita. Os aceites gravados antes dela não têm o campo e contam
    /// como da versão 0.
    #[serde(default)]
    pub versao: u32,
    /// Quando a pessoa aceitou, em RFC 3339 e UTC.
    #[serde(with = "time::serde::rfc3339")]
    #[specta(type = String)]
    pub data: OffsetDateTime,
}

/// O nível do plano que a pessoa confirma, porque o Claude Code só informa o tipo
/// (`subscriptionType`): não diz se o Max é 5x ou 20x.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum NivelDoPlano {
    Pro,
    Max5x,
    Max20x,
    TeamPadrao,
    TeamPremium,
    Enterprise,
    Console,
}

impl NivelDoPlano {
    /// Console e Enterprise contam como preço de API; os outros, como cota da assinatura.
    fn preco_de_api(self) -> bool {
        matches!(self, Self::Console | Self::Enterprise)
    }
}

/// Como a assinatura é paga.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PeriodoDeCobranca {
    Mensal,
    Anual,
}

/// O plano e a cobrança que a pessoa confirmou.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanoConfirmado {
    pub nivel: NivelDoPlano,
    /// `None` nos planos de preço de API, que não têm mensalidade a escolher.
    pub periodo: Option<PeriodoDeCobranca>,
    /// O uso é cobrado pelo preço de API, não pela cota de uma assinatura.
    pub preco_de_api: bool,
}

/// As etapas por que passa cada projeto, nesta ordem.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Etapa {
    Importacao,
    Transcricao,
    Roteiro,
    Producao,
    Revisao,
}

impl Etapa {
    pub const TODAS: [Self; 5] = [
        Self::Importacao,
        Self::Transcricao,
        Self::Roteiro,
        Self::Producao,
        Self::Revisao,
    ];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum EstadoDaEtapa {
    Pendente,
    EmAndamento,
    Concluida,
    Falhou,
}

/// Um projeto como a interface o mostra na fila.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjetoResumo {
    /// O nome da pasta do projeto na Biblioteca.
    pub id: String,
    pub titulo: String,
    pub pasta: String,
    pub etapas: Vec<EtapaDoProjeto>,
    /// Por que a etapa que falhou falhou, como a mensagem do sistema.
    pub falha: Option<String>,
}

/// Um arquivo de vídeo escolhido, para a lista do passo Vídeos.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ArquivoDeVideo {
    pub caminho: String,
    pub nome: String,
    /// Em bytes.
    pub tamanho: f64,
    /// `None` quando não há como ler a duração (sem o `ffprobe`).
    pub duracao_em_segundos: Option<f64>,
}

/// O que muda no núcleo e a interface acompanha.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(
    tag = "tipo",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Evento {
    AvisoAceito {
        aceite: Aceite,
    },
    PlanoConfirmado {
        plano: PlanoConfirmado,
    },
    /// Uma linha de saída do instalador ou do `claude update`.
    SaidaDoComando {
        linha: String,
    },
    ProjetoCriado {
        projeto: ProjetoResumo,
    },
    /// Uma etapa do projeto mudou de estado.
    EtapaMudou {
        projeto: String,
        etapa: Etapa,
        estado: EstadoDaEtapa,
        falha: Option<String>,
    },
    /// O progresso de uma etapa que o mede, de 0 a 100.
    ProgressoDaEtapa {
        projeto: String,
        etapa: Etapa,
        percentual: u8,
    },
    /// O render da versão final de um projeto mudou de estado: `pendente` na fila,
    /// `emAndamento`, `concluida` ou `falhou`.
    VersaoFinalMudou {
        projeto: String,
        estado: EstadoDaEtapa,
        falha: Option<String>,
    },
    /// O progresso do render da versão final, de 0 a 100.
    ProgressoDaVersaoFinal {
        projeto: String,
        percentual: u8,
    },
    /// Uma ação do Claude numa sessão: a ferramenta (`Read`, `Bash`...) ou `texto`, e o que ela
    /// toca.
    AcaoDoClaude {
        projeto: String,
        etapa: Etapa,
        ferramenta: String,
        alvo: Option<String>,
    },
    /// Os tokens de entrada e de cache que a sessão do Claude já usou.
    TokensDoClaude {
        projeto: String,
        etapa: Etapa,
        entrada: u32,
        cache: u32,
    },
}

/// Os erros do núcleo, como código e parâmetros. `detalhe` é a mensagem do sistema, para
/// diagnóstico.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type, thiserror::Error)]
#[serde(
    tag = "codigo",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Erro {
    #[error("preferências ilegíveis em {caminho}: {detalhe}")]
    PreferenciasIlegiveis { caminho: String, detalhe: String },
    #[error("preferências não gravadas em {caminho}: {detalhe}")]
    PreferenciasNaoGravadas { caminho: String, detalhe: String },
    #[error("login no Claude Code não concluído: {detalhe}")]
    LoginNaoConcluido { detalhe: String },
    #[error("instalação do Claude Code não concluída: {detalhe}")]
    InstalacaoFalhou { detalhe: String },
    #[error("atualização do Claude Code não concluída: {detalhe}")]
    AtualizacaoFalhou { detalhe: String },
    #[error("o Claude não respondeu ao teste: {detalhe}")]
    ClaudeNaoRespondeu { detalhe: String },
    #[error("{caminho} não é um arquivo de vídeo aceito (MP4, MOV ou MKV)")]
    ArquivoInvalido { caminho: String },
    #[error("projeto não criado em {caminho}: {detalhe}")]
    ProjetoNaoCriado { caminho: String, detalhe: String },
    #[error("dependências do Remotion não instaladas: {detalhe}")]
    DependenciasDoRemotionNaoInstaladas { detalhe: String },
    #[error("projeto {id} não lido: {detalhe}")]
    ProjetoNaoLido { id: String, detalhe: String },
    /// A pasta do projeto foi apagada ou movida.
    #[error("projeto {id} não encontrado na Biblioteca")]
    ProjetoNaoEncontrado { id: String },
    #[error("padrão {opcao} inválido: {motivo}")]
    PadroesInvalidos { opcao: String, motivo: String },
    #[error("{caminho} não aberto: {detalhe}")]
    NaoAbriu { caminho: String, detalhe: String },
}

impl Nucleo {
    pub fn new(config: Config, emit: impl Fn(Evento) + Send + Sync + 'static) -> Self {
        let emit: Arc<dyn Fn(Evento) + Send + Sync> = Arc::new(emit);
        let ligar = config
            .ligar_arquivo
            .unwrap_or_else(|| Arc::new(|origem, destino| std::fs::hard_link(origem, destino)));
        let biblioteca = config
            .pasta_de_videos
            .or_else(|| config.home_dir.as_ref().map(|home| home.join("Videos")))
            .unwrap_or_else(|| config.app_data_dir.clone())
            .join("Shorts AI");
        let claude = ClaudeCode::new(
            config.path_env.clone(),
            config.home_dir.clone(),
            config.app_data_dir.join("claude"),
        );
        let transcritor = config
            .sidecar_dir
            .as_deref()
            .map(|dir| transcritor(dir, config.path_env.as_deref(), &config.app_data_dir));
        let roteirista = match (&config.assets_dir, &config.sidecar_dir) {
            (Some(assets_dir), Some(sidecar_dir)) => Some(Roteirista::new(
                claude.clone(),
                assets_dir.clone(),
                config.app_data_dir.clone(),
                Some(sidecar_dir.clone()),
            )),
            _ => None,
        };
        let producao = config.sidecar_dir.as_deref().map(|dir| {
            let programa = |nome: &str| {
                find_program(nome, Some(dir), config.path_env.as_deref())
                    .unwrap_or_else(|| PathBuf::from(nome))
            };
            Producao::new(
                Ffmpeg::new(programa("ffmpeg"), programa("ffprobe")),
                config.node.clone().unwrap_or_else(|| programa("node")),
            )
        });
        Self {
            biblioteca,
            fila: Fila::new(Arc::clone(&emit), ligar, transcritor, roteirista, producao),
            remotion: Remotion::new(config.assets_dir, &config.app_data_dir, config.npm),
            path_env: config.path_env,
            sidecar_dir: config.sidecar_dir,
            abrir_com: config.abrir_com.unwrap_or_else(galeria::programa_de_abrir),
            idioma_da_interface: IdiomaDaInterface::of_locale(config.system_locale.as_deref()),
            chave_de_api_no_ambiente: config.chave_de_api_no_ambiente,
            preferencias: Mutex::new(PreferencesFile::in_dir(&config.app_data_dir)),
            conta: Conta::new(claude),
            emit,
        }
    }

    pub fn estado_inicial(&self) -> EstadoInicial {
        let mut file = self.preferences_file();
        let (preferencias, erro) = match file.read() {
            Ok(preferencias) => (preferencias, None),
            Err(erro) => (Preferencias::default(), Some(erro)),
        };
        EstadoInicial {
            versao: env!("CARGO_PKG_VERSION").to_owned(),
            idioma_da_interface: self.idioma_da_interface,
            aceite: preferencias
                .aceite
                .filter(|aceite| aceite.versao >= VERSAO_DO_AVISO),
            plano: preferencias.plano,
            chave_de_api_no_ambiente: self.chave_de_api_no_ambiente,
            biblioteca: self.biblioteca.display().to_string(),
            erro,
            backup_das_preferencias: file.backup(),
        }
    }

    /// Grava o aceite do Aviso de uso, com a data de agora.
    pub fn aceitar_aviso(&self) -> Result<Aceite, Erro> {
        let mut file = self.preferences_file();
        let mut preferencias = file.read()?;
        let aceite = Aceite {
            versao: VERSAO_DO_AVISO,
            data: OffsetDateTime::now_utc(),
        };
        preferencias.aceite = Some(aceite.clone());
        file.write(&preferencias)?;
        (self.emit)(Evento::AvisoAceito {
            aceite: aceite.clone(),
        });
        Ok(aceite)
    }

    /// Procura o Claude Code e consulta o login na configuração própria do app.
    pub fn verificar_conta(&self) -> EstadoDaConta {
        self.conta.estado()
    }

    /// Abre o login da Anthropic pelo Claude Code, no processo filho ou, com `por_terminal`,
    /// no terminal do sistema (para colar o código que o navegador mostrar), e espera o status
    /// mudar. Devolve o estado da conta sem esperar nada quando não há o que fazer (sem Claude
    /// Code, versão antiga ou já logado).
    pub fn entrar_no_claude_code(
        &self,
        modo: ModoDeLogin,
        por_terminal: bool,
    ) -> Result<EstadoDaConta, Erro> {
        self.conta.entrar(modo, por_terminal)
    }

    /// Roda o instalador oficial do Claude Code e detecta a conta de novo. A saída chega
    /// como [`Evento::SaidaDoComando`].
    pub fn instalar_claude_code(&self) -> Result<EstadoDaConta, Erro> {
        self.conta.instalar(&|linha| self.emit_line(linha))
    }

    /// Roda `claude update`. A saída chega como [`Evento::SaidaDoComando`].
    pub fn atualizar_claude_code(&self) -> Result<EstadoDaConta, Erro> {
        self.conta.atualizar(&|linha| self.emit_line(linha))
    }

    /// Grava o nível e a cobrança do plano que a pessoa confirmou. Nos planos de preço de
    /// API não há período a gravar.
    pub fn confirmar_plano(
        &self,
        nivel: NivelDoPlano,
        periodo: PeriodoDeCobranca,
    ) -> Result<PlanoConfirmado, Erro> {
        let mut file = self.preferences_file();
        let mut preferencias = file.read()?;
        let plano = PlanoConfirmado {
            nivel,
            periodo: (!nivel.preco_de_api()).then_some(periodo),
            preco_de_api: nivel.preco_de_api(),
        };
        preferencias.plano = Some(plano.clone());
        file.write(&preferencias)?;
        (self.emit)(Evento::PlanoConfirmado {
            plano: plano.clone(),
        });
        Ok(plano)
    }

    /// Confere os arquivos escolhidos e lê a duração de cada um (com o `ffprobe`, se houver).
    pub fn inspecionar_arquivos(&self, caminhos: &[String]) -> Result<Vec<ArquivoDeVideo>, Erro> {
        caminhos
            .iter()
            .map(|caminho| {
                let path = validar_arquivo(caminho)?;
                Ok(ArquivoDeVideo {
                    caminho: caminho.clone(),
                    nome: nome_do_arquivo(&path),
                    #[allow(clippy::cast_precision_loss)]
                    tamanho: path.metadata().map_or(0, |meta| meta.len()) as f64,
                    duracao_em_segundos: self.duracao(&path),
                })
            })
            .collect()
    }

    /// Instala, uma vez, as dependências do Remotion nos dados do app; os projetos as enxergam
    /// pelo `node_modules` ligado (ADR 0003).
    pub fn instalar_dependencias_do_remotion(&self) -> Result<(), Erro> {
        self.remotion.instalar_dependencias().map_err(|error| {
            Erro::DependenciasDoRemotionNaoInstaladas {
                detalhe: error.to_string(),
            }
        })
    }

    /// Cria um lote de projetos, um por arquivo, cada um com a sua pasta na Biblioteca, e
    /// põe todos na fila, com os padrões do lote. Nada é criado se algum arquivo ou padrão não
    /// for aceito.
    pub fn criar_lote(
        &self,
        caminhos: &[String],
        padroes: &Padroes,
    ) -> Result<Vec<ProjetoResumo>, Erro> {
        padroes.validar()?;
        let arquivos = caminhos
            .iter()
            .map(|caminho| validar_arquivo(caminho))
            .collect::<Result<Vec<_>, _>>()?;
        let agora = OffsetDateTime::now_utc();
        let lote = self.reservar_lote(agora)?;
        let mut projetos = Vec::new();
        let resultado = self.criar_projetos(&lote, agora, &arquivos, padroes, &mut projetos);
        self.registrar_lote(&lote, agora, &projetos)?;
        resultado.map(|()| projetos)
    }

    fn criar_projetos(
        &self,
        lote: &str,
        agora: OffsetDateTime,
        arquivos: &[PathBuf],
        padroes: &Padroes,
        projetos: &mut Vec<ProjetoResumo>,
    ) -> Result<(), Erro> {
        for arquivo in arquivos {
            let titulo = arquivo
                .file_stem()
                .map_or_else(String::new, |nome| nome.to_string_lossy().into_owned());
            let nao_criado = |caminho: &Path, error: io::Error| lote_nao_criado(caminho, &error);
            let pasta = projeto::criar_pasta(&self.biblioteca, &titulo, agora.date())
                .map_err(|error| nao_criado(&self.biblioteca, error))?;
            let mut json = ProjetoJson::novo(
                titulo,
                lote.to_owned(),
                Origem::Arquivo {
                    caminho: arquivo.display().to_string(),
                    nome: nome_do_arquivo(arquivo),
                    tamanho: 0,
                    modificado_em: None,
                    modo: None,
                },
                agora,
            );
            json.opcoes = padroes.opcoes();
            json.idioma_do_video = padroes.idioma().map(str::to_owned);
            json.gravar(&pasta)
                .map_err(|error| nao_criado(&pasta, error))?;
            self.remotion
                .montar_no_projeto(&pasta)
                .map_err(|error| nao_criado(&pasta, error))?;
            let resumo = ProjetoResumo {
                id: nome_do_arquivo(&pasta),
                titulo: json.titulo,
                pasta: pasta.display().to_string(),
                etapas: json.etapas,
                falha: None,
            };
            (self.emit)(Evento::ProjetoCriado {
                projeto: resumo.clone(),
            });
            self.fila.enfileirar(pasta);
            projetos.push(resumo);
        }
        Ok(())
    }

    fn pasta_dos_lotes(&self) -> PathBuf {
        self.biblioteca.join(".lotes")
    }

    /// Escolhe o id do lote, `AAAA-MM-DDTHH-MM-SS` (com `-2`, `-3`... se já existir), e
    /// o reserva em `.lotes/` com um nome automático.
    fn reservar_lote(&self, agora: OffsetDateTime) -> Result<String, Erro> {
        let dir = self.pasta_dos_lotes();
        std::fs::create_dir_all(&dir).map_err(|error| lote_nao_criado(&dir, &error))?;
        let base = format!(
            "{:04}-{:02}-{:02}T{:02}-{:02}-{:02}",
            agora.year(),
            u8::from(agora.month()),
            agora.day(),
            agora.hour(),
            agora.minute(),
            agora.second()
        );
        let mut id = base.clone();
        for numero in 2.. {
            if !dir.join(format!("{id}.json")).exists() {
                break;
            }
            id = format!("{base}-{numero}");
        }
        self.registrar_lote(&id, agora, &[])?;
        Ok(id)
    }

    /// Grava `.lotes/<lote>.json`: o nome automático e os projetos do lote.
    fn registrar_lote(
        &self,
        id: &str,
        agora: OffsetDateTime,
        projetos: &[ProjetoResumo],
    ) -> Result<(), Erro> {
        let arquivo = self.pasta_dos_lotes().join(format!("{id}.json"));
        let lote = serde_json::json!({
            "id": id,
            "nome": format!(
                "Lote {:04}-{:02}-{:02} {:02}:{:02}",
                agora.year(),
                u8::from(agora.month()),
                agora.day(),
                agora.hour(),
                agora.minute()
            ),
            "projetos": projetos.iter().map(|projeto| &projeto.id).collect::<Vec<_>>(),
        });
        files::write_json(&arquivo, &lote).map_err(|error| lote_nao_criado(&arquivo, &error))
    }

    /// Os reels e as reservas do projeto, para a Galeria.
    pub fn dados_do_projeto(&self, id: &str) -> Result<DadosDoProjeto, Erro> {
        let pasta = self.pasta_do_projeto(id)?;
        galeria::ler(&pasta).map_err(|detalhe| Erro::ProjetoNaoLido {
            id: id.to_owned(),
            detalhe,
        })
    }

    /// Abre a pasta, o roteiro, os logs ou um reel do projeto no programa padrão do sistema.
    pub fn abrir_no_sistema(&self, id: &str, alvo: AlvoParaAbrir) -> Result<(), Erro> {
        let caminho =
            galeria::caminho_para_abrir(&self.pasta_do_projeto(id)?, &alvo).map_err(|detalhe| {
                Erro::ProjetoNaoLido {
                    id: id.to_owned(),
                    detalhe,
                }
            })?;
        galeria::abrir_no_sistema(&self.abrir_com, &caminho).map_err(|error| Erro::NaoAbriu {
            caminho: caminho.display().to_string(),
            detalhe: error.to_string(),
        })
    }

    /// Põe na fila o render da versão final dos reels dos projetos `ids`: só render, sem
    /// sessão do Claude. Nada entra na fila se algum projeto não for lido.
    pub fn gerar_versao_final(&self, ids: &[String]) -> Result<(), Erro> {
        let pastas = ids
            .iter()
            .map(|id| {
                let pasta = self.pasta_do_projeto(id)?;
                ProjetoJson::ler(&pasta).map_err(|error| Erro::ProjetoNaoLido {
                    id: id.clone(),
                    detalhe: error.to_string(),
                })?;
                Ok((id, pasta))
            })
            .collect::<Result<Vec<_>, Erro>>()?;
        for (id, pasta) in pastas {
            (self.emit)(Evento::VersaoFinalMudou {
                projeto: id.clone(),
                estado: EstadoDaEtapa::Pendente,
                falha: None,
            });
            self.fila.enfileirar_versao_final(pasta);
        }
        Ok(())
    }

    /// A pasta do projeto `id`, que tem de ser uma pasta direta da Biblioteca.
    fn pasta_do_projeto(&self, id: &str) -> Result<PathBuf, Erro> {
        let simples = !id.is_empty() && !id.starts_with('.') && !id.contains(['/', '\\']);
        if !simples {
            return Err(Erro::ProjetoNaoLido {
                id: id.to_owned(),
                detalhe: "não é um projeto da Biblioteca".to_owned(),
            });
        }
        let pasta = self.biblioteca.join(id);
        if pasta.is_dir() {
            Ok(pasta)
        } else {
            Err(Erro::ProjetoNaoEncontrado { id: id.to_owned() })
        }
    }

    /// A duração, em segundos, pelo `ffprobe`; `None` sem ele ou sem resposta.
    fn duracao(&self, arquivo: &Path) -> Option<f64> {
        let ffprobe = find_program(
            "ffprobe",
            self.sidecar_dir.as_deref(),
            self.path_env.as_deref(),
        )?;
        let mut command = Command::new(ffprobe);
        command
            .args(["-v", "error", "-show_entries", "format=duration"])
            .args(["-of", "csv=p=0"])
            .arg(arquivo);
        hide_console(&mut command);
        let saida = command.output().ok()?;
        String::from_utf8_lossy(&saida.stdout).trim().parse().ok()
    }

    fn emit_line(&self, linha: String) {
        (self.emit)(Evento::SaidaDoComando { linha });
    }

    /// Pergunta algo curto ao Claude para confirmar que ele responde.
    pub fn testar_claude(&self) -> Result<(), Erro> {
        self.conta.testar()
    }

    fn preferences_file(&self) -> std::sync::MutexGuard<'_, PreferencesFile> {
        // Um pânico com a trava não deixa o arquivo pela metade (a gravação é atômica).
        self.preferencias
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// A Transcrição com os programas que vão com o app e os modelos dos dados do app. Um programa
/// que falta fica com o caminho em que devia estar, para o erro mostrar onde ele foi procurado;
/// sem o whisper-cli de CPU, não há reserva.
fn transcritor(sidecar_dir: &Path, path_env: Option<&OsStr>, app_data_dir: &Path) -> Transcritor {
    let program = |name: &str| {
        find_program(name, Some(sidecar_dir), path_env)
            .unwrap_or_else(|| sidecar_dir.join(format!("{name}{EXE_SUFFIX}")))
    };
    let models = app_data_dir.join(MODELS_DIR);
    let transcritor = Transcritor::new(
        program("ffmpeg"),
        program("whisper-cli"),
        models.join(transcricao::MODEL_FILE),
        models.join(transcricao::VAD_MODEL_FILE),
    );
    match find_program("whisper-cli-cpu", Some(sidecar_dir), path_env) {
        Some(whisper_cpu) => transcritor.with_cpu_fallback(whisper_cpu),
        None => transcritor,
    }
}

/// Um programa que vai com o app: o da pasta dos sidecars e, sem ele lá, o primeiro do `PATH`.
fn find_program(
    name: &str,
    sidecar_dir: Option<&Path>,
    path_env: Option<&OsStr>,
) -> Option<PathBuf> {
    let file = format!("{name}{EXE_SUFFIX}");
    sidecar_dir
        .into_iter()
        .map(Path::to_path_buf)
        .chain(path_env.into_iter().flat_map(std::env::split_paths))
        .map(|dir| dir.join(&file))
        .find(|candidate| candidate.is_file())
}

/// O arquivo existe e tem uma das extensões aceitas.
fn validar_arquivo(caminho: &str) -> Result<PathBuf, Erro> {
    let path = PathBuf::from(caminho);
    let aceita = path.extension().is_some_and(|extensao| {
        EXTENSOES
            .iter()
            .any(|aceita| extensao.eq_ignore_ascii_case(aceita))
    });
    if aceita && path.is_file() {
        Ok(path)
    } else {
        Err(Erro::ArquivoInvalido {
            caminho: caminho.to_owned(),
        })
    }
}

fn nome_do_arquivo(path: &Path) -> String {
    path.file_name()
        .map(|nome| nome.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn lote_nao_criado(caminho: &Path, error: &io::Error) -> Erro {
    Erro::ProjetoNaoCriado {
        caminho: caminho.display().to_string(),
        detalhe: error.to_string(),
    }
}
