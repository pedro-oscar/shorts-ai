//! O lote em paralelo pela interface pública do núcleo: vários projetos andam ao mesmo tempo, e
//! cada etapa pega a vaga do recurso que disputa (a GPU, o Claude ou o render). Os programas são
//! falsos (scripts de shell) e se esperam por arquivos-marca, para provar o que roda junto.
#![cfg(unix)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use nucleo::{
    Config, EstadoDaEtapa, EstadoDaVaga, Etapa, Evento, MotivoDeNotificacao, NivelDoPlano, Nucleo,
    Padroes, Parada, PeriodoDeCobranca, Recurso,
};
use serde_json::json;

const FFPROBE: &str = r#"#!/bin/sh
case "$*" in
*format=duration*) echo 2.0 ;;
*) echo '{"streams":[{"width":256,"height":128}]}' ;;
esac
"#;

const FFMPEG: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
case "$*" in
*rawvideo*)
  for i in 1 2 3 4 5 6 7 8 9 10; do cat "$dir/quadro.rgb"; done
  exit 0 ;;
*signalstats*)
  echo "lavfi.signalstats.YAVG=120"
  exit 0 ;;
*print_format=json*)
  cat "$dir/loudnorm.json" >&2
  exit 0 ;;
*"-f null"*) exit 0 ;;
esac
for ultimo; do :; done
echo dados > "$ultimo"
"#;

/// Registra cada chamada com a pasta do projeto. Dois renders juntos ficam em `renders-juntos`;
/// com a marca `esperar-sessao`, o render espera uma sessão do Claude começar e vê-lo.
const NODE: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
echo "$PWD: $2" >> "$dir/node.log"
case "$2" in
pacote) mkdir -p "$3" ;;
render)
  [ -e "$dir/render.trava" ] && echo "$PWD" >> "$dir/renders-juntos"
  touch "$dir/render.trava" "$dir/renderizando"
  if [ -f "$dir/esperar-sessao" ]; then
    i=0
    while [ $i -lt 100 ] && [ ! -f "$dir/sessao" ]; do sleep 0.1; i=$((i+1)); done
    [ -f "$dir/sessao" ] && touch "$dir/render-viu-sessao"
    # E segue renderizando até a sessão ver o render.
    i=0
    while [ $i -lt 100 ] && [ ! -f "$dir/sessao-viu-render" ]; do sleep 0.1; i=$((i+1)); done
  else
    sleep 0.2
  fi
  rm -f "$dir/render.trava" "$dir/renderizando"
  echo "progresso 0.500"
  echo reel > "$6" ;;
esac
"#;

/// Uma sessão do Claude que registra a pasta, anota se começou com um render rodando e, conforme
/// as marcas, espera um render (`esperar-render`) ou a marca `liberar` (`segurar`). Devolve o
/// `stream.jsonl`, se houver, e sai com erro: o roteiro não importa aqui.
const CLAUDE: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
pwd >> "$dir/claude.log"
cat > /dev/null
[ -f "$dir/renderizando" ] && touch "$dir/sobrepos"
touch "$dir/sessao"
if [ -f "$dir/esperar-render" ]; then
  i=0
  while [ $i -lt 100 ] && [ ! -f "$dir/renderizando" ]; do sleep 0.1; i=$((i+1)); done
  [ -f "$dir/renderizando" ] && touch "$dir/sessao-viu-render"
fi
if [ -f "$dir/segurar" ]; then
  i=0
  while [ $i -lt 300 ] && [ ! -f "$dir/liberar" ]; do sleep 0.1; i=$((i+1)); done
fi
[ -f "$dir/stream.jsonl" ] && cat "$dir/stream.jsonl"
exit 1
"#;

const LOUDNORM: &str = r#"{"input_i":"-20.0","input_tp":"-3.0","input_lra":"5.0","input_thresh":"-30.0","target_offset":"0.5"}"#;

const LOTE: &str = "2026-10-19T10-00-00";

/// Grava o executável falso uma vez por processo, numa pasta que ninguém mais escreve, e o liga
/// em `bin` por um link: gravar e executar o mesmo arquivo enquanto outros testes criam
/// processos dá "Text file busy". O arquivo leva o hash do conteúdo, porque o mesmo nome pode
/// ter scripts diferentes.
fn executavel(bin: &Path, nome: &str, conteudo: &str) {
    use std::hash::{DefaultHasher, Hash, Hasher};
    use std::os::unix::fs::PermissionsExt;
    use std::sync::{Mutex, OnceLock, PoisonError};

    static COMPARTILHADOS: OnceLock<tempfile::TempDir> = OnceLock::new();
    static TRAVA: Mutex<()> = Mutex::new(());
    let mut hash = DefaultHasher::new();
    conteudo.hash(&mut hash);
    let original = COMPARTILHADOS
        .get_or_init(|| tempfile::tempdir().unwrap())
        .path()
        .join(format!("{:016x}", hash.finish()));
    {
        let _trava = TRAVA.lock().unwrap_or_else(PoisonError::into_inner);
        if !original.exists() {
            std::fs::write(&original, conteudo).unwrap();
            std::fs::set_permissions(&original, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    std::os::unix::fs::symlink(original, bin.join(nome)).unwrap();
}

struct Cenario {
    tmp: tempfile::TempDir,
    biblioteca: PathBuf,
    nucleo: Nucleo,
    eventos: mpsc::Receiver<Evento>,
    /// Os eventos que já vieram, na ordem.
    vistos: Vec<Evento>,
}

impl Cenario {
    /// O núcleo com os programas falsos e o plano `nivel` confirmado: Max deixa quatro vídeos e
    /// duas sessões do Claude ao mesmo tempo; Pro, três vídeos e uma sessão.
    fn novo(nivel: NivelDoPlano) -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("bin");
        fs::create_dir(&bin).unwrap();
        for (nome, conteudo) in [
            ("ffmpeg", FFMPEG),
            ("ffprobe", FFPROBE),
            ("node", NODE),
            ("claude", CLAUDE),
        ] {
            executavel(&bin, nome, conteudo);
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
        let videos = tmp.path().join("Videos");
        let biblioteca = videos.join("Shorts AI");
        fs::create_dir_all(biblioteca.join(".lotes")).unwrap();
        let (envio, eventos) = mpsc::channel();
        let envio = Mutex::new(envio);
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: tmp.path().join("dados"),
                pasta_de_videos: Some(videos),
                path_env: Some(bin.clone().into_os_string()),
                assets_dir: Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../assets")),
                sidecar_dir: Some(bin),
                node: Some(tmp.path().join("bin/node")),
                ..Config::default()
            },
            move |evento| {
                let _ = envio.lock().unwrap().send(evento);
            },
        );
        nucleo
            .confirmar_plano(nivel, PeriodoDeCobranca::Mensal)
            .unwrap();
        Self {
            tmp,
            biblioteca,
            nucleo,
            eventos,
            vistos: Vec::new(),
        }
    }

    fn bin(&self) -> PathBuf {
        self.tmp.path().join("bin")
    }

    fn marcar(&self, nome: &str) {
        fs::write(self.bin().join(nome), "").unwrap();
    }

    fn marcado(&self, nome: &str) -> bool {
        self.bin().join(nome).exists()
    }

    fn chamadas(&self, programa: &str) -> Vec<String> {
        fs::read_to_string(self.bin().join(format!("{programa}.log")))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// Um projeto pausado do lote, com as etapas antes de `recomeca_em` concluídas, dois cortes
    /// no roteiro e `revisoes` rodadas de revisão. Devolve o id.
    fn projeto(&self, titulo: &str, recomeca_em: Etapa, revisoes: u8) -> String {
        let id = format!("{titulo} (2026-10-19)");
        let pasta = self.biblioteca.join(&id);
        fs::create_dir_all(pasta.join("edit")).unwrap();
        fs::create_dir_all(pasta.join("remotion/src")).unwrap();
        fs::create_dir_all(pasta.join("remotion/node_modules")).unwrap();
        fs::write(pasta.join("remotion/src/Root.tsx"), "root").unwrap();
        fs::write(pasta.join("remotion/package.json"), "{}").unwrap();
        let video = self.tmp.path().join(format!("{titulo}.mp4"));
        fs::write(&video, b"video").unwrap();
        let recomeco = Etapa::TODAS
            .iter()
            .position(|etapa| *etapa == recomeca_em)
            .unwrap();
        let etapas: Vec<_> = Etapa::TODAS
            .iter()
            .enumerate()
            .map(|(posicao, etapa)| {
                json!({
                    "etapa": etapa,
                    "estado": if posicao < recomeco { "concluida" } else { "pendente" }
                })
            })
            .collect();
        fs::write(
            pasta.join("projeto.json"),
            json!({
                "versao": 1,
                "titulo": titulo,
                "lote": LOTE,
                "criadoEm": "2026-10-19T10:00:00Z",
                "origem": {
                    "tipo": "arquivo",
                    "caminho": video.display().to_string(),
                    "nome": format!("{titulo}.mp4"),
                    "tamanho": 5
                },
                "idiomaDoVideo": "pt",
                "opcoes": {
                    "quantidadeDeReels": 2,
                    "previa": true,
                    "pedido": "",
                    "revisoes": revisoes,
                    "modelo": "padrao",
                    "nomesProprios": []
                },
                "etapas": etapas,
                "parada": "pausado"
            })
            .to_string(),
        )
        .unwrap();
        let palavras: Vec<_> = (0..10)
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
        fs::write(
            pasta.join("edit/roteiro.json"),
            json!({"versao": 1, "fonte": format!("{titulo}.mp4"), "cortes": [
                {"id": "c01", "status": "produzir", "titulo": "Negociar", "trechos": [[0.0, 2.4]]},
                {"id": "c02", "status": "produzir", "titulo": "Regra", "trechos": [[2.5, 4.9]]}
            ]})
            .to_string(),
        )
        .unwrap();
        id
    }

    /// Grava o lote com os projetos e os põe na fila, nesta ordem.
    fn rodar(&self, projetos: &[&str]) {
        fs::write(
            self.biblioteca.join(format!(".lotes/{LOTE}.json")),
            json!({
                "id": LOTE,
                "nome": "Lote de teste",
                "criadoEm": "2026-10-19T10:00:00Z",
                "padroes": Padroes::default(),
                "projetos": projetos,
            })
            .to_string(),
        )
        .unwrap();
        for projeto in projetos {
            self.nucleo.retomar(projeto).unwrap();
        }
    }

    /// Recebe eventos até `condicao` valer para os que já vieram, ou falha depois de 20 s.
    fn ate(&mut self, condicao: impl Fn(&[Evento]) -> bool) {
        let limite = Instant::now() + Duration::from_secs(20);
        while !condicao(&self.vistos) {
            let resta = limite.saturating_duration_since(Instant::now());
            let evento = self
                .eventos
                .recv_timeout(resta)
                .unwrap_or_else(|_| panic!("a condição não chegou; eventos: {:#?}", self.vistos));
            self.vistos.push(evento);
        }
    }

    /// Recebe o que mais vier em `tempo`.
    fn recolher(&mut self, tempo: Duration) {
        let limite = Instant::now() + tempo;
        while let Ok(evento) = self
            .eventos
            .recv_timeout(limite.saturating_duration_since(Instant::now()))
        {
            self.vistos.push(evento);
        }
    }

    fn estado(&self, id: &str, etapa: Etapa) -> EstadoDaEtapa {
        self.nucleo
            .lotes()
            .into_iter()
            .flat_map(|lote| lote.projetos)
            .find(|projeto| projeto.id == id)
            .unwrap()
            .etapas
            .into_iter()
            .find(|item| item.etapa == etapa)
            .unwrap()
            .estado
    }
}

/// Os projetos que terminaram o que podiam fazer: pronto, falhou ou aguardando a cota.
fn terminados(eventos: &[Evento]) -> usize {
    eventos
        .iter()
        .filter(|evento| {
            matches!(
                evento,
                Evento::Notificacao {
                    motivo: MotivoDeNotificacao::ProjetoPronto | MotivoDeNotificacao::ProjetoFalhou,
                    ..
                }
            )
        })
        .count()
}

fn notificacoes(eventos: &[Evento], motivo: MotivoDeNotificacao) -> usize {
    eventos
        .iter()
        .filter(|evento| matches!(evento, Evento::Notificacao { motivo: m, .. } if *m == motivo))
        .count()
}

fn parou(eventos: &[Evento], id: &str, parada: Parada) -> bool {
    eventos.iter().any(|evento| {
        matches!(evento, Evento::ParadaMudou { projeto, parada: Some(p) } if projeto == id && *p == parada)
    })
}

#[test]
fn o_claude_de_um_projeto_roda_enquanto_o_outro_renderiza() {
    let mut cenario = Cenario::novo(NivelDoPlano::Max20x);
    let renderiza = cenario.projeto("Renderiza", Etapa::Producao, 0);
    let roteiriza = cenario.projeto("Roteiriza", Etapa::Roteiro, 0);
    cenario.marcar("esperar-sessao");
    cenario.marcar("esperar-render");

    cenario.rodar(&[&renderiza, &roteiriza]);
    cenario.ate(|eventos| terminados(eventos) == 2);

    assert!(
        cenario.marcado("render-viu-sessao"),
        "o render não viu a sessão"
    );
    assert!(
        cenario.marcado("sessao-viu-render"),
        "a sessão não viu o render"
    );
}

#[test]
fn com_um_video_de_cada_vez_o_claude_espera_o_render_terminar() {
    let mut cenario = Cenario::novo(NivelDoPlano::Max20x);
    let paralelismo = cenario
        .nucleo
        .definir_videos_ao_mesmo_tempo(Some(1))
        .unwrap();
    assert_eq!(paralelismo.videos_ao_mesmo_tempo, Some(1));
    let renderiza = cenario.projeto("Renderiza", Etapa::Producao, 0);
    let roteiriza = cenario.projeto("Roteiriza", Etapa::Roteiro, 0);

    cenario.rodar(&[&renderiza, &roteiriza]);
    cenario.ate(|eventos| terminados(eventos) == 2);

    assert!(
        !cenario.marcado("sobrepos"),
        "a sessão começou com um render rodando"
    );
    assert_eq!(cenario.chamadas("claude").len(), 1);
}

#[test]
fn dois_projetos_nunca_renderizam_ao_mesmo_tempo_e_cada_um_renderiza_tudo_de_uma_vez() {
    let mut cenario = Cenario::novo(NivelDoPlano::Max20x);
    let a = cenario.projeto("A", Etapa::Producao, 0);
    let b = cenario.projeto("B", Etapa::Producao, 0);

    cenario.rodar(&[&a, &b]);
    cenario.ate(|eventos| terminados(eventos) == 2);

    assert!(
        !cenario.marcado("renders-juntos"),
        "dois renders rodaram juntos"
    );
    let renders: Vec<String> = cenario
        .chamadas("node")
        .into_iter()
        .filter(|chamada| chamada.ends_with(": render"))
        .map(|chamada| chamada.split("/remotion").next().unwrap().to_owned())
        .collect();
    assert_eq!(renders.len(), 4, "{renders:?}");
    // A vaga do render fica com o projeto até o fim da Produção dele.
    assert_eq!(renders[0], renders[1], "{renders:?}");
    assert_eq!(renders[2], renders[3], "{renders:?}");
    assert_ne!(renders[0], renders[2], "{renders:?}");
}

#[test]
fn a_versao_final_espera_a_revisao_do_mesmo_projeto_terminar() {
    let mut cenario = Cenario::novo(NivelDoPlano::Max20x);
    let id = cenario.projeto("Revisa", Etapa::Revisao, 1);
    cenario.marcar("segurar");

    cenario.rodar(&[&id]);
    let limite = Instant::now() + Duration::from_secs(20);
    while cenario.chamadas("claude").is_empty() {
        assert!(Instant::now() < limite, "a sessão da Revisão não começou");
        thread::sleep(Duration::from_millis(20));
    }
    cenario
        .nucleo
        .gerar_versao_final(std::slice::from_ref(&id))
        .unwrap();
    cenario.recolher(Duration::from_millis(500));
    let comecou = |eventos: &[Evento]| {
        eventos.iter().position(|evento| {
            matches!(
                evento,
                Evento::VersaoFinalMudou {
                    estado: EstadoDaEtapa::EmAndamento,
                    ..
                }
            )
        })
    };
    assert_eq!(
        comecou(&cenario.vistos),
        None,
        "a versão final começou com a Revisão rodando"
    );

    cenario.marcar("liberar");
    cenario.ate(|eventos| {
        eventos.iter().any(|evento| {
            matches!(
                evento,
                Evento::VersaoFinalMudou {
                    estado: EstadoDaEtapa::Concluida | EstadoDaEtapa::Falhou,
                    ..
                }
            )
        })
    });
    let fim_da_revisao = cenario
        .vistos
        .iter()
        .position(|evento| {
            matches!(
                evento,
                Evento::EtapaMudou {
                    etapa: Etapa::Revisao,
                    estado: EstadoDaEtapa::Falhou,
                    ..
                }
            )
        })
        .expect("a Revisão não terminou");
    assert!(comecou(&cenario.vistos).unwrap() > fim_da_revisao);
}

#[test]
fn pausar_quem_espera_a_vaga_do_claude_o_para_pendente_e_interromper_pausa_os_que_rodam() {
    let mut cenario = Cenario::novo(NivelDoPlano::Max20x);
    let ids: Vec<String> = ["A", "B", "C"]
        .iter()
        .map(|titulo| cenario.projeto(titulo, Etapa::Roteiro, 0))
        .collect();
    cenario.marcar("segurar");

    cenario.rodar(&ids.iter().map(String::as_str).collect::<Vec<_>>());
    // Duas sessões cabem no Max; o terceiro espera a vaga.
    cenario.ate(|eventos| {
        eventos.iter().any(|evento| {
            matches!(
                evento,
                Evento::VagaMudou {
                    recurso: Recurso::Claude,
                    estado: EstadoDaVaga::Esperando,
                    ..
                }
            )
        })
    });
    let esperando = cenario
        .vistos
        .iter()
        .find_map(|evento| match evento {
            Evento::VagaMudou {
                projeto,
                estado: EstadoDaVaga::Esperando,
                ..
            } => Some(projeto.clone()),
            _ => None,
        })
        .unwrap();

    cenario.nucleo.pausar(&esperando).unwrap();
    cenario.ate(|eventos| parou(eventos, &esperando, Parada::Pausado));
    assert_eq!(
        cenario.estado(&esperando, Etapa::Roteiro),
        EstadoDaEtapa::Pendente
    );
    let comecou_o_roteiro = cenario.vistos.iter().any(|evento| {
        matches!(
            evento,
            Evento::EtapaMudou { projeto, etapa: Etapa::Roteiro, estado: EstadoDaEtapa::EmAndamento, .. }
                if *projeto == esperando
        )
    });
    assert!(
        !comecou_o_roteiro,
        "quem esperava a vaga não pode ter começado o Roteiro"
    );

    cenario.nucleo.interromper();
    let rodando: Vec<&String> = ids.iter().filter(|id| **id != esperando).collect();
    cenario.ate(|eventos| rodando.iter().all(|id| parou(eventos, id, Parada::Pausado)));
    for id in &ids {
        assert_eq!(
            cenario.estado(id, Etapa::Roteiro),
            EstadoDaEtapa::Pendente,
            "{id}"
        );
    }
}

#[test]
fn a_cota_que_acaba_numa_sessao_para_quem_espera_o_claude_sem_abrir_sessao_e_avisa_uma_vez() {
    let mut cenario = Cenario::novo(NivelDoPlano::Pro);
    let a = cenario.projeto("A", Etapa::Roteiro, 0);
    let b = cenario.projeto("B", Etapa::Roteiro, 0);
    fs::write(
        cenario.bin().join("stream.jsonl"),
        "{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"rejected\",\"resetsAt\":4102444800}}\n\
         {\"type\":\"result\",\"subtype\":\"success\",\"is_error\":true,\"result\":\"limite\",\"total_cost_usd\":0.1}\n",
    )
    .unwrap();

    cenario.rodar(&[&a, &b]);
    cenario.ate(|eventos| {
        parou(eventos, &a, Parada::AguardandoCota) && parou(eventos, &b, Parada::AguardandoCota)
    });
    cenario.recolher(Duration::from_millis(300));

    assert_eq!(
        cenario.chamadas("claude").len(),
        1,
        "só uma sessão chega a abrir"
    );
    assert_eq!(
        notificacoes(&cenario.vistos, MotivoDeNotificacao::AguardandoCota),
        1
    );
}

#[test]
fn dois_projetos_do_lote_terminando_juntos_avisam_o_fim_do_lote_uma_vez() {
    // Os dois terminam quase no mesmo instante; algumas rodadas para pegar a corrida.
    for _ in 0..8 {
        let mut cenario = Cenario::novo(NivelDoPlano::Max20x);
        let a = cenario.projeto("A", Etapa::Revisao, 0);
        let b = cenario.projeto("B", Etapa::Revisao, 0);

        cenario.rodar(&[&a, &b]);
        cenario.ate(|eventos| notificacoes(eventos, MotivoDeNotificacao::ProjetoPronto) == 2);
        cenario.recolher(Duration::from_millis(200));

        assert_eq!(
            notificacoes(&cenario.vistos, MotivoDeNotificacao::LoteTerminado),
            1,
            "{:#?}",
            cenario.vistos
        );
    }
}
