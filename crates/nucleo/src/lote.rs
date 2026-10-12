//! O lote em disco: `.lotes/<id>.json` na Biblioteca, com o nome, os padrões e a ordem dos
//! projetos (ADR 0007).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;
use time::OffsetDateTime;

use crate::ProjetoResumo;
use crate::files::write_json;
use crate::padroes::Padroes;
use crate::projeto::{Parada, ProjetoJson};
use crate::{EstadoDaEtapa, nome_do_arquivo};

const PASTA: &str = ".lotes";

/// O conteúdo de `.lotes/<id>.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoteJson {
    pub id: String,
    pub nome: String,
    #[serde(with = "time::serde::rfc3339")]
    pub criado_em: OffsetDateTime,
    pub padroes: Padroes,
    /// Os ids dos projetos, na ordem da fila.
    pub projetos: Vec<String>,
}

impl LoteJson {
    pub fn novo(id: String, agora: OffsetDateTime, padroes: Padroes) -> Self {
        Self {
            id,
            nome: format!(
                "Lote de {:02}/{:02} {:02}:{:02}",
                agora.day(),
                u8::from(agora.month()),
                agora.hour(),
                agora.minute()
            ),
            criado_em: agora,
            padroes,
            projetos: Vec::new(),
        }
    }

    pub fn ler(biblioteca: &Path, id: &str) -> io::Result<Self> {
        Ok(serde_json::from_slice(&fs::read(arquivo(biblioteca, id))?)?)
    }

    pub fn gravar(&self, biblioteca: &Path) -> io::Result<()> {
        write_json(&arquivo(biblioteca, &self.id), self)
    }

    /// Os lotes da Biblioteca, do mais novo para o mais antigo. O que não se lê fica de fora.
    pub fn listar(biblioteca: &Path) -> Vec<Self> {
        let Ok(entradas) = fs::read_dir(pasta(biblioteca)) else {
            return Vec::new();
        };
        let mut lotes: Vec<Self> = entradas
            .filter_map(Result::ok)
            .filter_map(|entrada| fs::read(entrada.path()).ok())
            .filter_map(|bytes| serde_json::from_slice(&bytes).ok())
            .collect();
        // O id começa pela data e hora, então a ordem do texto é a do tempo.
        lotes.sort_by(|a, b| b.id.cmp(&a.id));
        lotes
    }
}

pub(crate) fn pasta(biblioteca: &Path) -> PathBuf {
    biblioteca.join(PASTA)
}

fn arquivo(biblioteca: &Path, id: &str) -> PathBuf {
    pasta(biblioteca).join(format!("{id}.json"))
}

/// Um lote como a interface o mostra no histórico.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LoteResumo {
    pub id: String,
    pub nome: String,
    /// O dia e a hora da criação, em RFC 3339.
    pub criado_em: String,
    pub padroes: Padroes,
    /// Os projetos na ordem da fila.
    pub projetos: Vec<ProjetoResumo>,
    /// Os projetos do lote cuja pasta sumiu da Biblioteca.
    pub ausentes: Vec<String>,
    /// Tem projeto que ainda não terminou nem falhou. Só o lote mais novo fica aberto.
    pub aberto: bool,
}

/// O projeto do disco, como a interface o mostra na fila.
pub(crate) fn resumir(pasta: &Path, json: ProjetoJson) -> ProjetoResumo {
    ProjetoResumo {
        id: nome_do_arquivo(pasta),
        titulo: json.titulo,
        pasta: pasta.display().to_string(),
        lote: json.lote,
        etapas: json.etapas,
        falha: json.falha,
        parada: json.parada,
        video_ausente: json.origem.ausente(pasta),
        excecoes: json.excecoes,
    }
}

/// Os lotes da Biblioteca com os projetos lidos do disco; o projeto cuja pasta sumiu vai em
/// `ausentes`.
pub(crate) fn resumos(biblioteca: &Path) -> Vec<LoteResumo> {
    LoteJson::listar(biblioteca)
        .into_iter()
        .enumerate()
        .map(|(posicao, lote)| {
            let projetos: Vec<ProjetoResumo> = lote
                .projetos
                .iter()
                .filter_map(|id| {
                    let pasta = biblioteca.join(id);
                    ProjetoJson::ler(&pasta)
                        .ok()
                        .map(|json| resumir(&pasta, json))
                })
                .collect();
            let ausentes = lote
                .projetos
                .iter()
                .filter(|id| !biblioteca.join(id).is_dir())
                .cloned()
                .collect();
            let aberto = posicao == 0 && projetos.iter().any(nao_terminou);
            LoteResumo {
                id: lote.id,
                nome: lote.nome,
                criado_em: lote
                    .criado_em
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
                padroes: lote.padroes,
                projetos,
                ausentes,
                aberto,
            }
        })
        .collect()
}

/// Reabrir o app deixa Pausado todo projeto que não terminou, não falhou e não está parado;
/// quem aguarda a cota também fica Pausado. A fila não sobrevive ao app, então nada retoma
/// sozinho. A etapa que estava em andamento é descartada. Quem não se lê ou não se grava fica
/// como está.
pub(crate) fn pausar_interrompidos(biblioteca: &Path) {
    for lote in LoteJson::listar(biblioteca) {
        for id in &lote.projetos {
            let pasta = biblioteca.join(id);
            let Ok(mut projeto) = ProjetoJson::ler(&pasta) else {
                continue;
            };
            let falhou = projeto
                .etapas
                .iter()
                .any(|item| item.estado == EstadoDaEtapa::Falhou);
            let pronto = projeto
                .etapas
                .iter()
                .all(|item| item.estado == EstadoDaEtapa::Concluida);
            let aguardando_cota = projeto.parada == Some(Parada::AguardandoCota);
            if falhou || pronto || (projeto.parada.is_some() && !aguardando_cota) {
                continue;
            }
            for item in &mut projeto.etapas {
                if item.estado == EstadoDaEtapa::EmAndamento {
                    item.estado = EstadoDaEtapa::Pendente;
                }
            }
            projeto.parada = Some(Parada::Pausado);
            let _ = projeto.gravar(&pasta);
        }
    }
}

/// O nome do lote quando nenhum projeto dele ainda vai andar: todos estão prontos, falharam ou
/// foram cancelados. `None` com projeto na fila, rodando, pausado ou aguardando a cota, ou se o
/// lote não se lê.
pub(crate) fn nome_se_terminou(biblioteca: &Path, id: &str) -> Option<String> {
    let lote = LoteJson::ler(biblioteca, id).ok()?;
    let terminou = lote.projetos.iter().all(|projeto| {
        ProjetoJson::ler(&biblioteca.join(projeto)).is_ok_and(|json| {
            json.parada == Some(Parada::Cancelado)
                || json
                    .etapas
                    .iter()
                    .any(|item| item.estado == EstadoDaEtapa::Falhou)
                || json
                    .etapas
                    .iter()
                    .all(|item| item.estado == EstadoDaEtapa::Concluida)
        })
    });
    terminou.then_some(lote.nome)
}

/// O projeto ainda vai andar: nenhuma etapa falhou e nem todas terminaram.
fn nao_terminou(projeto: &ProjetoResumo) -> bool {
    let falhou = projeto
        .etapas
        .iter()
        .any(|item| item.estado == EstadoDaEtapa::Falhou);
    let pronto = projeto
        .etapas
        .iter()
        .all(|item| item.estado == EstadoDaEtapa::Concluida);
    !falhou && !pronto
}
