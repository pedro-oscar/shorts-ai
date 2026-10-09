//! Casca Tauri do Shorts AI: fina, expõe os comandos do núcleo e repassa os eventos dele.
//! Os tipos da interface (`interface/src/bindings.ts`) saem daqui, pelo `tauri-specta`.

// Sem a janela de console no Windows, nas builds de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use nucleo::{
    Aceite, Config, Erro, EstadoDaConta, EstadoInicial, Evento, ModoDeLogin, NivelDoPlano, Nucleo,
    PeriodoDeCobranca, PlanoConfirmado,
};
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

#[tauri::command]
#[specta::specta]
async fn verificar_conta(app: AppHandle) -> EstadoDaConta {
    // Roda o `claude` como processo filho: fora da thread do runtime async.
    tauri::async_runtime::spawn_blocking(move || app.state::<Nucleo>().verificar_conta())
        .await
        .unwrap_or(EstadoDaConta::NaoInstalado)
}

/// "Entrar no Claude Code": espera o login terminar, o que leva minutos.
#[tauri::command]
#[specta::specta]
async fn entrar_no_claude_code(
    app: AppHandle,
    modo: ModoDeLogin,
    por_terminal: bool,
) -> Result<EstadoDaConta, Erro> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Nucleo>()
            .entrar_no_claude_code(modo, por_terminal)
    })
    .await
    .map_err(|error| Erro::LoginNaoConcluido {
        detalhe: error.to_string(),
    })?
}

#[tauri::command]
#[specta::specta]
async fn instalar_claude_code(app: AppHandle) -> Result<EstadoDaConta, Erro> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Nucleo>().instalar_claude_code())
        .await
        .map_err(|error| Erro::InstalacaoFalhou {
            detalhe: error.to_string(),
        })?
}

#[tauri::command]
#[specta::specta]
async fn atualizar_claude_code(app: AppHandle) -> Result<EstadoDaConta, Erro> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Nucleo>().atualizar_claude_code())
        .await
        .map_err(|error| Erro::AtualizacaoFalhou {
            detalhe: error.to_string(),
        })?
}

#[tauri::command]
#[specta::specta]
async fn confirmar_plano(
    nucleo: State<'_, Nucleo>,
    nivel: NivelDoPlano,
    periodo: PeriodoDeCobranca,
) -> Result<PlanoConfirmado, Erro> {
    nucleo.confirmar_plano(nivel, periodo)
}

#[tauri::command]
#[specta::specta]
async fn testar_claude(app: AppHandle) -> Result<(), Erro> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Nucleo>().testar_claude())
        .await
        .map_err(|error| Erro::ClaudeNaoRespondeu {
            detalhe: error.to_string(),
        })?
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
        .commands(collect_commands![
            estado_inicial,
            aceitar_aviso,
            verificar_conta,
            entrar_no_claude_code,
            instalar_claude_code,
            atualizar_claude_code,
            confirmar_plano,
            testar_claude,
            sair
        ])
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
                    path_env: std::env::var_os("PATH"),
                    home_dir: app.path().home_dir().ok(),
                    chave_de_api_no_ambiente: std::env::var_os("ANTHROPIC_API_KEY")
                        .is_some_and(|chave| !chave.is_empty()),
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
