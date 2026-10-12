//! A Produção: para cada corte do roteiro, o corte horizontal, o rosto, os dados do reel e o
//! render no Remotion do projeto (ADR 0003, ADR 0005). O projeto é empacotado uma vez e cada
//! corte é renderizado desse pacote. Cada passo guarda o hash do que o gerou: refazer só
//! recalcula o que mudou.

use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::json;
use sha2::{Digest, Sha256};

use crate::corte::{ErroDoCorte, Ffmpeg, Trecho};
use crate::process::{self, Interrupted, Stream};
use crate::revisao;
use crate::rosto::Pin;
use crate::roteiro::{Plano, ROTEIRO, validar_na_pasta};

/// O script que empacota e renderiza; o núcleo o grava em `remotion/` antes de chamá-lo.
const SCRIPT: &str = include_str!("../../../assets/remotion/render.mjs");
const NOME_DO_SCRIPT: &str = "render.mjs";
/// Onde fica o pacote do projeto, em `remotion/`, e o hash do código que o gerou.
const PACOTE: &str = ".pacote";
const HASH_DO_PACOTE: &str = ".pacote.hash";
/// O que, além de `src/` e de `public/` (sem `clips/`), é código do Remotion do projeto.
const ARQUIVOS_DE_CODIGO: [&str; 3] = ["package.json", "remotion.config.ts", "tsconfig.json"];
/// Os reels prontos e as prévias.
pub(crate) const PUBLICAR: &str = "publicar";
pub(crate) const PREVIAS: &str = "prévias";
/// Os intermediários de cada corte (`edit/cortes/<chave>/`).
const CORTES: &str = "edit/cortes";
const FOLHA: &str = "revisao.png";
const RESUMO: &str = "edit/producao.json";
const FPS: u32 = 30;
const TITULO_MAXIMO: usize = 50;
/// Que parte do progresso de cada reel é o corte, o rosto e o render.
const FIM_DO_CORTE: f64 = 0.25;
const FIM_DO_ROSTO: f64 = 0.35;

/// A versão final (1080×1920) ou a prévia, em meia escala.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Qualidade {
    Final,
    Previa,
}

impl Qualidade {
    fn nome(self) -> &'static str {
        match self {
            Self::Final => "final",
            Self::Previa => "previa",
        }
    }

    fn escala(self) -> &'static str {
        match self {
            Self::Final => "1",
            Self::Previa => "0.5",
        }
    }
}

pub struct Pedido<'a> {
    /// A pasta do projeto.
    pub pasta: &'a Path,
    /// O vídeo original.
    pub video: &'a Path,
    pub qualidade: Qualidade,
}

/// Um reel pronto.
#[derive(Debug, Clone, PartialEq)]
pub struct Reel {
    pub id: String,
    pub arquivo: PathBuf,
    /// O rosto aparece em menos de 60% do corte.
    pub rosto_raro: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum ErroDaProducao {
    #[error("produção cancelada")]
    Cancelada,
    #[error("roteiro inválido:\n{0}")]
    RoteiroInvalido(String),
    #[error("{0}")]
    Corte(ErroDoCorte),
    #[error("o render falhou: {0}")]
    Render(String),
    #[error("dependências do Remotion não instaladas: {0} não existe")]
    DependenciasNaoInstaladas(String),
    #[error(transparent)]
    Io(#[from] io::Error),
}

impl From<ErroDoCorte> for ErroDaProducao {
    fn from(erro: ErroDoCorte) -> Self {
        match erro {
            ErroDoCorte::Cancelado => Self::Cancelada,
            outro => Self::Corte(outro),
        }
    }
}

impl From<Interrupted> for ErroDaProducao {
    fn from(interrupted: Interrupted) -> Self {
        match interrupted {
            Interrupted::Cancelled => Self::Cancelada,
            Interrupted::Io(error) => Self::Io(error),
        }
    }
}

pub struct Producao {
    ffmpeg: Ffmpeg,
    node: PathBuf,
}

impl Producao {
    pub fn new(ffmpeg: Ffmpeg, node: PathBuf) -> Self {
        Self { ffmpeg, node }
    }

    /// Produz os reels dos cortes `produzir` do roteiro. `progresso` recebe a fração (0 a 1)
    /// de todos os reels; ligar `cancelar` mata o processo em curso.
    pub fn produzir(
        &self,
        pedido: &Pedido,
        cancelar: &AtomicBool,
        progresso: &mut dyn FnMut(f64),
    ) -> Result<Vec<Reel>, ErroDaProducao> {
        let planos = planos(pedido.pasta)?;
        let remotion = pedido.pasta.join("remotion");
        let codigo = hash_do_codigo(&remotion)?;
        let video = identidade(pedido.video)?;
        self.empacotar(&remotion, &codigo, cancelar)?;
        let total = planos.len();
        let mut reels = Vec::new();
        for (indice, plano) in planos.iter().enumerate() {
            if cancelar.load(Ordering::Relaxed) {
                return Err(ErroDaProducao::Cancelada);
            }
            let mut parcial = |fracao: f64| {
                progresso((indice as f64 + fracao.clamp(0.0, 1.0)) / total as f64);
            };
            reels.push(self.produzir_reel(
                pedido,
                plano,
                &video,
                &codigo,
                cancelar,
                &mut parcial,
            )?);
            progresso((indice + 1) as f64 / total as f64);
        }
        Ok(reels)
    }

    /// Gera a folha de revisão de cada reel (`edit/cortes/<chave>/revisao.png`) e o
    /// `edit/producao.json` que a sessão de revisão lê: os reels, os avisos e os erros.
    pub fn preparar_revisao(
        &self,
        pedido: &Pedido,
        reels: &[Reel],
        cancelar: &AtomicBool,
    ) -> Result<(), ErroDaProducao> {
        let planos = planos(pedido.pasta)?;
        let mut itens = Vec::new();
        for reel in reels {
            let Some(plano) = planos.iter().find(|plano| plano.id == reel.id) else {
                continue;
            };
            let pasta = pedido.pasta.join(CORTES).join(&plano.chave);
            let instantes = revisao::instantes(plano);
            self.ffmpeg.folha(
                &reel.arquivo,
                &instantes,
                revisao::COLUNAS,
                &pasta.join(FOLHA),
                &pasta.join("folha"),
                cancelar,
            )?;
            let _ = fs::remove_dir_all(pasta.join("folha"));
            let mut avisos = Vec::new();
            if reel.rosto_raro {
                avisos.push("o rosto aparece em menos de 60% do corte");
            }
            itens.push(json!({
                "id": reel.id,
                "titulo": plano.titulo,
                "arquivo": reel.arquivo.strip_prefix(pedido.pasta).unwrap_or(&reel.arquivo),
                "duracao": plano.duracao,
                "revisao": format!("{CORTES}/{}/{FOLHA}", plano.chave),
                "instantes": instantes,
                "avisos": avisos,
            }));
        }
        let resumo = json!({"reels": itens, "avisos": [], "erros": []});
        crate::files::write_json(&pedido.pasta.join(RESUMO), &resumo)?;
        Ok(())
    }

    /// Empacota o projeto, se o pacote não existe ou o código do Remotion mudou desde então.
    fn empacotar(
        &self,
        remotion: &Path,
        codigo: &str,
        cancelar: &AtomicBool,
    ) -> Result<(), ErroDaProducao> {
        let pacote = remotion.join(PACOTE);
        let marca = remotion.join(HASH_DO_PACOTE);
        if pacote.is_dir() && fs::read_to_string(&marca).is_ok_and(|hash| hash == codigo) {
            return Ok(());
        }
        let _ = fs::remove_file(&marca);
        let _ = fs::remove_dir_all(&pacote);
        self.node(
            remotion,
            &["pacote".as_ref(), pacote.as_os_str()],
            cancelar,
            &mut |_| {},
        )?;
        fs::write(marca, codigo)?;
        Ok(())
    }

    fn produzir_reel(
        &self,
        pedido: &Pedido,
        plano: &Plano,
        video: &str,
        codigo: &str,
        cancelar: &AtomicBool,
        progresso: &mut dyn FnMut(f64),
    ) -> Result<Reel, ErroDaProducao> {
        let pasta = pedido.pasta.join(CORTES).join(&plano.chave);
        fs::create_dir_all(&pasta)?;
        let corte = pasta.join("corte.mp4");
        let hash_do_corte = hash(&[video.as_bytes(), &bytes_dos_trechos(&plano.trechos)]);
        if !em_dia(&pasta.join("corte.hash"), &hash_do_corte) || !corte.is_file() {
            let trabalho = pasta.join("trabalho");
            let trechos: Vec<Trecho> = plano
                .trechos
                .iter()
                .map(|&(inicio, fim)| Trecho { inicio, fim })
                .collect();
            self.ffmpeg.montar(
                pedido.video,
                &trechos,
                &corte,
                &trabalho,
                cancelar,
                &mut |f| progresso(f * FIM_DO_CORTE),
            )?;
            let _ = fs::remove_dir_all(&trabalho);
            fs::write(pasta.join("corte.hash"), &hash_do_corte)?;
        }
        progresso(FIM_DO_CORTE);

        let rosto = pasta.join("face.json");
        let pins: Vec<Pin> = plano.pins.iter().filter_map(|p| Pin::analisar(p)).collect();
        let hash_do_rosto = hash(&[hash_do_corte.as_bytes(), plano.pins.join("\n").as_bytes()]);
        if !em_dia(&pasta.join("face.hash"), &hash_do_rosto) || !rosto.is_file() {
            let rastro = self
                .ffmpeg
                .rastrear_rosto(&corte, &pins, cancelar, &mut |f| {
                    progresso(FIM_DO_CORTE + f * (FIM_DO_ROSTO - FIM_DO_CORTE));
                })?;
            fs::write(&rosto, rastro.para_json())?;
            fs::write(pasta.join("face.hash"), &hash_do_rosto)?;
        }
        let rosto_raro = rosto_raro(&rosto);
        progresso(FIM_DO_ROSTO);

        let legendas =
            serde_json::to_string_pretty(&plano.legendas).expect("as legendas serializam");
        let motion = serde_json::to_string_pretty(&plano.motion).expect("o motion serializa");
        let hash_do_render = hash(&[
            hash_do_corte.as_bytes(),
            hash_do_rosto.as_bytes(),
            legendas.as_bytes(),
            motion.as_bytes(),
            codigo.as_bytes(),
            pedido.qualidade.nome().as_bytes(),
        ]);
        let pasta_final = match pedido.qualidade {
            Qualidade::Final => pedido.pasta.join(PUBLICAR),
            Qualidade::Previa => pedido.pasta.join(PUBLICAR).join(PREVIAS),
        };
        let nome = nome_do_reel(&plano.id, plano.titulo.as_deref());
        let arquivo = pasta_final.join(&nome);
        let marca = pasta.join(format!("render-{}.hash", pedido.qualidade.nome()));
        let reel = Reel {
            id: plano.id.clone(),
            arquivo: arquivo.clone(),
            rosto_raro,
        };
        if let Some(anterior) = render_em_dia(&marca, &hash_do_render, &pasta_final)
            && (anterior == nome || fs::rename(pasta_final.join(&anterior), &arquivo).is_ok())
        {
            progresso(1.0);
            return Ok(reel);
        }

        let dados = pasta.join("clip");
        let info = self.ffmpeg.sondar(&corte, cancelar)?;
        let (largura, altura) = match info.rotacao {
            90 | 270 => (info.altura, info.largura),
            _ => (info.largura, info.altura),
        };
        let _ = fs::remove_dir_all(&dados);
        fs::create_dir_all(&dados)?;
        let clip = json!({
            "video": "corte.mp4",
            "durationSec": plano.duracao,
            "width": largura,
            "height": altura,
            "fps": FPS,
        });
        fs::write(dados.join("clip.json"), clip.to_string())?;
        fs::write(dados.join("captions.json"), legendas)?;
        fs::write(dados.join("face.json"), fs::read(&rosto)?)?;
        fs::write(dados.join("motion.json"), motion)?;
        if fs::hard_link(&corte, dados.join("corte.mp4")).is_err() {
            fs::copy(&corte, dados.join("corte.mp4"))?;
        }

        fs::create_dir_all(&pasta_final)?;
        let parcial = pasta.join(format!("render-{}.mp4", pedido.qualidade.nome()));
        let pacote = pedido.pasta.join("remotion").join(PACOTE);
        self.node(
            &pedido.pasta.join("remotion"),
            &[
                "render".as_ref(),
                pacote.as_os_str(),
                plano.chave.as_ref(),
                dados.as_os_str(),
                parcial.as_os_str(),
                pedido.qualidade.escala().as_ref(),
            ],
            cancelar,
            &mut |fracao| progresso(FIM_DO_ROSTO + fracao * (1.0 - FIM_DO_ROSTO)),
        )?;
        fs::rename(&parcial, &arquivo)?;
        if let Some(antigo) = nome_publicado(&marca).filter(|antigo| *antigo != nome) {
            let _ = fs::remove_file(pasta_final.join(antigo));
        }
        fs::write(&marca, format!("{hash_do_render}\n{nome}"))?;
        progresso(1.0);
        Ok(reel)
    }

    /// Roda `node render.mjs <args>` dentro de `remotion/`. Cada linha `progresso <fração>`
    /// do script vai a `progresso`.
    fn node(
        &self,
        remotion: &Path,
        args: &[&OsStr],
        cancelar: &AtomicBool,
        progresso: &mut dyn FnMut(f64),
    ) -> Result<(), ErroDaProducao> {
        let node_modules = remotion.join("node_modules");
        if !node_modules.is_dir() {
            return Err(ErroDaProducao::DependenciasNaoInstaladas(
                node_modules.display().to_string(),
            ));
        }
        fs::write(remotion.join(NOME_DO_SCRIPT), SCRIPT)?;
        let mut comando = Command::new(&self.node);
        comando.arg(NOME_DO_SCRIPT).args(args).current_dir(remotion);
        let saida = process::run(comando, cancelar, &mut |stream, linha| {
            if stream == Stream::Stdout
                && let Some(fracao) = linha
                    .strip_prefix("progresso ")
                    .and_then(|f| f.trim().parse().ok())
            {
                progresso(fracao);
            }
        })?;
        if saida.status.success() {
            Ok(())
        } else {
            Err(ErroDaProducao::Render(format!(
                "{}: {}",
                saida.status,
                linha_do_erro(&saida.stderr)
            )))
        }
    }
}

/// A linha que diz o que deu errado no stderr do Node: a do erro (`Error [...]: ...`), e não o
/// rodapé `Node.js vX` que ele imprime depois de um erro não tratado.
fn linha_do_erro(stderr: &str) -> &str {
    let linhas: Vec<&str> = stderr
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("Node.js v"))
        .collect();
    linhas
        .iter()
        .find(|l| l.contains("Error") && !l.starts_with("at "))
        .or(linhas.last())
        .copied()
        .unwrap_or_default()
}

/// Os planos dos cortes `produzir` do roteiro do projeto.
fn planos(pasta: &Path) -> Result<Vec<Plano>, ErroDaProducao> {
    let texto = fs::read_to_string(pasta.join(ROTEIRO))?;
    let validacao = validar_na_pasta(pasta, &texto);
    if validacao.tem_erros() {
        return Err(ErroDaProducao::RoteiroInvalido(validacao.relatorio()));
    }
    Ok(validacao
        .cortes
        .into_iter()
        .filter_map(|corte| corte.plano)
        .collect())
}

/// O vídeo original como o cache o enxerga: caminho, tamanho e data.
fn identidade(video: &Path) -> io::Result<String> {
    let metadados = fs::metadata(video)?;
    let modificado = metadados
        .modified()
        .ok()
        .and_then(|data| data.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |duracao| duracao.as_nanos());
    Ok(format!(
        "{}|{}|{modificado}",
        video.display(),
        metadados.len()
    ))
}

fn bytes_dos_trechos(trechos: &[(f64, f64)]) -> Vec<u8> {
    trechos
        .iter()
        .map(|(inicio, fim)| format!("{inicio:.3}-{fim:.3}"))
        .collect::<Vec<_>>()
        .join(",")
        .into_bytes()
}

/// O hash do código do Remotion do projeto: `src/`, `public/` (menos os dados dos reels em
/// `clips/`) e os arquivos de configuração, mais o script de render.
fn hash_do_codigo(remotion: &Path) -> io::Result<String> {
    let mut arquivos = Vec::new();
    juntar(&remotion.join("src"), Path::new("src"), &mut arquivos)?;
    juntar(&remotion.join("public"), Path::new("public"), &mut arquivos)?;
    arquivos.retain(|relativo| !relativo.starts_with("public/clips"));
    for nome in ARQUIVOS_DE_CODIGO {
        if remotion.join(nome).is_file() {
            arquivos.push(PathBuf::from(nome));
        }
    }
    arquivos.sort();
    let mut resumo = Sha256::new();
    for relativo in arquivos {
        resumo.update(relativo.to_string_lossy().as_bytes());
        resumo.update([0]);
        resumo.update(fs::read(remotion.join(&relativo))?);
        resumo.update([0]);
    }
    resumo.update(SCRIPT.as_bytes());
    Ok(hex(&resumo.finalize()))
}

/// Acrescenta a `arquivos` os caminhos (relativos) de tudo o que há em `pasta`.
fn juntar(pasta: &Path, relativo: &Path, arquivos: &mut Vec<PathBuf>) -> io::Result<()> {
    let Ok(entradas) = fs::read_dir(pasta) else {
        return Ok(());
    };
    for entrada in entradas {
        let entrada = entrada?;
        let caminho = relativo.join(entrada.file_name());
        if entrada.file_type()?.is_dir() {
            juntar(&entrada.path(), &caminho, arquivos)?;
        } else {
            arquivos.push(caminho);
        }
    }
    Ok(())
}

fn hash(partes: &[&[u8]]) -> String {
    let mut resumo = Sha256::new();
    for parte in partes {
        resumo.update((parte.len() as u64).to_le_bytes());
        resumo.update(parte);
    }
    hex(&resumo.finalize())
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut texto, byte| {
        let _ = write!(texto, "{byte:02x}");
        texto
    })
}

fn em_dia(marca: &Path, esperado: &str) -> bool {
    fs::read_to_string(marca).is_ok_and(|hash| hash == esperado)
}

/// O nome com que o render deste hash foi publicado, se ele ainda está na pasta.
fn render_em_dia(marca: &Path, esperado: &str, pasta: &Path) -> Option<String> {
    let texto = fs::read_to_string(marca).ok()?;
    let (hash, nome) = texto.split_once('\n')?;
    (hash == esperado && pasta.join(nome).is_file()).then(|| nome.to_owned())
}

fn nome_publicado(marca: &Path) -> Option<String> {
    let texto = fs::read_to_string(marca).ok()?;
    texto.split_once('\n').map(|(_, nome)| nome.to_owned())
}

fn rosto_raro(rosto: &Path) -> bool {
    fs::read_to_string(rosto)
        .ok()
        .and_then(|texto| serde_json::from_str::<serde_json::Value>(&texto).ok())
        .and_then(|json| json["stats"]["face_ratio"].as_f64())
        .is_some_and(|proporcao| proporcao < crate::rosto::PROPORCAO_MINIMA_COM_ROSTO)
}

/// `c01 - <título até 50 caracteres>.mp4`, sem o que o sistema de arquivos não aceita.
pub(crate) fn nome_do_reel(id: &str, titulo: Option<&str>) -> String {
    let limpo: String = titulo
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control() && !"/\\:*?\"<>|".contains(*c))
        .collect();
    let junto = limpo.split_whitespace().collect::<Vec<_>>().join(" ");
    let titulo: String = junto.chars().take(TITULO_MAXIMO).collect();
    let titulo = titulo.trim_end_matches(|c: char| c.is_whitespace() || c == '.');
    if titulo.is_empty() {
        format!("{id}.mp4")
    } else {
        format!("{id} - {titulo}.mp4")
    }
}
