//! O tempo de cada etapa e de cada passo dentro dela, uma linha por medição em
//! `edit/tempos.jsonl`: o que serve para comparar o lote antes e depois de uma mudança e,
//! mais tarde, calibrar a estimativa.

use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::Path;
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use time::OffsetDateTime;

use crate::Etapa;

/// O arquivo das medições, em `edit/`.
pub(crate) const TEMPOS: &str = "tempos.jsonl";

/// Uma linha de cada vez: duas threads (dois projetos, ou o preparo e o render do mesmo)
/// gravando juntas poderiam intercalar os bytes de duas linhas.
static GRAVANDO: Mutex<()> = Mutex::new(());

/// O que se mede: o passo, a etapa em que ele roda (quando quem mede sabe) e o reel.
#[derive(Clone, Copy)]
pub(crate) struct Passo<'a> {
    pub etapa: Option<Etapa>,
    pub nome: &'static str,
    pub reel: Option<&'a str>,
}

impl Passo<'_> {
    /// Um passo de uma etapa, fora de um reel.
    pub(crate) fn da_etapa(etapa: Etapa, nome: &'static str) -> Passo<'static> {
        Passo {
            etapa: Some(etapa),
            nome,
            reel: None,
        }
    }
}

impl<'a> Passo<'a> {
    /// Um passo de um reel, que roda na Produção, na Revisão ou na Versão final.
    pub(crate) fn do_reel(nome: &'static str, reel: &'a str) -> Self {
        Passo {
            etapa: None,
            nome,
            reel: Some(reel),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Linha<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    etapa: Option<Etapa>,
    passo: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reel: Option<&'a str>,
    #[serde(with = "time::serde::rfc3339")]
    inicio: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    fim: OffsetDateTime,
}

/// Roda o `trabalho` e acrescenta a `<edit>/tempos.jsonl` quanto ele levou, tenha dado certo
/// ou não. Sem gravar, a medição se perde e o trabalho segue.
pub(crate) fn medir<T>(edit: &Path, passo: Passo<'_>, trabalho: impl FnOnce() -> T) -> T {
    let inicio = OffsetDateTime::now_utc();
    let resultado = trabalho();
    let _ = gravar(edit, passo, inicio, OffsetDateTime::now_utc());
    resultado
}

fn gravar(
    edit: &Path,
    passo: Passo<'_>,
    inicio: OffsetDateTime,
    fim: OffsetDateTime,
) -> io::Result<()> {
    let mut linha = serde_json::to_vec(&Linha {
        etapa: passo.etapa,
        passo: passo.nome,
        reel: passo.reel,
        inicio,
        fim,
    })?;
    linha.push(b'\n');
    let _gravando = GRAVANDO.lock().unwrap_or_else(PoisonError::into_inner);
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(edit.join(TEMPOS))?
        .write_all(&linha)
}
