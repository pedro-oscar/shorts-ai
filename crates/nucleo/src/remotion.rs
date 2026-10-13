//! O Remotion do projeto (ADR 0003): as dependências do Node ficam numa cópia única nos dados
//! do app, e cada projeto tem o próprio `remotion/`, com `src/` e `public/` copiados do
//! template e o `node_modules` ligado por symlink (junction no Windows).

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::files::copy_dir;
use crate::preparacao::NodePortatil;
use crate::process::hide_console;

/// Os arquivos do template que cada projeto recebe, além de `src/` e `public/`.
const ARQUIVOS: [&str; 3] = ["package.json", "remotion.config.ts", "tsconfig.json"];
/// Os arquivos que definem as dependências instaladas.
const DEPENDENCIAS: [&str; 2] = ["package.json", "package-lock.json"];
/// O `npm` grava este arquivo ao terminar de instalar.
const MARCA_DA_INSTALACAO: &str = ".package-lock.json";
/// Onde o Remotion guarda o Chrome headless que baixa.
const PASTA_DO_CHROME: &str = ".remotion";
/// O programa do Remotion, que o `npm` liga como `remotion` em `.bin`.
const CLI: &str = "@remotion/cli/remotion-cli.js";

pub(crate) struct Remotion {
    /// A pasta dos assets do app (`remotion/` é o template); `None` sem eles.
    assets: Option<PathBuf>,
    /// Nos dados do app: `package.json`, `package-lock.json` e o `node_modules` compartilhado.
    base: PathBuf,
    /// O `npm` configurado; sem ele vale o do Node portátil e, sem este, o do `PATH`.
    npm: Option<PathBuf>,
    node_portatil: NodePortatil,
    path_env: Option<OsString>,
}

impl Remotion {
    pub fn new(
        assets: Option<PathBuf>,
        app_data_dir: &Path,
        npm: Option<PathBuf>,
        node_portatil: NodePortatil,
        path_env: Option<OsString>,
    ) -> Self {
        Self {
            assets,
            base: app_data_dir.join("remotion"),
            npm,
            node_portatil,
            path_env,
        }
    }

    /// As dependências e o Chrome headless estão onde o render os espera.
    pub fn pronto(&self) -> bool {
        self.dependencias_prontas() && self.chrome_pronto()
    }

    /// O `npm` terminou de instalar as dependências.
    pub fn dependencias_prontas(&self) -> bool {
        self.node_modules().join(MARCA_DA_INSTALACAO).is_file()
    }

    /// O Chrome headless do Remotion já foi baixado.
    pub fn chrome_pronto(&self) -> bool {
        self.node_modules().join(PASTA_DO_CHROME).is_dir()
    }

    /// Garante, com o `node`, o Chrome headless que o Remotion usa para renderizar.
    pub fn garantir_chrome(&self, node: &Path) -> io::Result<()> {
        let mut comando = Command::new(node);
        comando
            .arg(self.node_modules().join(CLI))
            .args(["browser", "ensure"])
            .current_dir(&self.base);
        hide_console(&mut comando);
        let saida = comando.output()?;
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
        let npm = self
            .npm
            .clone()
            .or_else(|| self.node_portatil.npm())
            .unwrap_or_else(|| PathBuf::from("npm"));
        let mut comando = Command::new(npm);
        comando
            .args(["ci", "--no-audit", "--no-fund"])
            .current_dir(&self.base);
        if let Some(path) = self.node_portatil.path_com_node(self.path_env.clone()) {
            comando.env("PATH", path);
        }
        hide_console(&mut comando);
        let saida = comando.output()?;
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

/// Symlink no Linux e no macOS.
#[cfg(unix)]
fn link_dir(source: &Path, destination: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(source, destination)
}

/// Junction no Windows: o symlink de pasta exige administrador ou o modo de desenvolvedor.
#[cfg(windows)]
fn link_dir(source: &Path, destination: &Path) -> io::Result<()> {
    junction::create(source, destination)
}
