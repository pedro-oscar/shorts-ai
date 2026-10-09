//! O rosto do corte pela interface pública do núcleo: Pin, escolha da pessoa, preenchimento
//! de lacunas, suavização, trocas de cena e aviso, por casos de referência; o YuNet num
//! quadro real e o ffmpeg falso. O teste lento (`--ignored`) usa um corte do KGfmaHnBQx4.

use nucleo::rosto::{
    Amostra, AvisoDoRosto, Deteccao, Detector, Origem, Pin, distancia_de_histogramas,
    histograma_hsv, rastrear, suavizar, trocou_de_cena,
};

fn rosto(cx: f64, cy: f64, lado: f64) -> Deteccao {
    Deteccao {
        cx,
        cy,
        fw: lado,
        fh: lado,
        pontuacao: 0.9,
    }
}

fn amostra(t: f64, troca: bool, rostos: Vec<Deteccao>) -> Amostra {
    Amostra { t, troca, rostos }
}

fn origem() -> Origem {
    Origem {
        nome: "corte.mp4".into(),
        largura: 1920,
        altura: 1080,
        duracao: 2.0,
    }
}

#[test]
fn o_pin_le_intervalo_e_centro_em_tempos_do_corte() {
    assert_eq!(
        Pin::analisar("12-18:0.30"),
        Some(Pin {
            inicio: 12.0,
            fim: 18.0,
            cx: 0.30
        })
    );
    assert_eq!(
        Pin::analisar("12.5-18:1"),
        Some(Pin {
            inicio: 12.5,
            fim: 18.0,
            cx: 1.0
        })
    );
    assert_eq!(Pin::analisar("12-18"), None);
    assert_eq!(Pin::analisar("18-12:0.3"), None);
    assert_eq!(Pin::analisar("1-2:1.5"), None);
}

#[test]
fn a_suavizacao_de_ida_e_volta_nao_atrasa_o_degrau() {
    let degrau: Vec<f64> = (0..20).map(|i| if i < 10 { 0.2 } else { 0.8 }).collect();

    let suave = suavizar(&degrau, 0.0);

    // Uma passada só chegaria em 0.8 bem depois do degrau; ida e volta se encontram no meio.
    assert!((suave[9] - 0.5).abs() < 0.2, "{suave:?}");
    assert!(suave[9] > 0.2 && suave[10] < 0.8);
    assert!(suave[0] < 0.3 && suave[19] > 0.7);
}

#[test]
fn a_zona_morta_ignora_tremidas_menores_que_0_035() {
    let tremida = [0.5, 0.52, 0.48, 0.51, 0.49, 0.5];

    let suave = suavizar(&tremida, 0.035);

    assert!(suave.iter().all(|v| (v - 0.5).abs() < 1e-9), "{suave:?}");
}

#[test]
fn o_movimento_maior_que_a_zona_morta_e_seguido() {
    let suave = suavizar(&[0.3, 0.3, 0.3, 0.7, 0.7, 0.7, 0.7, 0.7], 0.035);

    assert!(suave[7] > 0.55);
}

#[test]
fn sem_pessoa_anterior_segue_o_maior_rosto() {
    let amostras = [amostra(
        0.0,
        false,
        vec![rosto(0.2, 0.4, 0.1), rosto(0.7, 0.4, 0.2)],
    )];

    let rastro = rastrear(&amostras, &[], &origem());

    assert_eq!(rastro.keys[0].cx, 0.7);
}

#[test]
fn segue_a_mesma_pessoa_enquanto_ela_continua_grande() {
    // A pessoa da esquerda é a seguida; a da direita fica um pouco maior, mas a da esquerda
    // ainda tem mais da metade da área dela.
    let amostras = [
        amostra(0.0, false, vec![rosto(0.2, 0.4, 0.20)]),
        amostra(
            0.2,
            false,
            vec![rosto(0.2, 0.4, 0.19), rosto(0.8, 0.4, 0.22)],
        ),
        amostra(
            0.4,
            false,
            vec![rosto(0.2, 0.4, 0.19), rosto(0.8, 0.4, 0.22)],
        ),
    ];

    let rastro = rastrear(&amostras, &[], &origem());

    assert!(rastro.keys.iter().all(|k| k.cx < 0.3), "{:?}", rastro.keys);
}

#[test]
fn troca_para_o_maior_quando_a_pessoa_seguida_encolhe() {
    let amostras = [
        amostra(0.0, false, vec![rosto(0.2, 0.4, 0.20)]),
        amostra(
            0.2,
            false,
            vec![rosto(0.2, 0.4, 0.08), rosto(0.8, 0.4, 0.22)],
        ),
        amostra(
            0.4,
            false,
            vec![rosto(0.2, 0.4, 0.08), rosto(0.8, 0.4, 0.22)],
        ),
        amostra(
            0.6,
            false,
            vec![rosto(0.2, 0.4, 0.08), rosto(0.8, 0.4, 0.22)],
        ),
        amostra(
            0.8,
            false,
            vec![rosto(0.2, 0.4, 0.08), rosto(0.8, 0.4, 0.22)],
        ),
        amostra(
            1.0,
            false,
            vec![rosto(0.2, 0.4, 0.08), rosto(0.8, 0.4, 0.22)],
        ),
    ];

    let rastro = rastrear(&amostras, &[], &origem());

    assert!(rastro.keys.last().unwrap().cx > 0.6, "{:?}", rastro.keys);
}

#[test]
fn as_lacunas_sao_interpoladas_e_as_pontas_seguram_o_vizinho() {
    let amostras = [
        amostra(0.0, false, vec![]),
        amostra(0.2, false, vec![rosto(0.2, 0.4, 0.2)]),
        amostra(0.4, false, vec![]),
        amostra(0.6, false, vec![rosto(0.6, 0.4, 0.2)]),
        amostra(0.8, false, vec![]),
    ];

    let rastro = rastrear(&amostras, &[], &origem());

    assert_eq!(rastro.stats.samples, 5);
    assert_eq!(rastro.stats.face_ratio, 0.4);
    let primeiro = &rastro.keys[0];
    let ultimo = rastro.keys.last().unwrap();
    assert!(primeiro.cx > 0.1 && primeiro.cx < 0.4);
    assert!(ultimo.cx > 0.4 && ultimo.cx < 0.7);
}

#[test]
fn a_troca_de_cena_separa_o_acompanhamento_e_marca_o_corte_seco() {
    let amostras = [
        amostra(0.0, false, vec![rosto(0.2, 0.4, 0.2)]),
        amostra(0.2, false, vec![rosto(0.2, 0.4, 0.2)]),
        amostra(0.4, true, vec![rosto(0.8, 0.4, 0.2)]),
        amostra(0.6, false, vec![rosto(0.8, 0.4, 0.2)]),
    ];

    let rastro = rastrear(&amostras, &[], &origem());

    assert_eq!(rastro.stats.shots, 2);
    let corte = rastro.keys.iter().find(|k| k.cut).unwrap();
    assert_eq!(corte.t, 0.4);
    assert_eq!(corte.cx, 0.8);
    assert!(
        rastro
            .keys
            .iter()
            .filter(|k| k.t < 0.4)
            .all(|k| k.cx == 0.2)
    );
}

#[test]
fn o_pin_fixa_o_centro_no_intervalo_depois_da_suavizacao() {
    let amostras: Vec<_> = (0..10)
        .map(|i| amostra(f64::from(i) * 0.2, false, vec![rosto(0.2, 0.4, 0.2)]))
        .collect();
    let pins = [Pin {
        inicio: 0.4,
        fim: 1.0,
        cx: 0.65,
    }];

    let rastro = rastrear(&amostras, &pins, &origem());

    for chave in rastro.keys.iter().filter(|k| (0.4..=1.0).contains(&k.t)) {
        assert_eq!(chave.cx, 0.65);
    }
    assert_eq!(rastro.keys[0].cx, 0.2);
    assert_eq!(rastro.keys.last().unwrap().cx, 0.2);
}

#[test]
fn rosto_parado_vira_duas_chaves_e_o_json_tem_o_formato_do_template() {
    let amostras: Vec<_> = (0..10)
        .map(|i| amostra(f64::from(i) * 0.2, false, vec![rosto(0.5, 0.39, 0.2)]))
        .collect();

    let rastro = rastrear(&amostras, &[], &origem());

    assert_eq!(rastro.keys.len(), 2);
    let json: serde_json::Value = serde_json::from_str(&rastro.para_json()).unwrap();
    assert_eq!(json["version"], 2);
    assert_eq!(json["keys"][0]["cut"], false);
    assert_eq!(json["keys"][0]["fw"], 0.2);
    assert_eq!(json["stats"]["faceRatio"], 1.0);
    assert_eq!(json["stats"]["shots"], 1);
    assert_eq!(json["stats"]["detector"], "yunet");
    assert_eq!(json["stats"]["durationSec"], 2.0);
}

#[test]
fn rosto_em_menos_de_60_por_cento_do_corte_gera_aviso() {
    let amostras: Vec<_> = (0..10)
        .map(|i| {
            let rostos = if i < 5 {
                vec![rosto(0.5, 0.4, 0.2)]
            } else {
                vec![]
            };
            amostra(f64::from(i) * 0.2, false, rostos)
        })
        .collect();

    let rastro = rastrear(&amostras, &[], &origem());

    assert_eq!(
        rastro.aviso(),
        Some(AvisoDoRosto::RostoRaro { proporcao: 0.5 })
    );
}

#[test]
fn rosto_em_60_por_cento_ou_mais_nao_gera_aviso() {
    let amostras: Vec<_> = (0..10)
        .map(|i| {
            let rostos = if i < 6 {
                vec![rosto(0.5, 0.4, 0.2)]
            } else {
                vec![]
            };
            amostra(f64::from(i) * 0.2, false, rostos)
        })
        .collect();

    assert_eq!(rastrear(&amostras, &[], &origem()).aviso(), None);
}

#[test]
fn corte_sem_nenhum_rosto_usa_o_enquadramento_padrao() {
    let amostras = [amostra(0.0, false, vec![]), amostra(0.2, false, vec![])];

    let rastro = rastrear(&amostras, &[], &origem());

    assert_eq!(rastro.keys[0].cx, 0.5);
    assert_eq!(rastro.keys[0].cy, 0.4);
    assert_eq!(rastro.stats.face_ratio, 0.0);
    assert!(rastro.aviso().is_some());
}

fn quadro_liso(r: u8, g: u8, b: u8) -> Vec<u8> {
    [r, g, b].repeat(64 * 36)
}

#[test]
fn quadros_parecidos_nao_trocam_de_cena_e_cores_diferentes_trocam() {
    let vermelho = histograma_hsv(&quadro_liso(200, 30, 30));
    let quase_vermelho = histograma_hsv(&quadro_liso(205, 35, 28));
    let azul = histograma_hsv(&quadro_liso(30, 40, 210));

    assert!(distancia_de_histogramas(&vermelho, &vermelho) < 1e-6);
    assert!(!trocou_de_cena(&vermelho, &quase_vermelho));
    assert!(trocou_de_cena(&vermelho, &azul));
}

#[test]
fn o_yunet_acha_os_dois_rostos_do_quadro_de_referencia() {
    let rgb = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/dados/dois-rostos-256x128.rgb"
    ))
    .unwrap();

    let rostos = Detector::new().detectar(&rgb, 256, 128).unwrap();

    let grandes: Vec<_> = rostos.iter().filter(|r| r.fh > 0.4).collect();
    assert_eq!(grandes.len(), 2, "{rostos:?}");
    assert!(grandes.iter().any(|r| (r.cx - 0.29).abs() < 0.08));
    assert!(grandes.iter().any(|r| (r.cx - 0.65).abs() < 0.08));
}

#[cfg(unix)]
mod com_ffmpeg_falso {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::AtomicBool;

    use nucleo::corte::{ErroDoCorte, Ffmpeg};

    const FFPROBE: &str = r#"#!/bin/sh
case "$*" in
*format=duration*) echo 2.0 ;;
*) echo '{"streams":[{"width":256,"height":128}]}' ;;
esac
"#;

    /// Registra os argumentos e entrega 10 quadros crus, que é o que `-f rawvideo -` pede.
    const FFMPEG: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
echo "$@" >> "$dir/ffmpeg.log"
case "$*" in
*sleep-forever*) exec sleep 30 ;;
esac
for i in 1 2 3 4 5 6 7 8 9 10; do cat "$dir/quadro.rgb"; done
"#;

    fn programas(tmp: &tempfile::TempDir) -> Ffmpeg {
        let bin = tmp.path().join("bin");
        fs::create_dir(&bin).unwrap();
        for (nome, conteudo) in [("ffmpeg", FFMPEG), ("ffprobe", FFPROBE)] {
            let caminho = bin.join(nome);
            fs::write(&caminho, conteudo).unwrap();
            fs::set_permissions(&caminho, fs::Permissions::from_mode(0o755)).unwrap();
        }
        fs::copy(
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/dados/dois-rostos-256x128.rgb"
            ),
            bin.join("quadro.rgb"),
        )
        .unwrap();
        Ffmpeg::new(bin.join("ffmpeg"), bin.join("ffprobe"))
    }

    #[test]
    fn os_quadros_do_ffmpeg_viram_o_rastro() {
        let tmp = tempfile::tempdir().unwrap();
        let ffmpeg = programas(&tmp);
        let mut progressos = Vec::new();

        let rastro = ffmpeg
            .rastrear_rosto(
                &tmp.path().join("corte.mp4"),
                &[],
                &AtomicBool::new(false),
                &mut |p| progressos.push(p),
            )
            .unwrap();

        let chamada = fs::read_to_string(tmp.path().join("bin/ffmpeg.log")).unwrap();
        assert!(chamada.contains("fps=5,scale=256:-2"), "{chamada}");
        assert!(
            chamada.contains("-f rawvideo -pix_fmt rgb24 -"),
            "{chamada}"
        );
        assert_eq!(rastro.stats.samples, 10);
        assert_eq!(rastro.stats.face_ratio, 1.0);
        assert_eq!(rastro.stats.shots, 1);
        assert_eq!(rastro.stats.source, "corte.mp4");
        assert!((rastro.keys[0].cx - 0.29).abs() < 0.08, "{:?}", rastro.keys);
        assert_eq!(progressos.last(), Some(&1.0));
        assert!(progressos.windows(2).all(|p| p[0] <= p[1]));
    }

    #[test]
    fn cancelar_mata_o_ffmpeg() {
        let tmp = tempfile::tempdir().unwrap();
        let ffmpeg = programas(&tmp);

        let resultado = ffmpeg.rastrear_rosto(
            &tmp.path().join("corte-sleep-forever.mp4"),
            &[],
            &AtomicBool::new(true),
            &mut |_| {},
        );

        assert!(matches!(resultado, Err(ErroDoCorte::Cancelado)));
    }
}

/// Com o corte do KGfmaHnBQx4 em `SHORTS_CORTE_C01` (o vídeo horizontal do c01 da referência)
/// e o ffmpeg real no `PATH`: `cargo test -- --ignored`.
#[test]
#[ignore = "precisa do ffmpeg real e do corte c01 do KGfmaHnBQx4"]
fn o_centro_do_corte_de_referencia_fica_perto_do_resultado_do_cli() {
    use std::sync::atomic::AtomicBool;

    use nucleo::corte::Ffmpeg;

    let corte = std::env::var("SHORTS_CORTE_C01").expect("SHORTS_CORTE_C01 com o caminho do corte");
    let referencia: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../.scratch/shorts-ai-mvp/referencia-kgfmahnbqx4/cortes/c01/face.json"
        ))
        .unwrap(),
    )
    .unwrap();
    let chaves: Vec<(f64, f64)> = referencia["keys"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| (k["t"].as_f64().unwrap(), k["cx"].as_f64().unwrap()))
        .collect();
    let do_cli = |t: f64| {
        let depois = chaves
            .iter()
            .position(|k| k.0 >= t)
            .unwrap_or(chaves.len() - 1);
        let antes = depois.saturating_sub(1);
        let (a, b) = (chaves[antes], chaves[depois]);
        if b.0 <= a.0 {
            return b.1;
        }
        a.1 + (b.1 - a.1) * ((t - a.0) / (b.0 - a.0)).clamp(0.0, 1.0)
    };

    let rastro = Ffmpeg::new("ffmpeg".into(), "ffprobe".into())
        .rastrear_rosto(
            std::path::Path::new(&corte),
            &[],
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap();

    let desvio: f64 = rastro
        .keys
        .iter()
        .map(|k| (k.cx - do_cli(k.t)).abs())
        .sum::<f64>()
        / rastro.keys.len() as f64;
    assert!(desvio < 0.08, "desvio médio do centro {desvio}");
    assert!(rastro.stats.face_ratio >= 0.6);
}
