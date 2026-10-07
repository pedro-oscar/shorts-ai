//! Casca Tauri do Shorts AI: fina, expõe os comandos do núcleo e repassa os eventos dele.
//! Os tipos da interface (`interface/src/bindings.ts`) saem daqui, pelo `tauri-specta`.

// Sem a janela de console no Windows, nas builds de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use nucleo::{Aceite, Config, Erro, EstadoInicial, Evento, Nucleo};
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Manager, State};
use tauri_specta::{Builder, Event, collect_commands, collect_events};

/// Os eventos do núcleo num só canal: a interface os aplica em ordem no estado dela.
#[derive(Clone, Serialize, Type, Event)]
struct EventoDoNucleo(Evento);

// Os comandos são async para rodarem fora da thread principal. Este pega o núcleo pelo
// AppHandle porque um comando async com `State` emprestado precisa devolver Result.
#[tauri::command]
#[specta::specta]
async fn estado_inicial(app: AppHandle) -> EstadoInicial {
    app.state::<Nucleo>().estado_inicial()
}

#[tauri::command]
#[specta::specta]
async fn aceitar_aviso(nucleo: State<'_, Nucleo>) -> Result<Aceite, Erro> {
    nucleo.aceitar_aviso()
}

/// "Sair" no Aviso de uso: fecha o app.
#[tauri::command]
#[specta::specta]
fn sair(app: AppHandle) {
    app.exit(0);
}

fn bindings() -> Builder<tauri::Wry> {
    Builder::new()
        // Os tipos têm o mesmo formato na ida e na volta: sem `Tipo_Serialize`/`_Deserialize`.
        .disable_serde_phases()
        .commands(collect_commands![estado_inicial, aceitar_aviso, sair])
        .events(collect_events![EventoDoNucleo])
}

fn main() {
    let bindings = bindings();
    tauri::Builder::default()
        // O primeiro plugin: uma segunda instância só traz a janela da primeira para a frente.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                // Se a janela não voltar, a pessoa ainda a acha na barra de tarefas.
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(bindings.invoke_handler())
        .setup(move |app| {
            bindings.mount_events(app);
            let handle = app.handle().clone();
            let nucleo = Nucleo::new(
                Config {
                    app_data_dir: app.path().app_data_dir()?,
                    system_locale: sys_locale::get_locale(),
                },
                move |evento| {
                    if let Err(error) = EventoDoNucleo(evento).emit(&handle) {
                        eprintln!("evento do núcleo não repassado à interface: {error}");
                    }
                },
            );
            app.manage(nucleo);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("o Tauri não conseguiu abrir o app");
}

#[cfg(test)]
mod tests {
    use specta_typescript::Typescript;

    /// Regenera os bindings e falha se eles mudaram, para a mudança ir no mesmo commit que
    /// o comando ou o evento que a causou.
    #[test]
    fn bindings_da_interface_em_dia() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../interface/src/bindings.ts");
        let before = std::fs::read_to_string(path).unwrap_or_default();
        super::bindings()
            .export(
                Typescript::default()
                    .header("// Gerado pelo tauri-specta (src-tauri/src/main.rs); não edite."),
                path,
            )
            .unwrap();
        let after = std::fs::read_to_string(path).unwrap();
        assert!(
            before == after,
            "interface/src/bindings.ts estava desatualizado e foi regenerado: confira e inclua no commit"
        );
    }
}
