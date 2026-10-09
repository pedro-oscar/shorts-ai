//! Núcleo do Shorts AI: o domínio e as regras do app, sem depender do Tauri.
//!
//! A casca Tauri chama os métodos de [`Nucleo`] como comandos e repassa os [`Evento`]s à
//! interface. O núcleo fala por códigos e parâmetros, nunca por frases prontas: quem
//! escreve os textos, em pt-BR ou em inglês, é a interface.

mod conta;
mod preferencias;

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use specta::Type;
use time::OffsetDateTime;

use crate::conta::Conta;
pub use crate::conta::{Cobranca, EstadoDaConta, ModoDeLogin, VERSAO_MINIMA_DO_CLAUDE_CODE};
use crate::preferencias::{PreferencesFile, Preferencias};

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
}

pub struct Nucleo {
    idioma_da_interface: IdiomaDaInterface,
    chave_de_api_no_ambiente: bool,
    preferencias: Mutex<PreferencesFile>,
    conta: Conta,
    emit: Box<dyn Fn(Evento) + Send + Sync>,
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
}

impl Nucleo {
    pub fn new(config: Config, emit: impl Fn(Evento) + Send + Sync + 'static) -> Self {
        Self {
            idioma_da_interface: IdiomaDaInterface::of_locale(config.system_locale.as_deref()),
            chave_de_api_no_ambiente: config.chave_de_api_no_ambiente,
            preferencias: Mutex::new(PreferencesFile::in_dir(&config.app_data_dir)),
            conta: Conta::new(
                config.path_env,
                config.home_dir,
                config.app_data_dir.join("claude"),
            ),
            emit: Box::new(emit),
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
