//! A Transcrição pela interface pública do núcleo: a leitura da tabela do VAD e a volta dos
//! tempos ao áudio original, as palavras e a transcrição compactada por casos de referência, e
//! a orquestração com `ffmpeg` e `whisper-cli` falsos que devolvem a gravação do spike
//! (KGfmaHnBQx4). O teste lento (`--ignored`) usa o motor real num vídeo de 20 s.

use std::path::PathBuf;

use nucleo::transcricao::{
    PalavraTranscrita, VadSegment, compactar, progress_percent, prompt, to_original_time,
    vad_segments,
};

fn gravado(nome: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.scratch/shorts-ai-mvp/spike-transcricao/gravado")
        .join(nome)
}

fn vad_gravado() -> Vec<VadSegment> {
    vad_segments(&std::fs::read_to_string(gravado("whisper.log")).unwrap())
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
        VadSegment {
            original_start: 10613,
            original_end: 20562,
            vad_start: 10492,
            vad_end: 20441,
        }
    );
}

#[test]
fn sem_a_tabela_do_vad_os_tempos_ficam_como_estao() {
    assert_eq!(vad_segments("whisper_init: nada\n"), []);
    assert_eq!(to_original_time(12345, &[]), 12345);
}

#[test]
fn o_tempo_do_audio_cortado_volta_ao_original_pela_regra_do_whisper_cpp() {
    let vad = vad_gravado();

    // Dentro do primeiro segmento nada muda; no segundo, soma o silêncio removido (1,21 s).
    assert_eq!(to_original_time(5000, &vad), 5000);
    assert_eq!(to_original_time(15000, &vad), 15121);
    // No silêncio removido encosta na borda mais próxima: entre 104,92 e 104,82 cortado.
    assert_eq!(to_original_time(10482, &vad), 10472);
    assert_eq!(to_original_time(10490, &vad), 10613);
    // Antes do primeiro e depois do último.
    assert_eq!(to_original_time(0, &vad), 0);
    assert_eq!(to_original_time(99999, &vad), 74384);
}

#[test]
fn o_progresso_sai_da_linha_do_callback_do_whisper_cpp() {
    assert_eq!(
        progress_percent("whisper_print_progress_callback: progress =  10%"),
        Some(10.0)
    );
    assert_eq!(
        progress_percent("whisper_print_progress_callback: progress = 100%"),
        Some(100.0)
    );
    assert_eq!(progress_percent("whisper_vad: nada"), None);
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

    use nucleo::Faixa;
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
case "$ultimo" in *amostra*) [ -f "$dir/vazio" ] && { head -c 44 /dev/zero > "$ultimo"; exit 0; } ;; esac
head -c 3200000 /dev/zero > "$ultimo"
"#;

    /// O whisper-cli falso (o de Vulkan, `whisper-cli`, e o de CPU, `whisper-cli-cpu`) lê o
    /// arquivo de resposta, anota a chamada com o próprio nome, devolve a gravação do spike no
    /// `-of` e o log dela no stderr, com o progresso do `-pp`. A marca `falha` derruba os dois;
    /// a `gpu-falha`, só o de Vulkan; a `trava` os prende até serem mortos.
    const WHISPER: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
nome="$(basename "$0")"
args="${1#@}"
{ printf '%s ' "$nome"; tr '\n' ' ' < "$args"; echo; } >> "$dir/whisper.log"
saida="$(grep -A1 '^-of$' "$args" | tail -1)"
case "$saida" in *sleep-forever*) exec sleep 30 ;; esac
[ -f "$dir/trava" ] && exec sleep 30
[ -f "$dir/falha" ] && { echo "falha de teste" >&2; exit 3; }
if [ "$nome" = whisper-cli ] && [ -f "$dir/gpu-falha" ]; then
  echo "ggml_vulkan: device lost" >&2
  exit 1
fi
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
            for (nome, conteudo) in [
                ("ffmpeg", FFMPEG),
                ("whisper-cli", WHISPER),
                ("whisper-cli-cpu", WHISPER),
            ] {
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
            )
            .with_cpu_fallback(bin.join("whisper-cli-cpu"));
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

        fn marcar(&self, nome: &str) {
            fs::write(self.bin().join(nome), "").unwrap();
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
                    faixa: None,
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
    fn com_faixa_o_ffmpeg_extrai_so_a_faixa_e_os_tempos_continuam_os_do_video_original() {
        let cenario = Cenario::novo();
        let sem_faixa = cenario.transcrever(Some("pt"), &mut Vec::new()).unwrap();

        let com_faixa = cenario
            .transcritor
            .transcrever(
                &Pedido {
                    video: &cenario.video,
                    pasta_de_saida: &cenario.edit,
                    idioma: Some("pt"),
                    nomes_proprios: &[],
                    faixa: Some(Faixa {
                        inicio: 600,
                        fim: Some(900),
                    }),
                },
                &AtomicBool::new(false),
                &mut |_| {},
            )
            .unwrap();

        let ffmpeg = fs::read_to_string(cenario.bin().join("ffmpeg.log")).unwrap();
        let chamada = ffmpeg.lines().last().unwrap();
        assert!(chamada.contains("-ss 600 -t 300 -i "), "{chamada}");
        assert_eq!(com_faixa.palavras.len(), sem_faixa.palavras.len());
        for (com, sem) in com_faixa.palavras.iter().zip(&sem_faixa.palavras) {
            assert!((com.inicio - (sem.inicio + 600.0)).abs() < 1e-9, "{com:?}");
            assert!((com.fim - (sem.fim + 600.0)).abs() < 1e-9, "{com:?}");
        }
        let compactada =
            fs::read_to_string(cenario.edit.join("transcricao-compactada.txt")).unwrap();
        assert!(compactada.starts_with("[6"), "{compactada}");
    }

    #[test]
    fn faixa_sem_fim_extrai_do_inicio_ate_o_fim() {
        let cenario = Cenario::novo();

        cenario
            .transcritor
            .transcrever(
                &Pedido {
                    video: &cenario.video,
                    pasta_de_saida: &cenario.edit,
                    idioma: Some("pt"),
                    nomes_proprios: &[],
                    faixa: Some(Faixa {
                        inicio: 90,
                        fim: None,
                    }),
                },
                &AtomicBool::new(false),
                &mut |_| {},
            )
            .unwrap();

        let ffmpeg = fs::read_to_string(cenario.bin().join("ffmpeg.log")).unwrap();
        let chamada = ffmpeg.lines().last().unwrap();
        assert!(chamada.contains("-ss 90 -i "), "{chamada}");
        assert!(!chamada.contains("-t "), "{chamada}");
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
    fn o_trecho_de_deteccao_e_cortado_na_saida_e_recodificado() {
        let cenario = Cenario::novo();

        cenario.transcrever(None, &mut Vec::new()).unwrap();

        let log = fs::read_to_string(cenario.bin().join("ffmpeg.log")).unwrap();
        let corte = log.lines().nth(1).unwrap();
        assert!(corte.contains("-i "), "{corte}");
        assert!(corte.contains("-t 30 -c:a pcm_s16le"), "{corte}");
        assert!(!corte.contains("copy"), "{corte}");
        let (antes, depois) = corte.split_once("-ss").unwrap();
        assert!(antes.contains("-i ") && !depois.contains("-i "), "{corte}");
    }

    #[test]
    fn um_trecho_de_deteccao_sem_audio_e_um_erro_que_fala_dele() {
        let cenario = Cenario::novo();
        cenario.marcar("vazio");

        let erro = cenario.transcrever(None, &mut Vec::new()).unwrap_err();

        let mensagem = erro.to_string();
        assert!(mensagem.contains("trecho de detecção"), "{mensagem}");
        assert!(cenario.chamadas_do_whisper().is_empty());
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
        cenario.marcar("falha");

        let erro = cenario
            .transcrever(Some("pt"), &mut Vec::new())
            .unwrap_err();

        assert!(matches!(
            &erro,
            ErroDaTranscricao::Falhou { programa: "whisper-cli", detalhe } if detalhe == "falha de teste"
        ));
        assert!(!cenario.edit.join("transcricao.json").exists());
        // A reserva de CPU também foi tentada, e o erro é o dela.
        let chamadas = cenario.chamadas_do_whisper();
        assert_eq!(chamadas.len(), 2, "{chamadas:?}");
        assert!(chamadas[1].starts_with("whisper-cli-cpu "), "{chamadas:?}");
    }

    #[test]
    fn quando_o_vulkan_falha_a_transcricao_roda_de_novo_so_na_cpu() {
        let cenario = Cenario::novo();
        cenario.marcar("gpu-falha");

        let transcricao = cenario.transcrever(Some("pt"), &mut Vec::new()).unwrap();

        assert!(transcricao.palavras.len() > 1600);
        let chamadas = cenario.chamadas_do_whisper();
        assert_eq!(chamadas.len(), 2, "{chamadas:?}");
        assert!(chamadas[0].starts_with("whisper-cli "), "{}", chamadas[0]);
        assert!(!chamadas[0].contains(" -ng"), "{}", chamadas[0]);
        assert!(
            chamadas[1].starts_with("whisper-cli-cpu "),
            "{}",
            chamadas[1]
        );
        // O mesmo pedido, só que sem GPU.
        assert_eq!(
            chamadas[1].trim_end(),
            format!(
                "whisper-cli-cpu {} -ng",
                chamadas[0].trim_end().trim_start_matches("whisper-cli ")
            )
        );
    }

    #[test]
    fn sem_o_whisper_de_vulkan_a_cpu_assume() {
        let cenario = Cenario::novo();
        fs::remove_file(cenario.bin().join("whisper-cli")).unwrap();

        let transcricao = cenario.transcrever(Some("pt"), &mut Vec::new()).unwrap();

        assert!(transcricao.palavras.len() > 1600);
        let chamadas = cenario.chamadas_do_whisper();
        assert_eq!(chamadas.len(), 1, "{chamadas:?}");
        assert!(
            chamadas[0].starts_with("whisper-cli-cpu "),
            "{}",
            chamadas[0]
        );
    }

    #[test]
    fn depois_que_o_vulkan_falha_na_deteccao_a_transcricao_vai_direto_para_a_cpu() {
        let cenario = Cenario::novo();
        cenario.marcar("gpu-falha");

        let transcricao = cenario.transcrever(None, &mut Vec::new()).unwrap();

        assert_eq!(transcricao.idioma, "pt");
        let chamadas = cenario.chamadas_do_whisper();
        let programas: Vec<_> = chamadas
            .iter()
            .map(|chamada| chamada.split(' ').next().unwrap())
            .collect();
        assert_eq!(
            programas,
            ["whisper-cli", "whisper-cli-cpu", "whisper-cli-cpu"],
            "{chamadas:?}"
        );
        assert!(chamadas[2].contains("-l pt "), "{}", chamadas[2]);
    }

    #[test]
    fn sem_a_reserva_de_cpu_a_falha_do_vulkan_e_o_erro() {
        let cenario = Cenario::novo();
        cenario.marcar("gpu-falha");
        let transcritor = Transcritor::new(
            cenario.bin().join("ffmpeg"),
            cenario.bin().join("whisper-cli"),
            "modelo.bin".into(),
            "vad.bin".into(),
        );

        let erro = transcritor
            .transcrever(
                &Pedido {
                    video: &cenario.video,
                    pasta_de_saida: &cenario.edit,
                    idioma: Some("pt"),
                    nomes_proprios: &[],
                    faixa: None,
                },
                &AtomicBool::new(false),
                &mut |_| {},
            )
            .unwrap_err();

        assert!(matches!(
            &erro,
            ErroDaTranscricao::Falhou { programa: "whisper-cli", detalhe } if detalhe == "ggml_vulkan: device lost"
        ));
        assert_eq!(cenario.chamadas_do_whisper().len(), 1);
    }

    #[test]
    fn um_programa_que_falta_diz_onde_foi_procurado() {
        let cenario = Cenario::novo();
        fs::remove_file(cenario.bin().join("ffmpeg")).unwrap();

        let erro = cenario
            .transcrever(Some("pt"), &mut Vec::new())
            .unwrap_err();

        let ErroDaTranscricao::Falhou { programa, detalhe } = &erro else {
            panic!("esperava a falha do ffmpeg: {erro:?}");
        };
        assert_eq!(*programa, "ffmpeg");
        assert!(
            detalhe.contains(&cenario.bin().join("ffmpeg").display().to_string()),
            "{detalhe}"
        );
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
                        faixa: None,
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

    #[test]
    fn cancelar_o_whisper_de_vulkan_nao_passa_para_a_cpu() {
        let cenario = Cenario::novo();
        cenario.marcar("trava");
        let cancelar = AtomicBool::new(false);

        let erro = std::thread::scope(|escopo| {
            let tarefa = escopo.spawn(|| {
                cenario.transcritor.transcrever(
                    &Pedido {
                        video: &cenario.video,
                        pasta_de_saida: &cenario.edit,
                        idioma: Some("pt"),
                        nomes_proprios: &[],
                        faixa: None,
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
        let chamadas = cenario.chamadas_do_whisper();
        assert_eq!(chamadas.len(), 1, "{chamadas:?}");
        assert!(chamadas[0].starts_with("whisper-cli "), "{chamadas:?}");
    }
}

#[cfg(unix)]
mod na_fila {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Mutex;
    use std::sync::mpsc;
    use std::time::Duration;

    use nucleo::{Config, EstadoDaEtapa, Etapa, Evento, Nucleo, Padroes};

    use super::gravado;

    /// O núcleo acha o ffmpeg e o whisper-cli na pasta dos sidecars e os modelos nos dados do
    /// app. Roda a etapa com whisper-cli e ffmpeg falsos; devolve o que ela avisou e onde ficou.
    fn transcrever_com(padroes: &Padroes) -> Rodada {
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
                "#!/bin/sh\nresposta=\"${{1#@}}\"\n\
                 cp \"$resposta\" \"$(dirname \"$0\")/resposta.txt\"\n\
                 saida=\"$(grep -A1 '^-of$' \"$resposta\" | tail -1)\"\n\
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
        let dados = tmp.path().join("dados");
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: dados.clone(),
                pasta_de_videos: Some(tmp.path().join("Videos")),
                sidecar_dir: Some(bin.clone()),
                ..Config::default()
            },
            move |evento| {
                let _ = envio.lock().unwrap().send(evento);
            },
        );
        let video = tmp.path().join("aula.mp4");
        fs::write(&video, b"video de mentira").unwrap();

        let projeto = nucleo
            .criar_lote(&[video.display().to_string()], padroes)
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

        Rodada {
            percentuais,
            pasta: std::path::PathBuf::from(&projeto.pasta),
            bin,
            dados,
            _tmp: tmp,
        }
    }

    struct Rodada {
        percentuais: Vec<u8>,
        pasta: std::path::PathBuf,
        bin: std::path::PathBuf,
        dados: std::path::PathBuf,
        _tmp: tempfile::TempDir,
    }

    #[test]
    fn a_etapa_transcreve_grava_o_idioma_no_projeto_e_avisa_o_progresso() {
        let Rodada {
            percentuais,
            pasta,
            bin,
            dados,
            _tmp,
            ..
        } = transcrever_com(&Padroes::default());

        assert!(
            percentuais.contains(&40) && percentuais.last() == Some(&100),
            "{percentuais:?}"
        );
        assert!(percentuais.windows(2).all(|par| par[0] < par[1]));
        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(pasta.join("projeto.json")).unwrap()).unwrap();
        assert_eq!(json["idiomaDoVideo"], "pt");
        assert!(pasta.join("edit/transcricao.json").is_file());
        assert!(pasta.join("edit/transcricao-compactada.txt").is_file());
        // Os modelos do spike, nos dados do app, onde a preparação os baixa.
        let resposta = fs::read_to_string(bin.join("resposta.txt")).unwrap();
        let modelos = dados.join("modelos");
        for (opcao, modelo) in [
            ("-m", "ggml-large-v3-q5_0.bin"),
            ("-vm", "ggml-silero-v6.2.0.bin"),
        ] {
            let linha = format!("{opcao}\n{}\n", modelos.join(modelo).display());
            assert!(resposta.contains(&linha), "faltou {linha}: {resposta}");
        }
    }

    #[test]
    fn idioma_e_nomes_proprios_dos_padroes_chegam_ao_whisper() {
        let padroes = Padroes {
            idioma_do_video: nucleo::IdiomaDoVideo::En,
            nomes_proprios: vec!["Ana Souza".to_owned()],
            ..Padroes::default()
        };

        let Rodada {
            pasta, bin, _tmp, ..
        } = transcrever_com(&padroes);

        let resposta = fs::read_to_string(bin.join("resposta.txt")).unwrap();
        assert!(resposta.contains("-l\nen\n"), "{resposta}");
        assert!(resposta.contains("Ana Souza"), "{resposta}");
        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(pasta.join("projeto.json")).unwrap()).unwrap();
        assert_eq!(json["idiomaDoVideo"], "pt");
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
            faixa: None,
        },
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();

    assert!(!transcricao.palavras.is_empty());
    assert!(transcricao.palavras.iter().all(|p| p.fim <= 20.5));
}

/// Com o ffmpeg real, num áudio de 3 s: o corte da amostra da detecção do idioma tem de sair com
/// áudio, inclusive no ffmpeg 4.4. Precisa dos mesmos programas e variáveis do teste acima.
#[test]
#[ignore = "usa o whisper-cli e os modelos reais"]
fn com_o_ffmpeg_real_o_idioma_de_um_audio_curto_e_detectado() {
    use std::process::Command;
    use std::sync::atomic::AtomicBool;

    use nucleo::transcricao::{Pedido, Transcritor};

    let variavel = |nome: &str| PathBuf::from(std::env::var(nome).unwrap());
    let tmp = tempfile::tempdir().unwrap();
    let video = tmp.path().join("curto.mp4");
    let fala = std::env::var("SHORTS_WHISPER_AUDIO_DE_TESTE").unwrap();
    let gerado = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x180:d=3",
        ])
        .args([
            "-i",
            &fala,
            "-t",
            "3",
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
            faixa: None,
        },
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();

    assert!(!transcricao.idioma.is_empty());
}
