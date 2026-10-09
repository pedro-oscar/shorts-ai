//! A Transcrição pela interface pública do núcleo: a leitura da tabela do VAD e a volta dos
//! tempos ao áudio original, as palavras e a transcrição compactada por casos de referência, e
//! a orquestração com `ffmpeg` e `whisper-cli` falsos que devolvem a gravação do spike
//! (KGfmaHnBQx4). O teste lento (`--ignored`) usa o motor real num vídeo de 20 s.

use std::path::PathBuf;

use nucleo::transcricao::{
    PalavraTranscrita, SegmentoDoVad, compactar, para_o_original, percentual_do_progresso, prompt,
    segmentos_do_vad,
};

fn gravado(nome: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.scratch/shorts-ai-mvp/spike-transcricao/gravado")
        .join(nome)
}

fn vad_gravado() -> Vec<SegmentoDoVad> {
    segmentos_do_vad(&std::fs::read_to_string(gravado("whisper.log")).unwrap())
}

fn palavra(texto: &str, inicio: f64, fim: f64) -> PalavraTranscrita {
    PalavraTranscrita {
        texto: texto.to_owned(),
        inicio,
        fim,
        tipo: "word".to_owned(),
        falante: "speaker_0".to_owned(),
        probabilidade: 1.0,
    }
}

#[test]
fn a_tabela_do_vad_sai_do_stderr_em_centesimos() {
    let vad = vad_gravado();

    assert_eq!(vad.len(), 6);
    assert_eq!(
        vad[1],
        SegmentoDoVad {
            inicio_original: 10613,
            fim_original: 20562,
            inicio_cortado: 10492,
            fim_cortado: 20441,
        }
    );
}

#[test]
fn sem_a_tabela_do_vad_os_tempos_ficam_como_estao() {
    assert_eq!(segmentos_do_vad("whisper_init: nada\n"), []);
    assert_eq!(para_o_original(12345, &[]), 12345);
}

#[test]
fn o_tempo_do_audio_cortado_volta_ao_original_pela_regra_do_whisper_cpp() {
    let vad = vad_gravado();

    // Dentro do primeiro segmento nada muda; no segundo, soma o silêncio removido (1,21 s).
    assert_eq!(para_o_original(5000, &vad), 5000);
    assert_eq!(para_o_original(15000, &vad), 15121);
    // No silêncio removido encosta na borda mais próxima: entre 104,92 e 104,82 cortado.
    assert_eq!(para_o_original(10482, &vad), 10472);
    assert_eq!(para_o_original(10490, &vad), 10613);
    // Antes do primeiro e depois do último.
    assert_eq!(para_o_original(0, &vad), 0);
    assert_eq!(para_o_original(99999, &vad), 74384);
}

#[test]
fn o_progresso_sai_da_linha_do_callback_do_whisper_cpp() {
    assert_eq!(
        percentual_do_progresso("whisper_print_progress_callback: progress =  10%"),
        Some(10.0)
    );
    assert_eq!(
        percentual_do_progresso("whisper_print_progress_callback: progress = 100%"),
        Some(100.0)
    );
    assert_eq!(percentual_do_progresso("whisper_vad: nada"), None);
}

#[test]
fn o_prompt_verbatim_segue_o_idioma_do_video_e_leva_os_nomes_proprios() {
    let nomes = [
        "Renato Cardoso".to_owned(),
        " ".to_owned(),
        "Shorts".to_owned(),
    ];

    let pt = prompt("pt", &nomes).unwrap();
    assert!(pt.starts_with("Ahn, então, tipo"));
    assert!(pt.ends_with("Renato Cardoso, Shorts"));
    assert!(prompt("en", &[]).unwrap().starts_with("Um, so, like"));
    assert_eq!(
        prompt("es", &nomes).as_deref(),
        Some("Renato Cardoso, Shorts")
    );
    assert_eq!(prompt("es", &[]), None);
}

#[test]
fn a_transcricao_compactada_separa_as_frases_por_pausas_de_meio_segundo() {
    let palavras = [
        palavra("Eu", 0.0, 0.4),
        palavra("tinha", 0.4, 0.9),
        // Pausa de 0,49 s: a frase continua.
        palavra("treze", 1.39, 1.8),
        // Pausa de exatos 0,5 s: a frase acaba.
        palavra("anos.", 2.3, 2.8),
        palavra("Aí", 5.0, 5.25),
    ];

    assert_eq!(
        compactar(&palavras),
        "[0.00-1.80] Eu tinha treze\n[2.30-2.80] anos.\n[5.00-5.25] Aí\n"
    );
    assert_eq!(compactar(&[]), "");
}

#[cfg(unix)]
mod orquestracao {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};

    use nucleo::transcricao::{ErroDaTranscricao, Pedido, Transcricao, Transcritor};

    use super::gravado;

    /// O ffmpeg falso grava um arquivo no último argumento; o `sleep-forever` o trava.
    const FFMPEG: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
echo "$@" >> "$dir/ffmpeg.log"
case "$*" in
*sleep-forever*) exec sleep 30 ;;
esac
for ultimo; do :; done
head -c 3200000 /dev/zero > "$ultimo"
"#;

    /// O whisper-cli falso lê o arquivo de resposta, devolve a gravação do spike no `-of` e o
    /// log dela no stderr, com o progresso do `-pp`.
    const WHISPER: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
case "$1" in
@*) args="${1#@}" ;;
*) args="" ;;
esac
if [ -n "$args" ]; then
  cp "$args" "$dir/argumentos-$(date +%s%N).txt"
  cat "$args" | tr '\n' ' ' >> "$dir/whisper.log"
  echo >> "$dir/whisper.log"
  saida="$(grep -A1 '^-of$' "$args" | tail -1)"
else
  echo "$@" >> "$dir/whisper.log"
  while [ $# -gt 0 ]; do [ "$1" = "-of" ] && saida="$2"; shift; done
fi
case "$saida" in *sleep-forever*) exec sleep 30 ;; esac
[ -f "$dir/falha" ] && { echo "falha de teste" >&2; exit 3; }
cp "$dir/gravado.json" "$saida.json"
echo "whisper_print_progress_callback: progress =  10%" >&2
echo "whisper_print_progress_callback: progress =  50%" >&2
cat "$dir/gravado.log" >&2
echo "whisper_print_progress_callback: progress = 100%" >&2
"#;

    struct Cenario {
        tmp: tempfile::TempDir,
        transcritor: Transcritor,
        video: PathBuf,
        edit: PathBuf,
    }

    impl Cenario {
        fn novo() -> Self {
            let tmp = tempfile::tempdir().unwrap();
            let bin = tmp.path().join("bin");
            fs::create_dir(&bin).unwrap();
            for (nome, conteudo) in [("ffmpeg", FFMPEG), ("whisper-cli", WHISPER)] {
                let caminho = bin.join(nome);
                fs::write(&caminho, conteudo).unwrap();
                fs::set_permissions(&caminho, fs::Permissions::from_mode(0o755)).unwrap();
            }
            fs::copy(gravado("transcricao.json"), bin.join("gravado.json")).unwrap();
            fs::copy(gravado("whisper.log"), bin.join("gravado.log")).unwrap();
            let video = tmp.path().join("original.mp4");
            fs::write(&video, b"x").unwrap();
            let transcritor = Transcritor::new(
                bin.join("ffmpeg"),
                bin.join("whisper-cli"),
                "modelo.bin".into(),
                "vad.bin".into(),
            );
            let edit = tmp.path().join("edit");
            Self {
                tmp,
                transcritor,
                video,
                edit,
            }
        }

        fn bin(&self) -> PathBuf {
            self.tmp.path().join("bin")
        }

        fn chamadas_do_whisper(&self) -> Vec<String> {
            fs::read_to_string(self.bin().join("whisper.log"))
                .unwrap_or_default()
                .lines()
                .map(str::to_owned)
                .collect()
        }

        fn transcrever(
            &self,
            idioma: Option<&str>,
            fracoes: &mut Vec<f64>,
        ) -> Result<Transcricao, ErroDaTranscricao> {
            let nomes = ["Renato Cardoso".to_owned()];
            self.transcritor.transcrever(
                &Pedido {
                    video: &self.video,
                    pasta_de_saida: &self.edit,
                    idioma,
                    nomes_proprios: &nomes,
                },
                &AtomicBool::new(false),
                &mut |f| fracoes.push(f),
            )
        }
    }

    #[test]
    fn as_palavras_batem_com_as_do_medir_mjs_do_spike() {
        let cenario = Cenario::novo();

        let transcricao = cenario.transcrever(Some("pt"), &mut Vec::new()).unwrap();

        let esperado: Vec<(String, f64, f64)> = serde_json::from_str(
            &fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/dados/palavras-do-medir.json"
            ))
            .unwrap(),
        )
        .unwrap();
        let obtido: Vec<_> = transcricao
            .palavras
            .iter()
            .map(|p| (p.texto.as_str(), p.inicio, p.fim))
            .collect();
        assert_eq!(obtido.len(), esperado.len());
        for (obtido, esperado) in obtido.iter().zip(&esperado) {
            assert_eq!(obtido.0, esperado.0);
            assert!(
                (obtido.1 - esperado.1).abs() < 1e-9,
                "{obtido:?} {esperado:?}"
            );
            assert!(
                (obtido.2 - esperado.2).abs() < 1e-9,
                "{obtido:?} {esperado:?}"
            );
        }
    }

    #[test]
    fn os_tempos_sao_monotonicos_com_pelo_menos_50_ms_por_palavra() {
        let cenario = Cenario::novo();

        let transcricao = cenario.transcrever(Some("pt"), &mut Vec::new()).unwrap();

        let mut anterior = 0.0;
        for p in &transcricao.palavras {
            assert!(p.inicio >= anterior, "{p:?} começa antes de {anterior}");
            assert!(p.fim - p.inicio >= 0.0499, "{p:?} dura menos de 50 ms");
            assert!((0.0..=1.0).contains(&p.probabilidade), "{p:?}");
            assert_eq!(p.tipo, "word");
            assert_eq!(p.falante, "speaker_0");
            anterior = p.fim;
        }
        assert!(transcricao.palavras.len() > 1600);
    }

    #[test]
    fn grava_o_json_por_palavra_e_a_transcricao_compactada() {
        let cenario = Cenario::novo();

        cenario.transcrever(Some("pt"), &mut Vec::new()).unwrap();

        let json: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(cenario.edit.join("transcricao.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(json["language_code"], "pt");
        let primeira = &json["words"][0];
        assert_eq!(primeira["text"], "Eu");
        assert_eq!(primeira["start"], 0.09);
        assert_eq!(primeira["type"], "word");
        assert_eq!(primeira["speaker_id"], "speaker_0");
        assert!(primeira["logprob"].as_f64().unwrap() > 0.9);
        let compacta = fs::read_to_string(cenario.edit.join("transcricao-compactada.txt")).unwrap();
        assert!(compacta.starts_with("[0.09-"), "{compacta:.80}");
        assert!(compacta.lines().count() > 50);
        assert!(compacta.lines().all(|l| l.starts_with('[')));
        // A pasta de trabalho não fica para trás.
        assert!(!cenario.edit.join(".transcricao").exists());
    }

    #[test]
    fn o_idioma_definido_e_respeitado_e_nao_roda_a_deteccao() {
        let cenario = Cenario::novo();

        cenario.transcrever(Some("en"), &mut Vec::new()).unwrap();

        let chamadas = cenario.chamadas_do_whisper();
        assert_eq!(chamadas.len(), 1, "{chamadas:?}");
        let chamada = &chamadas[0];
        assert!(chamada.contains("-l en "), "{chamada}");
        assert!(chamada.contains("--prompt Um, so, like"), "{chamada}");
        assert!(
            chamada.contains("Renato Cardoso --carry-initial-prompt"),
            "{chamada}"
        );
        for opcao in [
            "--vad ",
            "-vm vad.bin",
            "--vad-min-silence-duration-ms 2000",
            "--vad-speech-pad-ms 400",
            "-ojf",
            "-dtw large.v3",
            "-nfa",
            "-pp",
        ] {
            assert!(chamada.contains(opcao), "faltou {opcao}: {chamada}");
        }
    }

    #[test]
    fn sem_idioma_definido_detecta_o_do_video_e_o_usa() {
        let cenario = Cenario::novo();

        let transcricao = cenario.transcrever(None, &mut Vec::new()).unwrap();

        assert_eq!(transcricao.idioma, "pt");
        let chamadas = cenario.chamadas_do_whisper();
        assert_eq!(chamadas.len(), 2, "{chamadas:?}");
        assert!(chamadas[0].contains("-l auto"), "{}", chamadas[0]);
        assert!(!chamadas[0].contains("--vad"), "{}", chamadas[0]);
        assert!(chamadas[1].contains("-l pt "), "{}", chamadas[1]);
        assert!(
            chamadas[1].contains("--prompt Ahn, então, tipo"),
            "{}",
            chamadas[1]
        );
    }

    #[test]
    fn o_audio_vai_do_ffmpeg_em_16_khz_mono() {
        let cenario = Cenario::novo();

        cenario.transcrever(Some("pt"), &mut Vec::new()).unwrap();

        let log = fs::read_to_string(cenario.bin().join("ffmpeg.log")).unwrap();
        let extracao = log.lines().next().unwrap();
        assert!(
            extracao.contains("-vn -ac 1 -ar 16000 -c:a pcm_s16le"),
            "{extracao}"
        );
    }

    #[test]
    fn o_progresso_chega_em_fracoes_e_termina_em_1() {
        let cenario = Cenario::novo();
        let mut fracoes = Vec::new();

        cenario.transcrever(Some("pt"), &mut fracoes).unwrap();

        assert!(fracoes.contains(&0.1) && fracoes.contains(&0.5));
        assert_eq!(fracoes.last(), Some(&1.0));
        assert!(
            fracoes.windows(2).all(|par| par[0] <= par[1]),
            "{fracoes:?}"
        );
    }

    #[test]
    fn falha_do_whisper_vira_erro_com_a_ultima_linha_do_stderr() {
        let cenario = Cenario::novo();
        fs::write(cenario.bin().join("falha"), "").unwrap();

        let erro = cenario
            .transcrever(Some("pt"), &mut Vec::new())
            .unwrap_err();

        assert!(matches!(
            &erro,
            ErroDaTranscricao::Falhou { programa: "whisper-cli", detalhe } if detalhe == "falha de teste"
        ));
        assert!(!cenario.edit.join("transcricao.json").exists());
    }

    #[test]
    fn cancelar_mata_o_whisper_em_curso() {
        let cenario = Cenario::novo();
        // O whisper falso trava quando o caminho de saída pede.
        let video = cenario.tmp.path().join("sleep-forever.mp4");
        fs::write(&video, b"x").unwrap();
        let edit = cenario.tmp.path().join("sleep-forever");
        let cancelar = AtomicBool::new(false);
        let inicio = Instant::now();

        let erro = std::thread::scope(|escopo| {
            let tarefa = escopo.spawn(|| {
                cenario.transcritor.transcrever(
                    &Pedido {
                        video: &video,
                        pasta_de_saida: &edit,
                        idioma: Some("pt"),
                        nomes_proprios: &[],
                    },
                    &cancelar,
                    &mut |_| {},
                )
            });
            std::thread::sleep(Duration::from_millis(500));
            cancelar.store(true, Ordering::Relaxed);
            tarefa.join().unwrap()
        })
        .unwrap_err();

        assert!(matches!(erro, ErroDaTranscricao::Cancelado), "{erro:?}");
        assert!(inicio.elapsed() < Duration::from_secs(10));
    }
}

#[cfg(unix)]
mod na_fila {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Mutex;
    use std::sync::mpsc;
    use std::time::Duration;

    use nucleo::transcricao::Transcritor;
    use nucleo::{Config, EstadoDaEtapa, Etapa, Evento, Nucleo};

    use super::gravado;

    #[test]
    fn a_etapa_transcreve_grava_o_idioma_no_projeto_e_avisa_o_progresso() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("bin");
        fs::create_dir(&bin).unwrap();
        fs::write(
            bin.join("ffmpeg"),
            "#!/bin/sh\nfor u; do :; done\nhead -c 3200000 /dev/zero > \"$u\"\n",
        )
        .unwrap();
        fs::write(
            bin.join("whisper-cli"),
            format!(
                "#!/bin/sh\ncase \"$1\" in\n\
                 @*) saida=\"$(grep -A1 '^-of$' \"${{1#@}}\" | tail -1)\" ;;\n\
                 *) while [ $# -gt 0 ]; do [ \"$1\" = \"-of\" ] && saida=\"$2\"; shift; done ;;\n\
                 esac\n\
                 cp '{}' \"$saida.json\"\n\
                 echo 'progress =  40%' >&2\ncat '{}' >&2\n",
                gravado("transcricao.json").display(),
                gravado("whisper.log").display()
            ),
        )
        .unwrap();
        for nome in ["ffmpeg", "whisper-cli"] {
            fs::set_permissions(bin.join(nome), fs::Permissions::from_mode(0o755)).unwrap();
        }
        let (envio, eventos) = mpsc::channel();
        let envio = Mutex::new(envio);
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: tmp.path().join("dados"),
                pasta_de_videos: Some(tmp.path().join("Videos")),
                transcritor: Some(Transcritor::new(
                    bin.join("ffmpeg"),
                    bin.join("whisper-cli"),
                    "modelo.bin".into(),
                    "vad.bin".into(),
                )),
                ..Config::default()
            },
            move |evento| {
                let _ = envio.lock().unwrap().send(evento);
            },
        );
        let video = tmp.path().join("aula.mp4");
        fs::write(&video, b"video de mentira").unwrap();

        let projeto = nucleo
            .criar_lote(&[video.display().to_string()])
            .unwrap()
            .remove(0);

        let mut percentuais = Vec::new();
        loop {
            match eventos
                .recv_timeout(Duration::from_secs(20))
                .expect("a Transcrição não terminou")
            {
                Evento::ProgressoDaEtapa {
                    etapa: Etapa::Transcricao,
                    percentual,
                    ..
                } => percentuais.push(percentual),
                Evento::EtapaMudou {
                    etapa: Etapa::Transcricao,
                    estado: EstadoDaEtapa::Concluida,
                    ..
                } => break,
                Evento::EtapaMudou {
                    etapa: Etapa::Transcricao,
                    estado: EstadoDaEtapa::Falhou,
                    falha,
                    ..
                } => panic!("falhou: {falha:?}"),
                _ => {}
            }
        }

        assert!(
            percentuais.contains(&40) && percentuais.last() == Some(&100),
            "{percentuais:?}"
        );
        assert!(percentuais.windows(2).all(|par| par[0] < par[1]));
        let pasta = std::path::PathBuf::from(&projeto.pasta);
        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(pasta.join("projeto.json")).unwrap()).unwrap();
        assert_eq!(json["idiomaDoVideo"], "pt");
        assert!(pasta.join("edit/transcricao.json").is_file());
        assert!(pasta.join("edit/transcricao-compactada.txt").is_file());
    }
}

/// Com o motor real, num vídeo de 20 s: precisa de `ffmpeg`, de `whisper-cli` e dos modelos em
/// `SHORTS_WHISPER_CLI`, `SHORTS_WHISPER_MODELO` e `SHORTS_WHISPER_VAD`.
#[test]
#[ignore = "usa o whisper-cli e os modelos reais"]
fn com_o_motor_real_a_fala_de_20_segundos_vira_palavras_no_lugar() {
    use std::process::Command;
    use std::sync::atomic::AtomicBool;

    use nucleo::transcricao::{Pedido, Transcritor};

    let variavel = |nome: &str| PathBuf::from(std::env::var(nome).unwrap());
    let tmp = tempfile::tempdir().unwrap();
    let video = tmp.path().join("fala.mp4");
    let fala = std::env::var("SHORTS_WHISPER_AUDIO_DE_TESTE").unwrap();
    let gerado = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x180:d=20",
        ])
        .args([
            "-i",
            &fala,
            "-t",
            "20",
            "-shortest",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
        ])
        .arg(&video)
        .status()
        .unwrap();
    assert!(gerado.success());

    let transcricao = Transcritor::new(
        "ffmpeg".into(),
        variavel("SHORTS_WHISPER_CLI"),
        variavel("SHORTS_WHISPER_MODELO"),
        variavel("SHORTS_WHISPER_VAD"),
    )
    .transcrever(
        &Pedido {
            video: &video,
            pasta_de_saida: &tmp.path().join("edit"),
            idioma: None,
            nomes_proprios: &[],
        },
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();

    assert!(!transcricao.palavras.is_empty());
    assert!(transcricao.palavras.iter().all(|p| p.fim <= 20.5));
}
