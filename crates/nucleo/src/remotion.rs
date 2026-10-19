//! O Remotion do projeto (ADR 0003): as dependências do Node ficam numa cópia única nos dados
//! do app, e cada projeto tem o próprio `remotion/`, com `src/` e `public/` copiados do
//! template e o `node_modules` ligado por symlink (junction no Windows).

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::files::copy_dir;
use crate::preparacao::NodePortatil;

/// Os arquivos do template que cada projeto recebe, além de `src/` e `public/`.
const ARQUIVOS: [&str; 3] = ["package.json", "remotion.config.ts", "tsconfig.json"];
/// Os arquivos que definem as dependências instaladas.
const DEPENDENCIAS: [&str; 2] = ["package.json", "package-lock.json"];
/// Fixa a versão de tudo o que o `npm ci` instala. O `packages[""]` dele repete as dependências
/// do `package.json`, e o `npm ci` recusa os dois fora de sincronia.
const LOCKFILE: &str = "package-lock.json";
/// O `npm` grava este arquivo ao terminar de instalar, com o que ficou instalado de fato.
pub(crate) const MARCA_DA_INSTALACAO: &str = ".package-lock.json";
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

    /// O `npm` terminou de instalar as dependências, e são as do template: uma atualização do
    /// app que muda o `package-lock.json` pede outra instalação. Sem o template, não há com o
    /// que comparar.
    pub fn dependencias_prontas(&self) -> bool {
        self.marca_da_instalacao().is_file()
            && self.template().is_none_or(|template| {
                same_contents(&template.join(LOCKFILE), &self.base.join(LOCKFILE))
            })
    }

    /// O Chrome headless do Remotion já foi baixado.
    pub fn chrome_pronto(&self) -> bool {
        self.node_modules().join(PASTA_DO_CHROME).is_dir()
    }

    /// Garante, com o `node`, o Chrome headless que o Remotion usa para renderizar.
    pub fn garantir_chrome(&self, node: &Path) -> io::Result<()> {
        let mut comando = crate::process::comando(node);
        comando
            .arg(self.node_modules().join(CLI))
            .args(["browser", "ensure"])
            .current_dir(&self.base);
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

    /// Instala as dependências do template na pasta compartilhada, se ainda não forem as dele.
    /// O `npm ci` apaga o `node_modules` inteiro, com o Chrome headless junto.
    pub fn instalar_dependencias(&self) -> io::Result<()> {
        let Some(template) = self.template() else {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "os assets do app não foram encontrados",
            ));
        };
        if self.dependencias_prontas() {
            return Ok(());
        }
        // Sem a marca, um `npm ci` que falha antes de apagar o `node_modules` não deixa as
        // dependências de antes valendo pelas do template.
        match fs::remove_file(self.marca_da_instalacao()) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
            _ => {}
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
        let mut comando = crate::process::comando(npm);
        comando
            .args(["ci", "--no-audit", "--no-fund"])
            .current_dir(&self.base);
        if let Some(path) = self.node_portatil.path_com_node(self.path_env.clone()) {
            comando.env("PATH", path);
        }
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

    fn marca_da_instalacao(&self) -> PathBuf {
        self.node_modules().join(MARCA_DA_INSTALACAO)
    }
}

fn same_contents(a: &Path, b: &Path) -> bool {
    matches!((fs::read(a), fs::read(b)), (Ok(a), Ok(b)) if a == b)
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
