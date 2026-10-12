//! As Configurações e o Diagnóstico pela interface pública do núcleo: a troca da Biblioteca
//! e do idioma da interface, e o retrato da máquina com programas de mentira.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use nucleo::{
    Config, Erro, Gpu, IdiomaDaInterface, LigarArquivo, NomeDaDependencia, Nucleo, Padroes,
    SituacaoDaDependencia,
};

fn config(dados: &Path, videos: &Path) -> Config {
    Config {
        app_data_dir: dados.to_path_buf(),
        pasta_de_videos: Some(videos.to_path_buf()),
        system_locale: Some("pt-BR".to_owned()),
        ..Config::default()
    }
}

fn abrir(dados: &Path, videos: &Path) -> Nucleo {
    Nucleo::new(config(dados, videos), |_| {})
}

fn video(pasta: &Path) -> String {
    fs::create_dir_all(pasta).unwrap();
    let caminho = pasta.join("aula.mp4");
    fs::write(&caminho, b"video de mentira").unwrap();
    caminho.display().to_string()
}

#[test]
fn a_biblioteca_trocada_vale_agora_e_na_proxima_vez_que_o_app_abre() {
    let tmp = tempfile::tempdir().unwrap();
    let dados = tmp.path().join("dados");
    let nucleo = abrir(&dados, &tmp.path().join("Videos"));
    let nova = tmp.path().join("outro-disco").join("Meus Reels");

    let gravada = nucleo.definir_biblioteca(nova.to_str().unwrap()).unwrap();

    assert_eq!(gravada, nova.display().to_string());
    assert!(nova.is_dir());
    assert_eq!(nucleo.estado_inicial().biblioteca, gravada);
    let reaberto = abrir(&dados, &tmp.path().join("Videos"));
    assert_eq!(reaberto.estado_inicial().biblioteca, gravada);
}

#[test]
fn os_projetos_copiados_para_a_nova_biblioteca_aparecem() {
    let tmp = tempfile::tempdir().unwrap();
    let antiga = tmp.path().join("antiga");
    let origem = abrir(&tmp.path().join("dados-a"), &antiga);
    let projetos = origem
        .criar_lote(&[video(&tmp.path().join("entrada"))], &Padroes::default())
        .unwrap();
    let biblioteca_antiga = PathBuf::from(origem.estado_inicial().biblioteca);

    let destino = abrir(&tmp.path().join("dados-b"), &tmp.path().join("vazia"));
    assert!(destino.lotes().is_empty());
    destino
        .definir_biblioteca(biblioteca_antiga.to_str().unwrap())
        .unwrap();

    let lotes = destino.lotes();
    assert_eq!(lotes.len(), 1);
    assert_eq!(lotes[0].projetos[0].id, projetos[0].id);
}

#[test]
fn com_projeto_na_fila_a_biblioteca_nao_muda() {
    let tmp = tempfile::tempdir().unwrap();
    let (solta, espera) = mpsc::channel::<()>();
    let espera = Mutex::new(espera);
    let ligar: LigarArquivo = Arc::new(move |_, _| {
        let _ = espera.lock().unwrap().recv();
        Err(std::io::Error::other("parado pelo teste"))
    });
    let nucleo = Nucleo::new(
        Config {
            ligar_arquivo: Some(ligar),
            ..config(&tmp.path().join("dados"), &tmp.path().join("Videos"))
        },
        |_| {},
    );
    nucleo
        .criar_lote(&[video(&tmp.path().join("entrada"))], &Padroes::default())
        .unwrap();
    let antes = nucleo.estado_inicial().biblioteca;

    let nova = tmp.path().join("nova");
    let erro = nucleo
        .definir_biblioteca(nova.to_str().unwrap())
        .unwrap_err();

    assert_eq!(erro, Erro::BibliotecaOcupada);
    assert_eq!(nucleo.estado_inicial().biblioteca, antes);
    assert!(!nova.exists());
    drop(solta);
}

#[test]
fn caminho_que_nao_e_absoluto_ou_nao_vira_pasta_nao_troca_a_biblioteca() {
    let tmp = tempfile::tempdir().unwrap();
    let nucleo = abrir(&tmp.path().join("dados"), &tmp.path().join("Videos"));
    let antes = nucleo.estado_inicial().biblioteca;
    let arquivo = tmp.path().join("arquivo");
    fs::write(&arquivo, b"x").unwrap();

    for caminho in ["", "relativo", arquivo.join("dentro").to_str().unwrap()] {
        let erro = nucleo.definir_biblioteca(caminho).unwrap_err();
        assert!(
            matches!(erro, Erro::BibliotecaNaoTrocada { .. }),
            "{caminho}: {erro:?}"
        );
    }
    assert_eq!(nucleo.estado_inicial().biblioteca, antes);
}

#[test]
fn o_idioma_escolhido_vale_no_lugar_do_do_sistema_e_fica_gravado() {
    let tmp = tempfile::tempdir().unwrap();
    let dados = tmp.path().join("dados");
    let nucleo = abrir(&dados, tmp.path());
    assert_eq!(
        nucleo.estado_inicial().idioma_da_interface,
        IdiomaDaInterface::PtBr
    );

    nucleo.definir_idioma(IdiomaDaInterface::En).unwrap();

    assert_eq!(
        nucleo.estado_inicial().idioma_da_interface,
        IdiomaDaInterface::En
    );
    assert_eq!(
        abrir(&dados, tmp.path())
            .estado_inicial()
            .idioma_da_interface,
        IdiomaDaInterface::En
    );
}

#[cfg(unix)]
mod diagnostico {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    fn executavel(caminho: &Path, conteudo: &str) {
        fs::write(caminho, conteudo).unwrap();
        fs::set_permissions(caminho, fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// Um ffmpeg que lista só os encoders e filtros dados.
    fn ffmpeg_de_mentira(encoders: &[&str], filtros: &[&str]) -> String {
        let lista = |nomes: &[&str]| {
            nomes
                .iter()
                .map(|nome| format!("echo ' V....D {nome} descricao'"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        format!(
            "#!/bin/sh\ncase \"$*\" in\n*-encoders*) {} ;;\n*-filters*) {} ;;\n*) echo 'ffmpeg version 7.1.1 Copyright (c) 2000-2025' ;;\nesac\n",
            lista(encoders),
            lista(filtros)
        )
    }

    const TODOS_ENCODERS: [&str; 3] = ["libx264", "aac", "wrapped_avframe"];
    const TODOS_FILTROS: [&str; 3] = ["zscale", "loudnorm", "signalstats"];

    fn cenario(sidecars: &Path) -> (tempfile::TempDir, Nucleo) {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(sidecars).unwrap();
        let nucleo = Nucleo::new(
            Config {
                sidecar_dir: Some(sidecars.to_path_buf()),
                path_env: Some("/nao/existe".into()),
                carregadores_do_vulkan: Some(vec![]),
                ..config(&tmp.path().join("dados"), &tmp.path().join("Videos"))
            },
            |_| {},
        );
        (tmp, nucleo)
    }

    fn situacao(nucleo: &Nucleo, nome: NomeDaDependencia) -> SituacaoDaDependencia {
        nucleo
            .diagnosticar()
            .dependencias
            .into_iter()
            .find(|dependencia| dependencia.nome == nome)
            .unwrap()
            .situacao
    }

    #[test]
    fn sem_nada_instalado_tudo_falta_e_a_gpu_e_so_cpu() {
        let sidecars = tempfile::tempdir().unwrap();
        let (_tmp, nucleo) = cenario(sidecars.path());

        let diagnostico = nucleo.diagnosticar();

        assert_eq!(diagnostico.gpu, Gpu::SoCpu);
        assert!(diagnostico.espaco_livre_em_mb.is_some());
        assert_eq!(diagnostico.dependencias.len(), 7);
        assert!(
            diagnostico
                .dependencias
                .iter()
                .all(|dependencia| dependencia.situacao == SituacaoDaDependencia::Ausente)
        );
    }

    #[test]
    fn o_ffmpeg_completo_aparece_com_a_versao() {
        let sidecars = tempfile::tempdir().unwrap();
        executavel(
            &sidecars.path().join("ffmpeg"),
            &ffmpeg_de_mentira(&TODOS_ENCODERS, &TODOS_FILTROS),
        );
        let (_tmp, nucleo) = cenario(sidecars.path());

        assert_eq!(
            situacao(&nucleo, NomeDaDependencia::Ffmpeg),
            SituacaoDaDependencia::Presente {
                versao: Some("7.1.1".to_owned())
            }
        );
    }

    #[test]
    fn o_ffmpeg_sem_encoder_ou_filtro_diz_o_que_falta() {
        let sidecars = tempfile::tempdir().unwrap();
        executavel(
            &sidecars.path().join("ffmpeg"),
            &ffmpeg_de_mentira(&["libx264", "aac"], &["loudnorm", "signalstats"]),
        );
        let (_tmp, nucleo) = cenario(sidecars.path());

        assert_eq!(
            situacao(&nucleo, NomeDaDependencia::Ffmpeg),
            SituacaoDaDependencia::Incompleta {
                faltam: vec!["wrapped_avframe".to_owned(), "zscale".to_owned()]
            }
        );
    }

    #[test]
    fn yt_dlp_e_node_mostram_a_versao_e_o_whisper_so_a_presenca() {
        let sidecars = tempfile::tempdir().unwrap();
        executavel(
            &sidecars.path().join("yt-dlp"),
            "#!/bin/sh\necho 2026.10.01\n",
        );
        executavel(&sidecars.path().join("node"), "#!/bin/sh\necho v22.22.1\n");
        executavel(&sidecars.path().join("whisper-cli"), "#!/bin/sh\n");
        let (_tmp, nucleo) = cenario(sidecars.path());

        assert_eq!(
            situacao(&nucleo, NomeDaDependencia::YtDlp),
            SituacaoDaDependencia::Presente {
                versao: Some("2026.10.01".to_owned())
            }
        );
        assert_eq!(
            situacao(&nucleo, NomeDaDependencia::Node),
            SituacaoDaDependencia::Presente {
                versao: Some("v22.22.1".to_owned())
            }
        );
        assert_eq!(
            situacao(&nucleo, NomeDaDependencia::Whisper),
            SituacaoDaDependencia::Presente { versao: None }
        );
    }

    #[test]
    fn a_gpu_e_vulkan_com_o_whisper_de_vulkan_e_o_carregador_do_driver() {
        let sidecars = tempfile::tempdir().unwrap();
        executavel(&sidecars.path().join("whisper-cli"), "#!/bin/sh\n");
        let loader = sidecars.path().join("libvulkan.so.1");
        fs::write(&loader, b"").unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let com_loader = |carregadores| {
            Nucleo::new(
                Config {
                    sidecar_dir: Some(sidecars.path().to_path_buf()),
                    path_env: Some("/nao/existe".into()),
                    carregadores_do_vulkan: Some(carregadores),
                    ..config(&tmp.path().join("dados"), &tmp.path().join("Videos"))
                },
                |_| {},
            )
        };

        assert_eq!(com_loader(vec![loader]).diagnosticar().gpu, Gpu::Vulkan);
        assert_eq!(
            com_loader(vec![tmp.path().join("nao-ha")])
                .diagnosticar()
                .gpu,
            Gpu::SoCpu
        );
    }

    #[test]
    fn modelo_dependencias_e_chrome_seguem_os_arquivos_dos_dados_do_app() {
        let sidecars = tempfile::tempdir().unwrap();
        let (tmp, nucleo) = cenario(sidecars.path());
        let dados = tmp.path().join("dados");
        let modelos = dados.join("modelos");
        fs::create_dir_all(&modelos).unwrap();
        fs::write(modelos.join(nucleo::transcricao::MODEL_FILE), b"").unwrap();
        fs::write(modelos.join(nucleo::transcricao::VAD_MODEL_FILE), b"").unwrap();
        fs::create_dir_all(dados.join("remotion/node_modules")).unwrap();
        fs::write(dados.join("remotion/node_modules/.package-lock.json"), b"").unwrap();

        let presente = SituacaoDaDependencia::Presente { versao: None };
        assert_eq!(
            situacao(&nucleo, NomeDaDependencia::ModeloDeTranscricao),
            presente
        );
        assert_eq!(
            situacao(&nucleo, NomeDaDependencia::DependenciasDoRemotion),
            presente
        );
        assert_eq!(
            situacao(&nucleo, NomeDaDependencia::Chrome),
            SituacaoDaDependencia::Ausente
        );
    }
}
