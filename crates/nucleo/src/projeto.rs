//! O projeto em disco: a pasta na Biblioteca e o `projeto.json` dela (ADR 0007).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;
use time::{Date, OffsetDateTime};

use crate::files::write_json;
use crate::padroes::{Excecoes, Padroes};
use crate::{EstadoDaEtapa, Etapa};

const FILE_NAME: &str = "projeto.json";
/// Quantos caracteres do título entram no nome da pasta.
const TITULO_MAXIMO: usize = 40;

/// A etapa e o estado dela, na ordem em que o projeto passa por elas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EtapaDoProjeto {
    pub etapa: Etapa,
    pub estado: EstadoDaEtapa,
}

/// Por que um projeto que não terminou nem falhou não está na fila.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Parada {
    /// Parou ao fim de uma etapa, a pedido, ou o app foi fechado com o projeto interrompido.
    Pausado,
    /// Teve o processo morto na hora; a etapa em curso foi descartada.
    Cancelado,
    /// A cota do plano acabou no meio de uma sessão do Claude; a fila retoma quando ela libera.
    AguardandoCota,
}

/// Como a Importação trouxe o arquivo para o projeto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ModoDeImportacao {
    /// O vídeo original está no mesmo volume: o projeto tem um hardlink dele em `bruto/`.
    Hardlink,
    /// Outro volume, ou um sistema de arquivos sem hardlink (exFAT, FAT): só o caminho,
    /// com o tamanho e a data do arquivo.
    Referencia,
}

/// De onde veio o vídeo original.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "tipo",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Origem {
    Arquivo {
        caminho: String,
        nome: String,
        tamanho: u64,
        #[serde(default, with = "time::serde::rfc3339::option")]
        modificado_em: Option<OffsetDateTime>,
        /// `None` até a Importação rodar.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        modo: Option<ModoDeImportacao>,
    },
    /// Um vídeo do YouTube; a Importação o baixa para `bruto/`. O título é o do projeto.
    Youtube {
        url: String,
        canal: String,
        /// Quando a pessoa confirmou "Tenho direito de uso deste vídeo".
        #[serde(with = "time::serde::rfc3339")]
        direito_de_uso_em: OffsetDateTime,
        /// O arquivo em `bruto/`, que existe depois da Importação.
        nome: String,
    },
}

impl Origem {
    /// O nome do vídeo original: o do arquivo local ou o do que foi baixado.
    pub fn nome(&self) -> &str {
        match self {
            Self::Arquivo { nome, .. } | Self::Youtube { nome, .. } => nome,
        }
    }

    /// O vídeo original do projeto em `pasta`: o hardlink em `bruto/`, o caminho de origem
    /// quando o arquivo local só tem a referência, ou o vídeo baixado.
    pub fn video(&self, pasta: &Path) -> PathBuf {
        match self {
            Self::Arquivo {
                modo: Some(ModoDeImportacao::Hardlink),
                nome,
                ..
            }
            | Self::Youtube { nome, .. } => pasta.join("bruto").join(nome),
            Self::Arquivo { caminho, .. } => PathBuf::from(caminho),
        }
    }

    /// O arquivo local de que o projeto ainda precisa não está mais lá. O vídeo baixado de um
    /// link não se localiza.
    pub fn ausente(&self, pasta: &Path) -> bool {
        matches!(self, Self::Arquivo { .. }) && !self.video(pasta).is_file()
    }
}

/// A parte do vídeo original, em segundos inteiros, a que a análise se limita.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Faixa {
    pub inicio: u32,
    /// `None` vai até o fim do vídeo.
    pub fim: Option<u32>,
}

impl Faixa {
    /// A faixa que pede o vídeo inteiro vira `None`; o fim tem de vir depois do início.
    pub(crate) fn validar(faixa: Option<Self>) -> Result<Option<Self>, String> {
        match faixa {
            Some(Self {
                inicio,
                fim: Some(fim),
            }) if fim <= inicio => Err("o fim tem de vir depois do início".to_owned()),
            Some(Self {
                inicio: 0,
                fim: None,
            })
            | None => Ok(None),
            faixa => Ok(faixa),
        }
    }

    /// `-ss`/`-t` do ffmpeg, em segundos, para extrair só a faixa.
    pub(crate) fn duracao(self) -> Option<u32> {
        self.fim.map(|fim| fim - self.inicio)
    }
}

/// As opções efetivas do projeto: os padrões do lote, até haver exceções.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Opcoes {
    pub quantidade_de_reels: u8,
    pub previa: bool,
    pub pedido: String,
    pub revisoes: u8,
    pub modelo: String,
    pub nomes_proprios: Vec<String>,
    /// A faixa do vídeo original a que a análise se limita; `None` usa o vídeo inteiro.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub faixa: Option<Faixa>,
}

impl Default for Opcoes {
    fn default() -> Self {
        Self {
            quantidade_de_reels: 6,
            previa: true,
            pedido: String::new(),
            revisoes: 1,
            modelo: "padrao".to_owned(),
            nomes_proprios: Vec::new(),
            faixa: None,
        }
    }
}

/// O conteúdo do `projeto.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjetoJson {
    pub versao: u32,
    pub titulo: String,
    pub lote: String,
    #[serde(with = "time::serde::rfc3339")]
    pub criado_em: OffsetDateTime,
    pub origem: Origem,
    /// `None` (pendente) até a Transcrição detectar o idioma.
    pub idioma_do_video: Option<String>,
    pub opcoes: Opcoes,
    /// O que o projeto define por conta própria; `opcoes` são os padrões do lote com isto.
    #[serde(default)]
    pub excecoes: Excecoes,
    pub etapas: Vec<EtapaDoProjeto>,
    /// Por que a etapa que falhou falhou.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub falha: Option<String>,
    /// `None` enquanto o projeto está na fila, rodando, pronto ou falhou.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parada: Option<Parada>,
}

impl ProjetoJson {
    pub fn novo(titulo: String, lote: String, origem: Origem, agora: OffsetDateTime) -> Self {
        Self {
            versao: 1,
            titulo,
            lote,
            criado_em: agora,
            origem,
            idioma_do_video: None,
            opcoes: Opcoes::default(),
            excecoes: Excecoes::default(),
            etapas: Etapa::TODAS
                .iter()
                .map(|&etapa| EtapaDoProjeto {
                    etapa,
                    estado: EstadoDaEtapa::Pendente,
                })
                .collect(),
            falha: None,
            parada: None,
        }
    }

    pub fn ler(pasta: &Path) -> io::Result<Self> {
        Ok(serde_json::from_slice(&fs::read(pasta.join(FILE_NAME))?)?)
    }

    pub fn gravar(&self, pasta: &Path) -> io::Result<()> {
        write_json(&pasta.join(FILE_NAME), self)
    }

    /// Recalcula as opções efetivas e o idioma a partir dos padrões do lote e das exceções.
    /// Num projeto de link, o título e o canal são nomes próprios que a Transcrição deve acertar.
    pub fn aplicar(&mut self, padroes: &Padroes) {
        self.opcoes = padroes.opcoes(&self.excecoes);
        self.idioma_do_video = padroes.idioma(&self.excecoes).map(str::to_owned);
        if let Origem::Youtube { canal, .. } = &self.origem {
            for nome in [&self.titulo, canal] {
                let nome = nome.trim();
                if !nome.is_empty() && !self.opcoes.nomes_proprios.iter().any(|n| n == nome) {
                    self.opcoes.nomes_proprios.push(nome.to_owned());
                }
            }
        }
    }

    pub fn marcar(&mut self, etapa: Etapa, estado: EstadoDaEtapa) {
        if let Some(item) = self.etapas.iter_mut().find(|item| item.etapa == etapa) {
            item.estado = estado;
        }
    }
}

/// Cria a pasta nova do projeto, `<título até 40 caracteres> (AAAA-MM-DD)`, com ` (2)`, ` (3)`
/// e assim por diante se já existir, e dentro dela `bruto/`, `edit/` e `publicar/`.
pub(crate) fn criar_pasta(biblioteca: &Path, titulo: &str, data: Date) -> io::Result<PathBuf> {
    fs::create_dir_all(biblioteca)?;
    let base = format!(
        "{} ({:04}-{:02}-{:02})",
        titulo_para_pasta(titulo),
        data.year(),
        u8::from(data.month()),
        data.day()
    );
    for numero in 1u32.. {
        let nome = if numero == 1 {
            base.clone()
        } else {
            format!("{base} ({numero})")
        };
        let pasta = biblioteca.join(nome);
        match fs::create_dir(&pasta) {
            Ok(()) => {
                for subpasta in ["bruto", "edit", "publicar"] {
                    fs::create_dir(pasta.join(subpasta))?;
                }
                return Ok(pasta);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    unreachable!("o laço só termina com return")
}

/// O título sem o que o Windows não aceita em nome de pasta, cortado em 40 caracteres.
fn titulo_para_pasta(titulo: &str) -> String {
    let limpo: String = titulo
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c))
        .take(TITULO_MAXIMO)
        .collect();
    let limpo = limpo.trim_matches(|c: char| c.is_whitespace() || c == '.');
    if limpo.is_empty() {
        "Vídeo".to_owned()
    } else {
        limpo.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn projeto() -> ProjetoJson {
        ProjetoJson::novo(
            "Aula".to_owned(),
            "lote".to_owned(),
            Origem::Arquivo {
                caminho: "/v/aula.mp4".to_owned(),
                nome: "aula.mp4".to_owned(),
                tamanho: 10,
                modificado_em: None,
                modo: None,
            },
            OffsetDateTime::UNIX_EPOCH,
        )
    }

    #[test]
    fn gravacao_interrompida_deixa_o_projeto_json_antigo_inteiro() {
        let pasta = tempfile::tempdir().unwrap();
        let antigo = projeto();
        antigo.gravar(pasta.path()).unwrap();

        // Interrompida depois de escrever metade do temporário, antes de trocar.
        fs::write(
            pasta.path().join("projeto.json.tmp"),
            "{\"versao\": 1, \"tit",
        )
        .unwrap();
        assert_eq!(ProjetoJson::ler(pasta.path()).unwrap(), antigo);

        // A gravação seguinte passa por cima do resto da interrompida.
        let mut novo = antigo;
        novo.marcar(Etapa::Importacao, EstadoDaEtapa::Concluida);
        novo.gravar(pasta.path()).unwrap();
        assert_eq!(ProjetoJson::ler(pasta.path()).unwrap(), novo);
    }

    #[test]
    fn gravacao_que_falha_no_meio_nao_toca_no_projeto_json() {
        let pasta = tempfile::tempdir().unwrap();
        let antigo = projeto();
        antigo.gravar(pasta.path()).unwrap();

        // Com o temporário impedido, a gravação falha antes da troca.
        fs::create_dir(pasta.path().join("projeto.json.tmp")).unwrap();
        let mut novo = antigo.clone();
        novo.marcar(Etapa::Importacao, EstadoDaEtapa::Falhou);
        assert!(novo.gravar(pasta.path()).is_err());

        assert_eq!(ProjetoJson::ler(pasta.path()).unwrap(), antigo);
    }

    #[test]
    fn gravacoes_ao_mesmo_tempo_nunca_deixam_o_projeto_json_pela_metade() {
        let pasta = tempfile::tempdir().unwrap();
        projeto().gravar(pasta.path()).unwrap();

        // A fila e um comando da interface gravando o mesmo projeto, com tamanhos diferentes.
        std::thread::scope(|scope| {
            for tamanho in [1, 5_000, 20_000] {
                let pasta = pasta.path();
                scope.spawn(move || {
                    let mut json = projeto();
                    json.titulo = "a".repeat(tamanho);
                    for _ in 0..200 {
                        json.gravar(pasta).unwrap();
                    }
                });
            }
            for _ in 0..2_000 {
                if let Err(erro) = ProjetoJson::ler(pasta.path()) {
                    panic!("projeto.json ilegível: {erro}");
                }
            }
        });
    }

    #[test]
    fn titulo_da_pasta_sem_caracteres_proibidos_e_ate_40_caracteres() {
        assert_eq!(titulo_para_pasta("a/b:c?"), "abc");
        assert_eq!(titulo_para_pasta(&"é".repeat(60)), "é".repeat(40));
        assert_eq!(titulo_para_pasta("  .. "), "Vídeo");
    }
}
