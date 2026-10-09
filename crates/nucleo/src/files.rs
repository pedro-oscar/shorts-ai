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
