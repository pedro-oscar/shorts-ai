//! A Produção pela interface pública do núcleo: corte, rosto, dados do reel e render no
//! Remotion do projeto, com `ffmpeg`, `ffprobe` e `node` falsos (scripts de shell). O teste
//! lento (`--ignored`) usa os programas reais num vídeo de 20 s.
#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use nucleo::corte::Ffmpeg;
use nucleo::producao::{ErroDaProducao, Pedido, Producao, Qualidade};
use serde_json::{Value, json};

const FFPROBE: &str = r#"#!/bin/sh
case "$*" in
*format=duration*) echo 2.0 ;;
*) echo '{"streams":[{"width":256,"height":128}]}' ;;
esac
"#;

/// Registra os argumentos; entrega quadros crus para o rosto e, no resto, imita o corte.
const FFMPEG: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
echo "$@" >> "$dir/ffmpeg.log"
case "$*" in
*rawvideo*)
  for i in 1 2 3 4 5 6 7 8 9 10; do cat "$dir/quadro.rgb"; done
  exit 0 ;;
*signalstats*)
  echo "lavfi.signalstats.YLOW=10"
  echo "lavfi.signalstats.YAVG=120"
  echo "lavfi.signalstats.YHIGH=230"
  echo "lavfi.signalstats.SATAVG=60"
  exit 0 ;;
*print_format=json*)
  cat "$dir/loudnorm.json" >&2
  exit 0 ;;
*"-f null"*) exit 0 ;;
esac
for ultimo; do :; done
case "$ultimo" in
*original-c02*)
  [ -f "$dir/corte-c02-falha" ] && { echo "corte quebrou" >&2; exit 1; }
  touch "$dir/cortou-c02" ;;
esac
echo dados > "$ultimo"
"#;

/// Registra os argumentos. `pacote` cria a pasta do pacote; `render` anuncia o progresso e
/// grava a saída (o quinto argumento depois do script é a saída, o sexto, a escala, e o sétimo,
/// as abas do Chrome). Com a marca `render-espera-corte`, o render do c01 espera o corte do c02
/// começar.
const NODE: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
echo "$PWD: $@" >> "$dir/node.log"
[ -f "$dir/node-erro" ] && {
  printf 'node:internal/modules:331\n  throw new ERR_MODULE_NOT_FOUND(x);\n        ^\n\nError [ERR_MODULE_NOT_FOUND]: Cannot find package x\n    at foo (bar)\n  code: 1\n}\n\nNode.js v24.21.0\n' >&2
  exit 1
}
[ -f "$dir/node-falha" ] && { echo 'chrome não abriu' >&2; exit 1; }
case "$2" in
pacote) mkdir -p "$3" ;;
render)
  if [ -f "$dir/render-espera-corte" ] && [ "$4" = original-c01 ]; then
    i=0
    while [ $i -lt 100 ] && [ ! -f "$dir/cortou-c02" ]; do sleep 0.1; i=$((i+1)); done
    [ -f "$dir/cortou-c02" ] && touch "$dir/render-viu-corte"
  fi
  echo "progresso 0.250"
  echo "progresso 1.000"
  saida="$6"
  echo reel > "$saida" ;;
esac
"#;

const LOUDNORM: &str = r#"{"input_i":"-20.0","input_tp":"-3.0","input_lra":"5.0","input_thresh":"-30.0","target_offset":"0.5"}"#;

/// Um corte do roteiro: id, título, o trecho e as cenas que ele cita.
type CorteComCenas<'a> = (&'a str, &'a str, (f64, f64), &'a [&'a str]);

struct Cenario {
    tmp: tempfile::TempDir,
    producao: Producao,
    pasta: PathBuf,
}

impl Cenario {
    fn novo() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("bin");
        fs::create_dir(&bin).unwrap();
        for (nome, conteudo) in [("ffmpeg", FFMPEG), ("ffprobe", FFPROBE), ("node", NODE)] {
            let caminho = bin.join(nome);
            fs::write(&caminho, conteudo).unwrap();
            fs::set_permissions(&caminho, fs::Permissions::from_mode(0o755)).unwrap();
        }
        fs::write(bin.join("loudnorm.json"), LOUDNORM).unwrap();
        fs::copy(
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/dados/dois-rostos-256x128.rgb"
            ),
            bin.join("quadro.rgb"),
        )
        .unwrap();
        let pasta = tmp.path().join("projeto");
        fs::create_dir_all(pasta.join("edit")).unwrap();
        fs::create_dir_all(pasta.join("remotion/src/scenes")).unwrap();
        fs::create_dir_all(pasta.join("remotion/public/clips/demo")).unwrap();
        fs::write(pasta.join("remotion/src/Root.tsx"), "root").unwrap();
        fs::write(pasta.join("remotion/src/scenes/index.ts"), "cenas").unwrap();
        // O `node_modules` compartilhado, ligado ao projeto como o app o liga.
        let node_modules = tmp.path().join("dados/remotion/node_modules");
        fs::create_dir_all(&node_modules).unwrap();
        std::os::unix::fs::symlink(&node_modules, pasta.join("remotion/node_modules")).unwrap();
        fs::write(pasta.join("remotion/package.json"), "{}").unwrap();
        fs::write(pasta.join("remotion/public/clips/demo/clip.json"), "{}").unwrap();
        fs::write(pasta.join("original.mp4"), b"video").unwrap();
        let palavras: Vec<Value> = (0..10)
            .map(|n| {
                let inicio = f64::from(n) * 0.5;
                json!({"text": if n % 5 == 4 { "fim." } else { "oi" }, "start": inicio, "end": inicio + 0.4, "type": "word"})
            })
            .collect();
        fs::write(
            pasta.join("edit/transcricao.json"),
            json!({"words": palavras}).to_string(),
        )
        .unwrap();
        let cenario = Self {
            producao: Producao::new(
                Ffmpeg::new(bin.join("ffmpeg"), bin.join("ffprobe")),
                bin.join("node"),
            ),
            tmp,
            pasta,
        };
        cenario.roteiro(&[
            ("c01", "Negociar salário tem regra", (0.0, 2.4)),
            ("c02", "Dois / três: o que importa?", (2.5, 4.9)),
        ]);
        cenario.instalar_dependencias("4.0.533");
        cenario
    }

    /// Grava o `.package-lock.json` que o `npm` deixa no `node_modules` ao terminar de instalar.
    fn instalar_dependencias(&self, versao_do_remotion: &str) {
        fs::write(
            self.pasta.join("remotion/node_modules/.package-lock.json"),
            json!({"packages": {"node_modules/remotion": {"version": versao_do_remotion}}})
                .to_string(),
        )
        .unwrap();
    }

    fn roteiro(&self, cortes: &[(&str, &str, (f64, f64))]) {
        let cortes: Vec<_> = cortes
            .iter()
            .map(|&(id, titulo, trecho)| (id, titulo, trecho, &[][..]))
            .collect();
        self.roteiro_com_cenas(&cortes);
    }

    /// O roteiro com um motion `scene` (card) de cada cena citada no corte.
    fn roteiro_com_cenas(&self, cortes: &[CorteComCenas]) {
        let cortes: Vec<Value> = cortes
            .iter()
            .map(|(id, titulo, (a, b), cenas)| {
                let motions: Vec<Value> = cenas
                    .iter()
                    .enumerate()
                    .map(|(i, nome)| {
                        json!({"type": "scene", "name": nome, "at": a + 0.2 + i as f64, "dur": 0.8, "layout": "card"})
                    })
                    .collect();
                json!({"id": id, "status": "produzir", "titulo": titulo, "trechos": [[a, b]], "motions": motions})
            })
            .collect();
        fs::write(
            self.pasta.join("edit/roteiro.json"),
            json!({"versao": 1, "fonte": "original.mp4", "cortes": cortes}).to_string(),
        )
        .unwrap();
    }

    /// O registro de cenas do projeto (`src/scenes/index.ts`) com as cenas `nomes`.
    fn registrar(&self, nomes: &[&str]) {
        let imports: String = nomes
            .iter()
            .map(|nome| format!("import {{{nome}}} from './{nome}';\n"))
            .collect();
        fs::write(
            self.pasta.join("remotion/src/scenes/index.ts"),
            format!(
                "{imports}export const SCENES = {{\n  {},\n}};\n",
                nomes.join(",\n  ")
            ),
        )
        .unwrap();
    }

    fn acrescentar_ao_registro(&self, texto: &str) {
        let registro = self.pasta.join("remotion/src/scenes/index.ts");
        let mut atual = fs::read_to_string(&registro).unwrap();
        atual.push_str(texto);
        fs::write(&registro, atual).unwrap();
    }

    /// Grava o arquivo de uma cena (`src/scenes/<nome>.tsx`).
    fn cena(&self, nome: &str, codigo: &str) {
        fs::write(
            self.pasta.join(format!("remotion/src/scenes/{nome}.tsx")),
            codigo,
        )
        .unwrap();
    }

    fn renders_de(&self, id: &str) -> usize {
        self.renders()
            .iter()
            .filter(|c| c.contains(&format!("original-{id} ")))
            .count()
    }

    fn bin(&self) -> PathBuf {
        self.tmp.path().join("bin")
    }

    fn produzir(
        &self,
        qualidade: Qualidade,
    ) -> Result<Vec<nucleo::producao::Reel>, ErroDaProducao> {
        self.produzir_com(qualidade, &mut |_| {})
    }

    fn produzir_com(
        &self,
        qualidade: Qualidade,
        progresso: &mut dyn FnMut(f64),
    ) -> Result<Vec<nucleo::producao::Reel>, ErroDaProducao> {
        self.producao.produzir(
            &Pedido {
                pasta: &self.pasta,
                video: &self.pasta.join("original.mp4"),
                qualidade,
            },
            &AtomicBool::new(false),
            progresso,
        )
    }

    fn chamadas(&self, programa: &str) -> Vec<String> {
        fs::read_to_string(self.bin().join(format!("{programa}.log")))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    fn renders(&self) -> Vec<String> {
        self.chamadas("node")
            .into_iter()
            .filter(|c| c.contains(" render "))
            .collect()
    }

    fn pacotes(&self) -> usize {
        self.chamadas("node")
            .iter()
            .filter(|c| c.contains(" pacote "))
            .count()
    }

    /// Os passos medidos em `edit/tempos.jsonl`, com o reel de cada um.
    fn tempos(&self) -> Vec<(String, Option<String>)> {
        fs::read_to_string(self.pasta.join("edit/tempos.jsonl"))
            .unwrap_or_default()
            .lines()
            .map(|linha| {
                let linha: Value = serde_json::from_str(linha).unwrap();
                assert!(linha["inicio"].as_str() <= linha["fim"].as_str(), "{linha}");
                (
                    linha["passo"].as_str().unwrap().to_owned(),
                    linha["reel"].as_str().map(str::to_owned),
                )
            })
            .collect()
    }

    fn ffmpeg_de_corte(&self) -> usize {
        self.chamadas("ffmpeg")
            .iter()
            .filter(|c| c.contains("libx264") && !c.contains("rawvideo"))
            .count()
    }
}

fn nomes(pasta: &Path) -> Vec<String> {
    let mut nomes: Vec<String> = fs::read_dir(pasta)
        .map(|entradas| {
            entradas
                .filter_map(Result::ok)
                .filter(|e| e.path().is_file())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    nomes.sort();
    nomes
}

#[test]
fn a_versao_final_sai_em_publicar_com_o_titulo_no_nome_e_um_reel_por_corte() {
    let cenario = Cenario::novo();

    let reels = cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(
        nomes(&cenario.pasta.join("publicar")),
        [
            "c01 - Negociar salário tem regra.mp4",
            "c02 - Dois três o que importa.mp4",
        ]
    );
    assert_eq!(reels.len(), 2);
    assert_eq!(reels[0].id, "c01");
    assert_eq!(
        reels[0].arquivo,
        cenario
            .pasta
            .join("publicar/c01 - Negociar salário tem regra.mp4")
    );
    assert!(!cenario.pasta.join("publicar/prévias").exists());
}

#[test]
fn a_previa_sai_em_publicar_previas_em_escala_meia() {
    let cenario = Cenario::novo();

    cenario.produzir(Qualidade::Previa).unwrap();

    assert_eq!(
        nomes(&cenario.pasta.join("publicar/prévias")),
        [
            "c01 - Negociar salário tem regra.mp4",
            "c02 - Dois três o que importa.mp4",
        ]
    );
    assert!(
        !cenario
            .pasta
            .join("publicar/c01 - Negociar salário tem regra.mp4")
            .exists()
    );
    let renders = cenario.renders();
    // A escala vem antes das abas do Chrome, o último argumento.
    assert!(
        renders.iter().all(|c| c.rsplit(' ').nth(1) == Some("0.5")),
        "{renders:?}"
    );
}

#[test]
fn o_projeto_e_empacotado_uma_vez_e_cada_corte_e_renderizado_do_pacote() {
    let cenario = Cenario::novo();

    cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(cenario.pacotes(), 1);
    let renders = cenario.renders();
    assert_eq!(renders.len(), 2);
    assert!(renders[0].contains("remotion: "), "{renders:?}");
    assert!(renders[0].contains("render.mjs render "), "{renders:?}");
    assert_eq!(renders[0].rsplit(' ').nth(1), Some("1"), "{renders:?}");
}

#[test]
fn o_template_recebe_video_legendas_rosto_motions_e_estilo_de_cada_reel() {
    let cenario = Cenario::novo();

    cenario.produzir(Qualidade::Final).unwrap();

    let render = &cenario.renders()[0];
    let pasta_dos_dados = render
        .split_whitespace()
        .find(|argumento| argumento.ends_with("/clip"))
        .unwrap();
    let dados = Path::new(pasta_dos_dados);
    let lido = |nome: &str| -> Value {
        serde_json::from_str(&fs::read_to_string(dados.join(nome)).unwrap()).unwrap()
    };
    assert!(dados.join("corte.mp4").is_file());
    let clip = lido("clip.json");
    assert_eq!(clip["video"], "corte.mp4");
    assert_eq!(clip["width"], 256);
    assert_eq!(clip["height"], 128);
    assert!((clip["durationSec"].as_f64().unwrap() - 2.7).abs() < 0.5);
    assert_eq!(lido("captions.json").as_array().unwrap().len(), 5);
    assert!(!lido("face.json")["keys"].as_array().unwrap().is_empty());
    let motion = lido("motion.json");
    assert_eq!(motion["motions"][0]["type"], "title");
    assert_eq!(motion["motions"][0]["text"], "Negociar salário tem regra");
    assert!(motion["style"].is_object());
    // O c01 vai de 0 a 2,44 s: "fim." acaba em 2,4 e o "oi" seguinte começa em 2,5.
    assert_eq!(motion["saida"], json!({"fimFala": 2.4, "congelar": 0.96}));
}

#[test]
fn refazer_sem_mudar_nada_nao_corta_nem_renderiza_de_novo() {
    let cenario = Cenario::novo();
    cenario.produzir(Qualidade::Final).unwrap();
    let cortes = cenario.ffmpeg_de_corte();
    assert!(cortes > 0);

    cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(cenario.ffmpeg_de_corte(), cortes);
    assert_eq!(cenario.renders().len(), 2);
    assert_eq!(cenario.pacotes(), 1);
}

#[test]
fn grava_em_tempos_o_pacote_e_o_corte_o_rosto_e_o_render_de_cada_reel() {
    let cenario = Cenario::novo();

    cenario.produzir(Qualidade::Final).unwrap();

    let reel = |passo: &str, id: &str| (passo.to_owned(), Some(id.to_owned()));
    assert_eq!(
        cenario.tempos(),
        [
            ("pacote".to_owned(), None),
            reel("corte", "c01"),
            reel("rosto", "c01"),
            reel("render", "c01"),
            reel("corte", "c02"),
            reel("rosto", "c02"),
            reel("render", "c02"),
        ]
    );
}

#[test]
fn o_que_vem_do_cache_nao_grava_tempo() {
    let cenario = Cenario::novo();
    cenario.produzir(Qualidade::Final).unwrap();
    let medidos = cenario.tempos().len();

    cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(cenario.tempos().len(), medidos);
}

#[test]
fn sem_poder_gravar_os_tempos_a_producao_segue() {
    let cenario = Cenario::novo();
    fs::create_dir(cenario.pasta.join("edit/tempos.jsonl")).unwrap();

    let reels = cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(reels.len(), 2);
}

#[test]
fn mudar_um_corte_refaz_so_ele() {
    let cenario = Cenario::novo();
    cenario.produzir(Qualidade::Final).unwrap();
    let cortes = cenario.ffmpeg_de_corte();

    cenario.roteiro(&[
        ("c01", "Negociar salário tem regra", (0.0, 2.4)),
        ("c02", "Dois / três: o que importa?", (2.5, 4.4)),
    ]);
    cenario.produzir(Qualidade::Final).unwrap();

    let renders = cenario.renders();
    assert_eq!(renders.len(), 3, "{renders:?}");
    assert!(renders[2].contains("c02"), "{renders:?}");
    assert!(cenario.ffmpeg_de_corte() > cortes);
    assert_eq!(cenario.pacotes(), 1);
}

#[test]
fn mudar_so_o_texto_de_um_motion_renderiza_sem_cortar_de_novo() {
    let cenario = Cenario::novo();
    cenario.produzir(Qualidade::Final).unwrap();
    let cortes = cenario.ffmpeg_de_corte();
    let rastreios = cenario
        .chamadas("ffmpeg")
        .iter()
        .filter(|c| c.contains("rawvideo"))
        .count();

    cenario.roteiro(&[
        ("c01", "Outro título", (0.0, 2.4)),
        ("c02", "Dois / três: o que importa?", (2.5, 4.9)),
    ]);
    cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(cenario.ffmpeg_de_corte(), cortes);
    let rastreios_depois = cenario
        .chamadas("ffmpeg")
        .iter()
        .filter(|c| c.contains("rawvideo"))
        .count();
    assert_eq!(rastreios_depois, rastreios);
    assert_eq!(cenario.renders().len(), 3);
    assert_eq!(
        nomes(&cenario.pasta.join("publicar")),
        [
            "c01 - Outro título.mp4",
            "c02 - Dois três o que importa.mp4",
        ]
    );
}

#[test]
fn mudar_o_codigo_comum_do_remotion_do_projeto_empacota_e_renderiza_tudo_de_novo() {
    let cenario = Cenario::novo();
    cenario.produzir(Qualidade::Final).unwrap();

    fs::write(cenario.pasta.join("remotion/src/Root.tsx"), "outra raiz").unwrap();
    cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(cenario.pacotes(), 2);
    assert_eq!(cenario.renders().len(), 4);
}

#[test]
fn uma_cena_nova_usada_so_por_um_reel_nao_renderiza_os_outros_de_novo() {
    let cenario = Cenario::novo();
    cenario.cena("Grafico", "grafico");
    cenario.registrar(&["Grafico"]);
    cenario.produzir(Qualidade::Final).unwrap();

    cenario.cena("Versiculo", "versiculo");
    cenario.registrar(&["Grafico", "Versiculo"]);
    cenario.roteiro_com_cenas(&[
        (
            "c01",
            "Negociar salário tem regra",
            (0.0, 2.4),
            &["Versiculo"],
        ),
        ("c02", "Dois / três: o que importa?", (2.5, 4.9), &[]),
    ]);
    cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(cenario.renders_de("c01"), 2);
    assert_eq!(cenario.renders_de("c02"), 1);
    assert_eq!(cenario.pacotes(), 2);
}

#[test]
fn corrigir_uma_cena_renderiza_de_novo_so_os_reels_que_a_citam() {
    let cenario = Cenario::novo();
    cenario.cena("Grafico", "grafico");
    cenario.cena("Dinheiro", "dinheiro");
    cenario.registrar(&["Grafico", "Dinheiro"]);
    cenario.roteiro_com_cenas(&[
        (
            "c01",
            "Negociar salário tem regra",
            (0.0, 2.4),
            &["Grafico"],
        ),
        (
            "c02",
            "Dois / três: o que importa?",
            (2.5, 4.9),
            &["Grafico", "Dinheiro"],
        ),
    ]);
    cenario.produzir(Qualidade::Final).unwrap();

    cenario.cena("Dinheiro", "dinheiro corrigido");
    cenario.produzir(Qualidade::Final).unwrap();
    assert_eq!(cenario.renders_de("c01"), 1);
    assert_eq!(cenario.renders_de("c02"), 2);

    cenario.cena("Grafico", "grafico corrigido");
    cenario.produzir(Qualidade::Final).unwrap();
    assert_eq!(cenario.renders_de("c01"), 2);
    assert_eq!(cenario.renders_de("c02"), 3);
}

#[test]
fn mudar_uma_cena_que_nenhum_reel_cita_empacota_sem_renderizar() {
    let cenario = Cenario::novo();
    cenario.cena("Grafico", "grafico");
    cenario.registrar(&["Grafico"]);
    cenario.produzir(Qualidade::Final).unwrap();

    cenario.cena("Grafico", "grafico corrigido");
    cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(cenario.pacotes(), 2);
    assert_eq!(cenario.renders().len(), 2);
}

#[test]
fn mudar_so_o_registro_de_cenas_nao_renderiza_de_novo() {
    let cenario = Cenario::novo();
    cenario.cena("Grafico", "grafico");
    cenario.registrar(&["Grafico"]);
    cenario.roteiro_com_cenas(&[
        (
            "c01",
            "Negociar salário tem regra",
            (0.0, 2.4),
            &["Grafico"],
        ),
        ("c02", "Dois / três: o que importa?", (2.5, 4.9), &[]),
    ]);
    cenario.produzir(Qualidade::Final).unwrap();

    cenario.acrescentar_ao_registro("export const EXEMPLOS = {Grafico: {props: {}}};\n");
    cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(cenario.pacotes(), 2);
    assert_eq!(cenario.renders().len(), 2);
}

#[test]
fn um_arquivo_da_pasta_de_cenas_que_nao_e_cena_e_codigo_comum() {
    let cenario = Cenario::novo();
    cenario.cena("Grafico", "grafico");
    cenario.registrar(&["Grafico"]);
    fs::write(cenario.pasta.join("remotion/src/scenes/types.ts"), "tipos").unwrap();
    cenario.produzir(Qualidade::Final).unwrap();

    fs::write(
        cenario.pasta.join("remotion/src/scenes/types.ts"),
        "outros tipos",
    )
    .unwrap();
    cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(cenario.renders().len(), 4);
}

#[test]
fn um_componente_da_pasta_de_cenas_que_nao_esta_no_registro_e_codigo_comum() {
    let cenario = Cenario::novo();
    cenario.cena("Grafico", "grafico");
    cenario.cena("Fundo", "fundo");
    cenario.registrar(&["Grafico"]);
    cenario.produzir(Qualidade::Final).unwrap();

    cenario.cena("Fundo", "outro fundo");
    cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(cenario.renders().len(), 4);
}

#[test]
fn um_reel_que_cita_uma_cena_sem_arquivo_proprio_depende_de_todas_as_cenas() {
    let cenario = Cenario::novo();
    cenario.cena("Grafico", "grafico");
    cenario.registrar(&["Grafico", "Fantasma"]);
    cenario.roteiro_com_cenas(&[
        (
            "c01",
            "Negociar salário tem regra",
            (0.0, 2.4),
            &["Fantasma"],
        ),
        ("c02", "Dois / três: o que importa?", (2.5, 4.9), &[]),
    ]);
    cenario.produzir(Qualidade::Final).unwrap();

    cenario.acrescentar_ao_registro("export const EXEMPLOS = {};\n");
    cenario.produzir(Qualidade::Final).unwrap();
    cenario.cena("Grafico", "outro grafico");
    cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(cenario.renders_de("c01"), 3);
    assert_eq!(cenario.renders_de("c02"), 1);
}

#[test]
fn os_dados_do_reel_gerados_nao_contam_como_codigo_do_remotion() {
    let cenario = Cenario::novo();
    cenario.produzir(Qualidade::Final).unwrap();

    fs::write(
        cenario.pasta.join("remotion/public/clips/demo/clip.json"),
        "{\"a\":1}",
    )
    .unwrap();
    cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(cenario.pacotes(), 1);
    assert_eq!(cenario.renders().len(), 2);
}

#[test]
fn trocar_as_dependencias_do_remotion_empacota_de_novo_sem_renderizar_os_reels() {
    let cenario = Cenario::novo();
    cenario.produzir(Qualidade::Final).unwrap();

    cenario.instalar_dependencias("4.0.600");
    cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(cenario.pacotes(), 2);
    assert_eq!(cenario.renders().len(), 2);
}

#[test]
fn a_previa_e_a_versao_final_tem_caches_separados() {
    let cenario = Cenario::novo();
    cenario.produzir(Qualidade::Previa).unwrap();
    let cortes = cenario.ffmpeg_de_corte();

    cenario.produzir(Qualidade::Final).unwrap();

    assert_eq!(cenario.renders().len(), 4);
    assert_eq!(cenario.ffmpeg_de_corte(), cortes);
    assert_eq!(nomes(&cenario.pasta.join("publicar")).len(), 2);
    assert_eq!(nomes(&cenario.pasta.join("publicar/prévias")).len(), 2);
}

#[test]
fn o_progresso_avanca_por_reel_e_termina_em_um() {
    let cenario = Cenario::novo();
    let mut fracoes = Vec::new();

    cenario
        .produzir_com(Qualidade::Final, &mut |f| fracoes.push(f))
        .unwrap();

    assert!(
        fracoes.windows(2).all(|par| par[0] <= par[1]),
        "{fracoes:?}"
    );
    // O preparo de um reel e o render do outro se misturam: não há mais um ponto exato por
    // reel, só o caminho do começo ao fim.
    assert!(fracoes.iter().any(|f| *f > 0.1 && *f < 0.9), "{fracoes:?}");
    assert!((fracoes.last().unwrap() - 1.0).abs() < 1e-9, "{fracoes:?}");
}

#[test]
fn o_corte_do_reel_seguinte_comeca_antes_de_o_render_do_atual_terminar() {
    let cenario = Cenario::novo();
    fs::write(cenario.bin().join("render-espera-corte"), "").unwrap();

    cenario.produzir(Qualidade::Final).unwrap();

    assert!(
        cenario.bin().join("render-viu-corte").exists(),
        "o render do c01 terminou sem o corte do c02 começar"
    );
    assert_eq!(cenario.renders().len(), 2);
}

#[test]
fn a_falha_no_preparo_do_reel_seguinte_vira_o_erro_da_producao() {
    let cenario = Cenario::novo();
    fs::write(cenario.bin().join("corte-c02-falha"), "").unwrap();

    let erro = cenario.produzir(Qualidade::Final).unwrap_err();

    assert!(matches!(erro, ErroDaProducao::Corte(_)), "{erro}");
    assert!(cenario.renders_de("c02") == 0, "{:?}", cenario.renders());
}

#[test]
fn o_render_recebe_as_abas_do_chrome() {
    let cenario = Cenario::novo();

    cenario.produzir(Qualidade::Final).unwrap();

    let render = &cenario.renders()[0];
    let abas: usize = render.rsplit(' ').next().unwrap().parse().unwrap();
    assert!(abas >= 1, "{render}");
}

#[test]
fn falha_do_render_vira_erro_com_a_ultima_linha_do_stderr() {
    let cenario = Cenario::novo();
    fs::write(cenario.bin().join("node-falha"), "").unwrap();

    let Err(erro) = cenario.produzir(Qualidade::Final) else {
        panic!("devia falhar");
    };

    assert!(erro.to_string().contains("chrome não abriu"), "{erro}");
}

#[test]
fn erro_nao_tratado_do_node_mostra_a_linha_do_erro_e_nao_a_versao() {
    let cenario = Cenario::novo();
    fs::write(cenario.bin().join("node-erro"), "").unwrap();

    let Err(erro) = cenario.produzir(Qualidade::Final) else {
        panic!("devia falhar");
    };

    let texto = erro.to_string();
    assert!(texto.contains("Error [ERR_MODULE_NOT_FOUND]"), "{texto}");
    assert!(!texto.contains("Node.js v"), "{texto}");
}

#[test]
fn sem_o_node_modules_compartilhado_falha_antes_de_chamar_o_node() {
    let cenario = Cenario::novo();
    let node_modules = cenario.pasta.join("remotion/node_modules");
    fs::remove_file(&node_modules).unwrap();
    std::os::unix::fs::symlink(cenario.tmp.path().join("nao-existe"), &node_modules).unwrap();

    let Err(erro) = cenario.produzir(Qualidade::Final) else {
        panic!("devia falhar");
    };

    assert!(
        erro.to_string()
            .contains("dependências do Remotion não instaladas"),
        "{erro}"
    );
    assert!(cenario.chamadas("node").is_empty());
}

#[test]
fn roteiro_invalido_nao_produz_nada() {
    let cenario = Cenario::novo();
    fs::write(
        cenario.pasta.join("edit/roteiro.json"),
        r#"{"cortes":[{"id":"c01","trechos":[]}]}"#,
    )
    .unwrap();

    let Err(erro) = cenario.produzir(Qualidade::Final) else {
        panic!("devia falhar");
    };

    assert!(erro.to_string().contains("roteiro inválido"), "{erro}");
    assert!(cenario.chamadas("node").is_empty());
}

#[test]
fn cancelar_antes_de_comecar_devolve_cancelado() {
    let cenario = Cenario::novo();
    let cancelar = AtomicBool::new(true);

    let resultado = cenario.producao.produzir(
        &Pedido {
            pasta: &cenario.pasta,
            video: &cenario.pasta.join("original.mp4"),
            qualidade: Qualidade::Final,
        },
        &cancelar,
        &mut |_| {},
    );

    assert!(matches!(resultado, Err(ErroDaProducao::Cancelada)));
}

/// Copia a pasta; o `node_modules` vira um symlink para o original, como no projeto que o app
/// monta.
fn copiar(origem: &Path, destino: &Path) {
    fs::create_dir_all(destino).unwrap();
    for entrada in fs::read_dir(origem).unwrap().map(Result::unwrap) {
        let alvo = destino.join(entrada.file_name());
        if entrada.file_name() == "node_modules" {
            std::os::unix::fs::symlink(entrada.path().canonicalize().unwrap(), alvo).unwrap();
        } else if entrada.path().is_dir() {
            copiar(&entrada.path(), &alvo);
        } else {
            fs::copy(entrada.path(), alvo).unwrap();
        }
    }
}

/// Com `ffmpeg`, `ffprobe`, `node` no `PATH`, as dependências do Remotion instaladas em
/// `SHORTS_REMOTION` (uma pasta de projeto montada) e um vídeo de 20 s com fala em
/// `SHORTS_VIDEO_20S`: `cargo test -- --ignored`.
#[test]
#[ignore = "precisa de ffmpeg, node, Remotion instalado e um vídeo de 20 s"]
fn com_os_programas_reais_um_video_de_20_s_gera_um_reel() {
    let (Some(remotion), Some(video)) = (
        std::env::var_os("SHORTS_REMOTION"),
        std::env::var_os("SHORTS_VIDEO_20S"),
    ) else {
        panic!("defina SHORTS_REMOTION e SHORTS_VIDEO_20S");
    };
    let tmp = tempfile::tempdir().unwrap();
    // A pasta do projeto leva o título do vídeo, e o webpack recusa caminho com `!`.
    let pasta = tmp.path().join("Não faça isso! (2026-10-18)");
    fs::create_dir_all(pasta.join("edit")).unwrap();
    copiar(Path::new(&remotion), &pasta.join("remotion"));
    let palavras: Vec<Value> = (0..20)
        .map(|n| json!({"text": if n == 19 { "fim." } else { "oi" }, "start": f64::from(n), "end": f64::from(n) + 0.9, "type": "word"}))
        .collect();
    fs::write(
        pasta.join("edit/transcricao.json"),
        json!({"words": palavras}).to_string(),
    )
    .unwrap();
    fs::write(
        pasta.join("edit/roteiro.json"),
        json!({"versao": 1, "fonte": "v.mp4", "cortes": [
            {"id": "c01", "status": "produzir", "titulo": "Teste", "trechos": [[0, 19.9]]}
        ]})
        .to_string(),
    )
    .unwrap();

    let reels = Producao::new(
        Ffmpeg::new("ffmpeg".into(), "ffprobe".into()),
        "node".into(),
    )
    .produzir(
        &Pedido {
            pasta: &pasta,
            video: Path::new(&video),
            qualidade: Qualidade::Previa,
        },
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();

    assert!(reels[0].arquivo.metadata().unwrap().len() > 10_000);
}

fn preparar_revisao(cenario: &Cenario, reels: &[nucleo::producao::Reel]) {
    cenario
        .producao
        .preparar_revisao(
            &Pedido {
                pasta: &cenario.pasta,
                video: &cenario.pasta.join("original.mp4"),
                qualidade: Qualidade::Final,
            },
            reels,
            &AtomicBool::new(false),
        )
        .unwrap();
}

#[test]
fn a_folha_de_revisao_junta_os_quadros_em_seis_colunas_com_o_tempo_marcado() {
    let cenario = Cenario::novo();
    let reels = cenario.produzir(Qualidade::Final).unwrap();

    preparar_revisao(&cenario, &reels);

    assert!(
        cenario
            .pasta
            .join("edit/cortes")
            .read_dir()
            .unwrap()
            .all(|corte| corte.unwrap().path().join("revisao.png").is_file())
    );
    let chamadas = cenario.chamadas("ffmpeg");
    let quadros: Vec<_> = chamadas.iter().filter(|c| c.contains("drawtext")).collect();
    // Início (0,6 s) e fim do c01 e do c02; a duração de cada um é de 2,4 s ou menos, sem motion.
    assert_eq!(quadros.len(), 4, "{quadros:?}");
    assert!(quadros[0].contains("-ss 0.600"), "{}", quadros[0]);
    assert!(quadros[0].contains("text='0.60s'"), "{}", quadros[0]);
    let folhas: Vec<_> = chamadas.iter().filter(|c| c.contains("tile=")).collect();
    assert_eq!(folhas.len(), 2);
    assert!(folhas[0].contains("tile=6x1"), "{}", folhas[0]);
}

#[test]
fn o_resumo_da_producao_lista_reels_folhas_e_avisos_para_a_revisao() {
    let cenario = Cenario::novo();
    let reels = cenario.produzir(Qualidade::Final).unwrap();

    preparar_revisao(&cenario, &reels);

    let resumo: Value = serde_json::from_str(
        &fs::read_to_string(cenario.pasta.join("edit/producao.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(resumo["reels"].as_array().unwrap().len(), 2);
    let primeiro = &resumo["reels"][0];
    assert_eq!(primeiro["id"], "c01");
    assert_eq!(primeiro["revisao"], "edit/cortes/original-c01/revisao.png");
    assert_eq!(
        primeiro["arquivo"],
        "publicar/c01 - Negociar salário tem regra.mp4"
    );
    assert_eq!(primeiro["instantes"][0], 0.6);
    // O reel: os 2,44 s do corte e 0,96 s de último quadro congelado.
    assert!((primeiro["duracao"].as_f64().unwrap() - 3.4).abs() < 1e-9);
    assert!(primeiro["avisos"].is_array());
    assert_eq!(resumo["erros"], json!([]));
}
