//! Utilidades de arquivo do núcleo.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;

use serde::Serialize;

/// Grava num arquivo temporário e troca pelo definitivo: um app fechado no meio da gravação
/// deixa o arquivo antigo inteiro, nunca um pela metade.
pub(crate) fn write_json(path: &Path, value: &impl Serialize) -> io::Result<()> {
    let temporary = path.with_extension("json.tmp");
    let mut file = File::create(&temporary)?;
    serde_json::to_writer_pretty(&mut file, value)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    fs::rename(&temporary, path)
}

/// Copia a pasta com tudo o que há dentro, criando o destino.
pub(crate) fn copy_dir(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// O tamanho, em bytes, dos arquivos da pasta, sem seguir links simbólicos nem junctions; a
/// subpasta `sem` do primeiro nível não entra.
pub(crate) fn tamanho_da_pasta(pasta: &Path, sem: Option<&str>) -> u64 {
    let Ok(entradas) = fs::read_dir(pasta) else {
        return 0;
    };
    entradas
        .filter_map(Result::ok)
        .filter(|entrada| sem.is_none_or(|sem| entrada.file_name() != sem))
        .filter_map(|entrada| {
            let tipo = entrada.file_type().ok()?;
            if tipo.is_symlink() {
                None
            } else if tipo.is_dir() {
                Some(tamanho_da_pasta(&entrada.path(), None))
            } else {
                entrada.metadata().ok().map(|metadados| metadados.len())
            }
        })
        .sum()
}
