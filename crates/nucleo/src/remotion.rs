//! O Remotion do projeto (ADR 0003): as dependências do Node ficam numa cópia única nos dados
//! do app, e cada projeto tem o próprio `remotion/`, com `src/` e `public/` copiados do
//! template e o `node_modules` ligado por symlink.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::files::copy_dir;

/// Os arquivos do template que cada projeto recebe, além de `src/` e `public/`.
const ARQUIVOS: [&str; 3] = ["package.json", "remotion.config.ts", "tsconfig.json"];
/// Os arquivos que definem as dependências instaladas.
const DEPENDENCIAS: [&str; 2] = ["package.json", "package-lock.json"];
/// O `npm` grava este arquivo ao terminar de instalar.
const MARCA_DA_INSTALACAO: &str = ".package-lock.json";

pub(crate) struct Remotion {
    /// A pasta dos assets do app (`remotion/` é o template); `None` sem eles.
    assets: Option<PathBuf>,
    /// Nos dados do app: `package.json`, `package-lock.json` e o `node_modules` compartilhado.
    base: PathBuf,
    npm: PathBuf,
}

impl Remotion {
    pub fn new(assets: Option<PathBuf>, app_data_dir: &Path, npm: Option<PathBuf>) -> Self {
        Self {
            assets,
            base: app_data_dir.join("remotion"),
            npm: npm.unwrap_or_else(|| PathBuf::from("npm")),
        }
    }

    /// Instala as dependências do template na pasta compartilhada, se ainda não estiverem lá.
    pub fn instalar_dependencias(&self) -> io::Result<()> {
        let Some(template) = self.template() else {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "os assets do app não foram encontrados",
            ));
        };
        if self.node_modules().join(MARCA_DA_INSTALACAO).is_file() {
            return Ok(());
        }
        fs::create_dir_all(&self.base)?;
        for nome in DEPENDENCIAS {
            fs::copy(template.join(nome), self.base.join(nome))?;
        }
        let saida = Command::new(&self.npm)
            .args(["ci", "--no-audit", "--no-fund"])
            .current_dir(&self.base)
            .output()?;
        if saida.status.success() {
            Ok(())
        } else {
            let erro = String::from_utf8_lossy(&saida.stderr);
            Err(io::Error::other(format!(
                "{}: {}",
                saida.status,
                erro.trim()
            )))
        }
    }

    /// Monta o `remotion/` do projeto. Sem assets, não há o que montar.
    pub fn montar_no_projeto(&self, pasta: &Path) -> io::Result<()> {
        let Some(template) = self.template() else {
            return Ok(());
        };
        let destino = pasta.join("remotion");
        for subpasta in ["src", "public"] {
            copy_dir(&template.join(subpasta), &destino.join(subpasta))?;
        }
        for nome in ARQUIVOS {
            fs::copy(template.join(nome), destino.join(nome))?;
        }
        link_dir(&self.node_modules(), &destino.join("node_modules"))
    }

    fn template(&self) -> Option<PathBuf> {
        self.assets.as_ref().map(|assets| assets.join("remotion"))
    }

    fn node_modules(&self) -> PathBuf {
        self.base.join("node_modules")
    }
}

/// Symlink no Linux e no macOS. A junction do Windows, que não exige administrador, fica
/// para o ticket 19.
#[cfg(unix)]
fn link_dir(source: &Path, destination: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(source, destination)
}

#[cfg(not(unix))]
fn link_dir(_source: &Path, _destination: &Path) -> io::Result<()> {
    Ok(())
}
