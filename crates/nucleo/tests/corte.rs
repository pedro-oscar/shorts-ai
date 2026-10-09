//! O corte horizontal pela interface pública do núcleo: as regras de cor e a leitura do
//! loudnorm por casos de referência, e a montagem com `ffmpeg` e `ffprobe` falsos.
//! O teste lento (`--ignored`) usa o ffmpeg real num vídeo de 20 s.

use nucleo::corte::{
    AjusteDeCor, Estatisticas, InfoDoVideo, MedicaoDeLoudness, ajuste_de_cor, filtro_de_audio,
    filtro_de_video,
};

fn info(largura: u32, altura: u32, rotacao: u32, hdr: bool) -> InfoDoVideo {
    InfoDoVideo {
        largura,
        altura,
        rotacao,
        hdr,
    }
}

#[test]
fn um_trecho_bem_exposto_fica_sem_ajuste_de_cor() {
    let medido = Estatisticas {
        luma_media: 120.0,
        faixa_de_luma: 220.0,
        saturacao_media: 60.0,
    };

    assert_eq!(ajuste_de_cor(&medido), None);
}

#[test]
fn um_trecho_escuro_e_apagado_ganha_gama_contraste_e_saturacao() {
    let medido = Estatisticas {
        luma_media: 60.0,
        faixa_de_luma: 150.0,
        saturacao_media: 15.0,
    };

    let ajuste = ajuste_de_cor(&medido).unwrap();

    assert_eq!(
        ajuste,
        AjusteDeCor {
            contraste: 1.08,
            gama: 1.08,
            saturacao: 1.08,
        }
    );
    assert_eq!(
        ajuste.filtro(),
        "eq=contrast=1.080:gamma=1.080:saturation=1.080"
    );
}

#[test]
fn um_trecho_estourado_e_saturado_demais_perde_gama_e_saturacao() {
    let medido = Estatisticas {
        luma_media: 200.0,
        faixa_de_luma: 230.0,
        saturacao_media: 120.0,
    };

    let ajuste = ajuste_de_cor(&medido).unwrap();

    assert_eq!(ajuste.contraste, 1.0);
    assert!(ajuste.gama < 1.0 && ajuste.gama >= 0.92);
    assert!(ajuste.saturacao < 1.0 && ajuste.saturacao >= 0.92);
}

#[test]
fn o_ajuste_pequeno_e_proporcional_ao_desvio() {
    let medido = Estatisticas {
        luma_media: 95.0,
        faixa_de_luma: 210.0,
        saturacao_media: 50.0,
    };

    let ajuste = ajuste_de_cor(&medido).unwrap();

    assert!((ajuste.gama - 1.02).abs() < 1e-9);
}

#[test]
fn as_estatisticas_saem_da_media_dos_quadros_do_signalstats() {
    let saida = "\
frame:0    pts:0       pts_time:0
lavfi.signalstats.YLOW=20
lavfi.signalstats.YAVG=100.5
lavfi.signalstats.YHIGH=200
lavfi.signalstats.SATAVG=40
frame:1    pts:1       pts_time:0.5
lavfi.signalstats.YLOW=30
lavfi.signalstats.YAVG=101.5
lavfi.signalstats.YHIGH=220
lavfi.signalstats.SATAVG=50
";

    let estatisticas = Estatisticas::de_saida(saida).unwrap();

    assert_eq!(
        estatisticas,
        Estatisticas {
            luma_media: 101.0,
            faixa_de_luma: 185.0,
            saturacao_media: 45.0,
        }
    );
    assert_eq!(Estatisticas::de_saida("sem quadros"), None);
}

const LOUDNORM: &str = r#"[Parsed_loudnorm_0 @ 0x55d] 
{
	"input_i" : "-23.54",
	"input_tp" : "-6.23",
	"input_lra" : "7.10",
	"input_thresh" : "-34.12",
	"output_i" : "-14.51",
	"output_tp" : "-1.50",
	"output_lra" : "5.20",
	"output_thresh" : "-24.80",
	"normalization_type" : "dynamic",
	"target_offset" : "0.51"
}
"#;

#[test]
fn a_medicao_do_loudnorm_alimenta_o_segundo_passe() {
    let medicao =
        MedicaoDeLoudness::de_saida(&format!("size=N/A time=00:00:10\n{LOUDNORM}")).unwrap();

    assert_eq!(
        medicao.filtro_do_segundo_passe(),
        "loudnorm=I=-14:TP=-1:LRA=11:measured_I=-23.54:measured_TP=-6.23:measured_LRA=7.10:measured_thresh=-34.12:offset=0.51:linear=true"
    );
}

#[test]
fn audio_mudo_nao_tem_medicao_utilizavel() {
    let mudo = LOUDNORM.replace("-23.54", "-inf");

    assert_eq!(MedicaoDeLoudness::de_saida(&mudo), None);
    assert_eq!(MedicaoDeLoudness::de_saida("nada de json"), None);
}

#[test]
fn a_escala_usa_1920_no_lado_maior_respeitando_a_rotacao() {
    assert_eq!(
        filtro_de_video(&info(3840, 2160, 0, false), None),
        "scale=1920:-2,format=yuv420p"
    );
    assert_eq!(
        filtro_de_video(&info(1080, 1920, 0, false), None),
        "scale=-2:1920,format=yuv420p"
    );
    // Gravado em pé e girado 90 graus: o que se vê é horizontal.
    assert_eq!(
        filtro_de_video(&info(1080, 1920, 90, false), None),
        "scale=1920:-2,format=yuv420p"
    );
}

#[test]
fn video_hdr_passa_pelo_tone_map_antes_da_escala_e_da_cor() {
    let cor = AjusteDeCor {
        contraste: 1.0,
        gama: 1.05,
        saturacao: 1.0,
    };

    let filtro = filtro_de_video(&info(3840, 2160, 0, true), Some(&cor));

    let tone_map = filtro.find("tonemap=tonemap=hable").unwrap();
    let escala = filtro.find("scale=1920:-2").unwrap();
    let eq = filtro.find("eq=contrast").unwrap();
    assert!(tone_map < escala && escala < eq);
    assert!(filtro.starts_with("zscale=t=linear"));
}

#[test]
fn o_fade_de_audio_dura_30_ms_nas_duas_pontas() {
    assert_eq!(
        filtro_de_audio(4.0),
        "afade=t=in:d=0.03,afade=t=out:st=3.970:d=0.03"
    );
}

#[test]
fn o_ffprobe_informa_rotacao_hdr_e_dimensoes() {
    let json = r#"{"streams":[{"width":1920,"height":1080,"color_transfer":"smpte2084",
        "side_data_list":[{"side_data_type":"Display Matrix","rotation":-90}]}]}"#;

    assert_eq!(
        InfoDoVideo::de_ffprobe(json),
        Some(info(1920, 1080, 270, true))
    );
    let antigo = r#"{"streams":[{"width":1080,"height":1920,"tags":{"rotate":"90"}}]}"#;
    assert_eq!(
        InfoDoVideo::de_ffprobe(antigo),
        Some(info(1080, 1920, 90, false))
    );
    assert_eq!(InfoDoVideo::de_ffprobe(r#"{"streams":[]}"#), None);
}

#[cfg(unix)]
mod montagem {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};

    use nucleo::corte::{ErroDoCorte, Ffmpeg, Trecho};

    const FFPROBE: &str = r#"#!/bin/sh
echo '{"streams":[{"width":3840,"height":2160,"color_transfer":"smpte2084"}]}'
"#;

    /// Registra os argumentos e imita as quatro chamadas do corte pelo que cada uma pede.
    const FFMPEG: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
echo "$@" >> "$dir/ffmpeg.log"
case "$*" in
*sleep-forever*) exec sleep 30 ;;
*signalstats*)
  echo "lavfi.signalstats.YLOW=10"
  echo "lavfi.signalstats.YAVG=60"
  echo "lavfi.signalstats.YHIGH=150"
  echo "lavfi.signalstats.SATAVG=60"
  exit 0 ;;
*print_format=json*)
  [ -f "$dir/sem-medicao" ] && exit 1
  cat "$dir/loudnorm.json" >&2
  exit 0 ;;
*"-f null"*) exit 0 ;;
esac
case "$*" in
*-progress*)
  echo "out_time_us=1000000"
  echo "out_time_us=2000000"
  echo "progress=end" ;;
esac
for ultimo; do :; done
echo dados > "$ultimo"
"#;

    struct Cenario {
        tmp: tempfile::TempDir,
        ffmpeg: Ffmpeg,
        origem: PathBuf,
    }

    impl Cenario {
        fn novo() -> Self {
            let tmp = tempfile::tempdir().unwrap();
            let bin = tmp.path().join("bin");
            fs::create_dir(&bin).unwrap();
            for (nome, conteudo) in [("ffmpeg", FFMPEG), ("ffprobe", FFPROBE)] {
                let caminho = bin.join(nome);
                fs::write(&caminho, conteudo).unwrap();
                fs::set_permissions(&caminho, fs::Permissions::from_mode(0o755)).unwrap();
            }
            fs::write(bin.join("loudnorm.json"), super::LOUDNORM).unwrap();
            let origem = tmp.path().join("original.mp4");
            fs::write(&origem, b"x").unwrap();
            let ffmpeg = Ffmpeg::new(bin.join("ffmpeg"), bin.join("ffprobe"));
            Self {
                tmp,
                ffmpeg,
                origem,
            }
        }

        fn bin(&self) -> PathBuf {
            self.tmp.path().join("bin")
        }

        fn chamadas(&self) -> Vec<String> {
            fs::read_to_string(self.bin().join("ffmpeg.log"))
                .unwrap_or_default()
                .lines()
                .map(str::to_owned)
                .collect()
        }

        fn montar(
            &self,
            cancelar: &AtomicBool,
            progresso: &mut dyn FnMut(f64),
        ) -> Result<PathBuf, ErroDoCorte> {
            let saida = self.tmp.path().join("corte.mp4");
            let trabalho = self.tmp.path().join("trabalho");
            let trechos = [
                Trecho {
                    inicio: 10.0,
                    fim: 12.0,
                },
                Trecho {
                    inicio: 30.0,
                    fim: 32.0,
                },
            ];
            self.ffmpeg
                .montar(
                    &self.origem,
                    &trechos,
                    &saida,
                    &trabalho,
                    cancelar,
                    progresso,
                )
                .map(|()| saida)
        }
    }

    #[test]
    fn cada_trecho_tem_o_proprio_ffmpeg_e_depois_vem_concat_sem_recodificar_e_loudnorm_em_dois_passes()
     {
        let cenario = Cenario::novo();
        let mut fracoes = Vec::new();

        let saida = cenario
            .montar(&AtomicBool::new(false), &mut |f| fracoes.push(f))
            .unwrap();

        assert!(Path::new(&saida).is_file());
        let chamadas = cenario.chamadas();
        let codificacoes: Vec<_> = chamadas.iter().filter(|c| c.contains("libx264")).collect();
        assert_eq!(codificacoes.len(), 2);
        assert!(codificacoes[0].contains("-ss 10.000 -t 2.000"));
        assert!(codificacoes[1].contains("-ss 30.000 -t 2.000"));
        for c in &codificacoes {
            assert!(c.contains("tonemap=tonemap=hable"), "HDR sem tone-map: {c}");
            assert!(c.contains("scale=1920:-2"));
            assert!(c.contains("eq=contrast="), "sem correção de cor: {c}");
            assert!(c.contains("afade=t=in:d=0.03"));
        }
        let concat = chamadas.iter().find(|c| c.contains("-f concat")).unwrap();
        assert!(concat.contains("-c copy"));
        let lista = fs::read_to_string(cenario.tmp.path().join("trabalho/trechos.txt")).unwrap();
        assert_eq!(lista.lines().count(), 2);
        let normalizacoes: Vec<_> = chamadas.iter().filter(|c| c.contains("loudnorm")).collect();
        assert_eq!(normalizacoes.len(), 2);
        assert!(normalizacoes[0].contains("print_format=json"));
        assert!(normalizacoes[1].contains("measured_I=-23.54"));
        assert!(normalizacoes[1].contains("-c:v copy"));
        assert!(
            fracoes.windows(2).all(|par| par[0] <= par[1]),
            "{fracoes:?}"
        );
        assert_eq!(fracoes.last(), Some(&1.0));
    }

    #[test]
    fn sem_medicao_do_loudnorm_normaliza_em_um_passe_so() {
        let cenario = Cenario::novo();
        fs::write(cenario.bin().join("sem-medicao"), "").unwrap();

        cenario
            .montar(&AtomicBool::new(false), &mut |_| {})
            .unwrap();

        let final_ = cenario
            .chamadas()
            .into_iter()
            .filter(|c| c.contains("loudnorm"))
            .collect::<Vec<_>>();
        assert_eq!(final_.len(), 2);
        assert!(!final_[1].contains("measured_I"));
        assert!(final_[1].contains("loudnorm=I=-14:TP=-1:LRA=11"));
    }

    #[test]
    fn cancelar_mata_o_ffmpeg_em_curso() {
        let cenario = Cenario::novo();
        fs::write(
            cenario.bin().join("ffprobe"),
            "#!/bin/sh\necho '{\"streams\":[{\"width\":1920,\"height\":1080}]}'\n",
        )
        .unwrap();
        // Um nome de origem que o ffmpeg falso reconhece e trava com `sleep`.
        let travado = cenario.tmp.path().join("sleep-forever.mp4");
        fs::write(&travado, b"x").unwrap();
        let cancelar = AtomicBool::new(false);
        let inicio = Instant::now();

        let resultado = std::thread::scope(|escopo| {
            let tarefa = escopo.spawn(|| {
                cenario.ffmpeg.montar(
                    &travado,
                    &[Trecho {
                        inicio: 0.0,
                        fim: 2.0,
                    }],
                    &cenario.tmp.path().join("x.mp4"),
                    &cenario.tmp.path().join("t"),
                    &cancelar,
                    &mut |_| {},
                )
            });
            std::thread::sleep(Duration::from_millis(300));
            cancelar.store(true, Ordering::Relaxed);
            tarefa.join().unwrap()
        });

        assert!(matches!(resultado, Err(ErroDoCorte::Cancelado)));
        assert!(inicio.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn falha_do_ffmpeg_vira_erro_com_a_ultima_linha_do_stderr() {
        let cenario = Cenario::novo();
        let bin = cenario.bin();
        fs::write(
            bin.join("ffmpeg"),
            "#!/bin/sh\necho 'Invalid data found' >&2\nexit 1\n",
        )
        .unwrap();

        let erro = cenario
            .montar(&AtomicBool::new(false), &mut |_| {})
            .unwrap_err();

        assert_eq!(erro.to_string(), "ffmpeg falhou: Invalid data found");
    }
}

/// Com o ffmpeg e o ffprobe reais no `PATH`: `cargo test -- --ignored`.
#[test]
#[ignore = "precisa do ffmpeg real"]
fn com_o_ffmpeg_real_o_corte_tem_a_duracao_e_a_loudness_esperadas() {
    use std::process::Command;
    use std::sync::atomic::AtomicBool;

    use nucleo::corte::{Ffmpeg, Trecho};

    let tmp = tempfile::tempdir().unwrap();
    let origem = tmp.path().join("original.mp4");
    let gerado = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1280x720:rate=30:duration=20",
        ])
        .args([
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=20",
            "-shortest",
        ])
        .args(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"])
        .arg(&origem)
        .status()
        .unwrap();
    assert!(gerado.success());
    let saida = tmp.path().join("corte.mp4");

    Ffmpeg::new("ffmpeg".into(), "ffprobe".into())
        .montar(
            &origem,
            &[
                Trecho {
                    inicio: 2.0,
                    fim: 5.0,
                },
                Trecho {
                    inicio: 10.0,
                    fim: 14.0,
                },
            ],
            &saida,
            &tmp.path().join("trabalho"),
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap();

    let duracao = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
        ])
        .arg(&saida)
        .output()
        .unwrap();
    let duracao: f64 = String::from_utf8_lossy(&duracao.stdout)
        .trim()
        .parse()
        .unwrap();
    assert!((duracao - 7.0).abs() < 0.3, "duração {duracao}");
    let medido = Command::new("ffmpeg")
        .args(["-nostats", "-i"])
        .arg(&saida)
        .args([
            "-vn",
            "-af",
            "loudnorm=I=-14:TP=-1:LRA=11:print_format=json",
            "-f",
            "null",
            "-",
        ])
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&medido.stderr);
    let integrado = nucleo::corte::MedicaoDeLoudness::de_saida(&stderr).unwrap();
    assert!(integrado.filtro_do_segundo_passe().contains("measured_I="));
}
