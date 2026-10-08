//! Núcleo do Shorts AI: o domínio e as regras do app, sem depender do Tauri.
//!
//! A casca Tauri chama os métodos de [`Nucleo`] como comandos e repassa os [`Evento`]s à
//! interface. O núcleo fala por códigos e parâmetros, nunca por frases prontas: quem
//! escreve os textos, em pt-BR ou em inglês, é a interface.

mod preferencias;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use specta::Type;
use time::OffsetDateTime;

use crate::preferencias::{PreferencesFile, Preferencias};

/// O que o núcleo recebe da casca: onde ficam os dados do app e o idioma do sistema.
pub struct Config {
    pub app_data_dir: PathBuf,
    /// O idioma do sistema, como `pt-BR` ou `pt_BR.UTF-8`; `None` se não for possível lê-lo.
    pub system_locale: Option<String>,
}

pub struct Nucleo {
    idioma_da_interface: IdiomaDaInterface,
    preferencias: Mutex<PreferencesFile>,
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

/// O que muda no núcleo e a interface acompanha.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(
    tag = "tipo",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Evento {
    AvisoAceito { aceite: Aceite },
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
}

impl Nucleo {
    pub fn new(config: Config, emit: impl Fn(Evento) + Send + Sync + 'static) -> Self {
        Self {
            idioma_da_interface: IdiomaDaInterface::of_locale(config.system_locale.as_deref()),
            preferencias: Mutex::new(PreferencesFile::in_dir(&config.app_data_dir)),
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

    fn preferences_file(&self) -> std::sync::MutexGuard<'_, PreferencesFile> {
        // Um pânico com a trava não deixa o arquivo pela metade (a gravação é atômica).
        self.preferencias
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}
