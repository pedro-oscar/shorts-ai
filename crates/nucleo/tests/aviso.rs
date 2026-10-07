//! O Aviso de uso pela interface pública do núcleo: o aceite e o idioma da interface.

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use nucleo::{Config, Erro, Evento, IdiomaDaInterface, Nucleo};

type Eventos = Arc<Mutex<Vec<Evento>>>;

fn config(dados: &Path, locale: Option<&str>) -> Config {
    Config {
        app_data_dir: dados.to_path_buf(),
        system_locale: locale.map(String::from),
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
fn preferencias_ilegiveis_viram_erro_sem_perder_o_arquivo() {
    let dados = tempfile::tempdir().unwrap();
    let arquivo = dados.path().join("preferencias.json");
    fs::write(&arquivo, "{ editado à mão").unwrap();
    let nucleo = Nucleo::new(config(dados.path(), Some("pt-BR")), |_| {});

    // O idioma vem do sistema, para a interface explicar o erro.
    let estado = nucleo.estado_inicial();
    assert_eq!(estado.idioma_da_interface, IdiomaDaInterface::PtBr);
    assert_eq!(estado.aceite, None);
    assert!(
        matches!(&estado.erro, Some(Erro::PreferenciasIlegiveis { caminho, .. }) if Path::new(caminho) == arquivo),
        "{:?}",
        estado.erro
    );
    assert!(matches!(
        nucleo.aceitar_aviso(),
        Err(Erro::PreferenciasIlegiveis { .. })
    ));
    assert_eq!(fs::read_to_string(&arquivo).unwrap(), "{ editado à mão");
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
