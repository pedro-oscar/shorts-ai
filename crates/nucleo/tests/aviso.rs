//! O Aviso de uso pela interface pública do núcleo: o aceite, as preferências em que ele fica
//! e o idioma da interface.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use nucleo::{Config, Erro, Evento, IdiomaDaInterface, Nucleo, VERSAO_DO_AVISO};

type Eventos = Arc<Mutex<Vec<Evento>>>;

fn config(dados: &Path, locale: Option<&str>) -> Config {
    Config {
        app_data_dir: dados.to_path_buf(),
        system_locale: locale.map(String::from),
        ..Config::default()
    }
}

fn abrir(dados: &Path) -> Nucleo {
    Nucleo::new(config(dados, None), |_| {})
}

/// O núcleo e os eventos que ele emite, na ordem.
fn abrir_ouvindo(dados: &Path) -> (Nucleo, Eventos) {
    let eventos = Eventos::default();
    let nucleo = Nucleo::new(config(dados, None), {
        let eventos = Arc::clone(&eventos);
        move |evento| eventos.lock().unwrap().push(evento)
    });
    (nucleo, eventos)
}

#[test]
fn o_aceite_e_gravado_e_lido_de_volta() {
    let dados = tempfile::tempdir().unwrap();
    let nucleo = abrir(dados.path());
    assert_eq!(nucleo.estado_inicial().aceite, None);

    let aceite = nucleo.aceitar_aviso().unwrap();

    let reaberto = abrir(dados.path());
    assert_eq!(reaberto.estado_inicial().aceite, Some(aceite));
}

#[test]
fn um_aceite_de_versao_antiga_ou_sem_versao_nao_vale() {
    let casos = [
        format!(
            r#"{{ "aceite": {{ "versao": {}, "data": "2026-10-07T18:30:00Z" }} }}"#,
            VERSAO_DO_AVISO - 1
        ),
        // Como gravava o app antes de o aceite ter versão.
        r#"{ "aceite": { "data": "2026-10-07T18:30:00Z" } }"#.to_owned(),
    ];
    for preferencias in casos {
        let dados = tempfile::tempdir().unwrap();
        fs::write(dados.path().join("preferencias.json"), &preferencias).unwrap();
        let nucleo = abrir(dados.path());

        let estado = nucleo.estado_inicial();
        assert_eq!(estado.aceite, None, "{preferencias}");
        assert_eq!(estado.erro, None, "{preferencias}");

        let aceite = nucleo.aceitar_aviso().unwrap();
        assert_eq!(nucleo.estado_inicial().aceite, Some(aceite));
    }
}

#[test]
fn o_aceite_avisa_a_interface() {
    let dados = tempfile::tempdir().unwrap();
    let (nucleo, eventos) = abrir_ouvindo(dados.path());

    let aceite = nucleo.aceitar_aviso().unwrap();

    assert_eq!(*eventos.lock().unwrap(), [Evento::AvisoAceito { aceite }]);
}

#[test]
fn o_idioma_da_interface_segue_o_do_sistema() {
    let casos = [
        (Some("pt-BR"), IdiomaDaInterface::PtBr),
        (Some("pt_BR.UTF-8"), IdiomaDaInterface::PtBr),
        (Some("pt-PT"), IdiomaDaInterface::PtBr),
        (Some("pt"), IdiomaDaInterface::PtBr),
        (Some("PT_br"), IdiomaDaInterface::PtBr),
        (Some("en-US"), IdiomaDaInterface::En),
        (Some("es-ES"), IdiomaDaInterface::En),
        (Some("C"), IdiomaDaInterface::En),
        (None, IdiomaDaInterface::En),
    ];
    for (locale, esperado) in casos {
        let dados = tempfile::tempdir().unwrap();
        let nucleo = Nucleo::new(config(dados.path(), locale), |_| {});
        assert_eq!(
            nucleo.estado_inicial().idioma_da_interface,
            esperado,
            "{locale:?}"
        );
    }
}

#[test]
fn preferencias_corrompidas_vao_para_um_backup_e_o_aviso_volta() {
    let dados = tempfile::tempdir().unwrap();
    let arquivo = dados.path().join("preferencias.json");
    fs::write(&arquivo, "{ editado à mão").unwrap();
    let nucleo = abrir(dados.path());

    let estado = nucleo.estado_inicial();

    assert_eq!(estado.erro, None);
    assert_eq!(estado.aceite, None);
    let backup = PathBuf::from(estado.backup_das_preferencias.expect("sem backup"));
    assert_eq!(backup.parent(), Some(dados.path()));
    assert_e_backup_de_agora(&backup);
    assert_eq!(fs::read_to_string(&backup).unwrap(), "{ editado à mão");
    assert!(!arquivo.exists());

    let aceite = nucleo.aceitar_aviso().unwrap();
    assert_eq!(abrir(dados.path()).estado_inicial().aceite, Some(aceite));
}

// A interface pode pedir o estado inicial mais de uma vez na mesma execução: o StrictMode do
// React faz isso em desenvolvimento, e a janela pode recarregar.
#[test]
fn o_backup_das_preferencias_vale_ate_o_app_fechar() {
    let dados = tempfile::tempdir().unwrap();
    fs::write(dados.path().join("preferencias.json"), "{ editado à mão").unwrap();
    let nucleo = abrir(dados.path());

    let backup = nucleo.estado_inicial().backup_das_preferencias;

    assert!(backup.is_some());
    assert_eq!(nucleo.estado_inicial().backup_das_preferencias, backup);
    assert_eq!(
        abrir(dados.path()).estado_inicial().backup_das_preferencias,
        None
    );
}

// Uma pasta no lugar do arquivo faz o papel de qualquer erro de leitura, como disco ou
// permissão: o que está lá não é das preferências para o app tirar do caminho.
#[test]
fn preferencias_que_nao_se_leem_viram_erro_sem_perder_o_que_havia() {
    let dados = tempfile::tempdir().unwrap();
    let arquivo = dados.path().join("preferencias.json");
    fs::create_dir(&arquivo).unwrap();
    let nucleo = Nucleo::new(config(dados.path(), Some("pt-BR")), |_| {});

    // O idioma vem do sistema, para a interface explicar o erro.
    let estado = nucleo.estado_inicial();
    assert_eq!(estado.idioma_da_interface, IdiomaDaInterface::PtBr);
    assert_eq!(estado.aceite, None);
    assert_eq!(estado.backup_das_preferencias, None);
    assert!(
        matches!(&estado.erro, Some(Erro::PreferenciasIlegiveis { caminho, .. }) if Path::new(caminho) == arquivo),
        "{:?}",
        estado.erro
    );
    assert!(matches!(
        nucleo.aceitar_aviso(),
        Err(Erro::PreferenciasIlegiveis { .. })
    ));
    assert!(arquivo.is_dir());
    assert_eq!(fs::read_dir(dados.path()).unwrap().count(), 1);
}

/// O backup se chama `preferencias.corrompido-<AAAA-MM-DDTHH-MM-SS>.json`, com o horário da
/// troca em UTC e sem dois-pontos, que o Windows não aceita em nome de arquivo.
fn assert_e_backup_de_agora(backup: &Path) {
    let nome = backup.file_name().unwrap().to_str().unwrap();
    let horario = nome
        .strip_prefix("preferencias.corrompido-")
        .and_then(|resto| resto.strip_suffix(".json"))
        .unwrap_or_else(|| panic!("{nome}"));
    let formato = time::format_description::parse_borrowed::<2>(
        "[year]-[month]-[day]T[hour]-[minute]-[second]",
    )
    .unwrap();
    let horario = time::PrimitiveDateTime::parse(horario, &formato)
        .unwrap_or_else(|erro| panic!("{nome}: {erro}"))
        .assume_utc();
    let desde = time::OffsetDateTime::now_utc() - horario;
    assert!(
        desde >= time::Duration::ZERO && desde < time::Duration::minutes(1),
        "{nome}"
    );
}

// Uma pasta sem permissão de escrita impede o rename; no Windows, só leitura não impediria.
#[cfg(unix)]
#[test]
fn preferencias_corrompidas_sem_backup_viram_erro_sem_perder_o_arquivo() {
    use std::os::unix::fs::PermissionsExt;

    let dados = tempfile::tempdir().unwrap();
    let arquivo = dados.path().join("preferencias.json");
    fs::write(&arquivo, "{ editado à mão").unwrap();
    fs::set_permissions(dados.path(), fs::Permissions::from_mode(0o500)).unwrap();
    let nucleo = abrir(dados.path());

    let estado = nucleo.estado_inicial();
    fs::set_permissions(dados.path(), fs::Permissions::from_mode(0o700)).unwrap();

    assert!(
        matches!(&estado.erro, Some(Erro::PreferenciasIlegiveis { caminho, .. }) if Path::new(caminho) == arquivo),
        "{:?}",
        estado.erro
    );
    assert_eq!(estado.backup_das_preferencias, None);
    assert_eq!(fs::read_to_string(&arquivo).unwrap(), "{ editado à mão");
    assert_eq!(fs::read_dir(dados.path()).unwrap().count(), 1);
}

// Uma pasta sem permissão de escrita; no Windows, só leitura não impede criar arquivos nela.
#[cfg(unix)]
#[test]
fn sem_gravar_o_aceite_nao_vale_nem_avisa_a_interface() {
    use std::os::unix::fs::PermissionsExt;

    let dados = tempfile::tempdir().unwrap();
    fs::set_permissions(dados.path(), fs::Permissions::from_mode(0o500)).unwrap();
    let (nucleo, eventos) = abrir_ouvindo(dados.path());

    let erro = nucleo.aceitar_aviso().unwrap_err();
    fs::set_permissions(dados.path(), fs::Permissions::from_mode(0o700)).unwrap();

    assert!(
        matches!(erro, Erro::PreferenciasNaoGravadas { .. }),
        "{erro:?}"
    );
    assert!(eventos.lock().unwrap().is_empty());
    assert_eq!(nucleo.estado_inicial().aceite, None);
}
