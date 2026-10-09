//! A duração dos vídeos escolhidos, lida por um `ffprobe` falso no `PATH`.
#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;

use nucleo::{Config, Nucleo};

#[test]
fn a_duracao_vem_do_ffprobe_do_path() {
    let tmp = tempfile::tempdir().unwrap();
    let bin = tmp.path().join("bin");
    fs::create_dir(&bin).unwrap();
    let ffprobe = bin.join("ffprobe");
    fs::write(&ffprobe, "#!/bin/sh\necho 125.5\n").unwrap();
    fs::set_permissions(&ffprobe, fs::Permissions::from_mode(0o755)).unwrap();
    let video = tmp.path().join("aula.mp4");
    fs::write(&video, b"x").unwrap();
    let nucleo = Nucleo::new(
        Config {
            app_data_dir: tmp.path().join("dados"),
            path_env: Some(bin.into_os_string()),
            ..Config::default()
        },
        |_| {},
    );

    let lista = nucleo
        .inspecionar_arquivos(&[video.display().to_string()])
        .unwrap();

    assert_eq!(lista[0].duracao_em_segundos, Some(125.5));
}
