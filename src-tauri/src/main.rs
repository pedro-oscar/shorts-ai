//! Casca Tauri do Shorts AI: fina, expõe os comandos do núcleo e repassa os eventos dele.
//! Os tipos da interface (`interface/src/bindings.ts`) saem daqui, pelo `tauri-specta`.

// Sem a janela de console no Windows, nas builds de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use nucleo::{
    Aceite, AlvoParaAbrir, ArquivoDeVideo, ArquivoDoLote, Config, Cotacao, DadosDoProjeto,
    Diagnostico, Erro, EstadoDaConta, EstadoDaPreparacao, EstadoInicial, Estimativa, Evento,
    Excecoes, IdiomaDaInterface, InfoDoLink, Kit, LinkDoLote, LoteResumo, ModoDeLogin,
    MotivoDeNotificacao, Movimento, NivelDoPlano, Nucleo, Padroes, Paralelismo, PeriodoDeCobranca,
    PlanoConfirmado, ProjetoResumo, Regra,
};
use serde::Serialize;
use specta::Type;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::{Update, UpdaterExt};
use tauri_specta::{Builder, Event, collect_commands, collect_events};

/// Os eventos do núcleo num só canal: a interface os aplica em ordem no estado dela.
#[derive(Clone, Serialize, Type, Event)]
struct EventoDoNucleo(Evento);

/// Uma versão nova do app foi baixada e espera o "Reiniciar e atualizar".
#[derive(Clone, Serialize, Type, Event)]
struct AtualizacaoPronta {
    versao: String,
}

/// A atualização baixada: o pacote fica num arquivo, porque o AppImage passa de 400 MB.
#[derive(Default)]
struct AtualizacaoBaixada(Mutex<Option<(Update, PathBuf)>>);

impl AtualizacaoBaixada {
    fn travar(&self) -> std::sync::MutexGuard<'_, Option<(Update, PathBuf)>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// No Windows, o Tauri instala os sidecars ao lado do executável do app. No Linux, eles vão
/// como recursos em bin/ (src-tauri/tauri.sidecars.linux.conf.json): ao lado do executável,
/// o .deb os poria no /usr/bin, em conflito com o ffmpeg do sistema. No desenvolvimento, o
/// cargo deixa o `shorts-cli` ao lado do executável.
fn pasta_dos_sidecars(app: &tauri::App) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("bin"))
        .filter(|dir| dir.is_dir())
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(std::path::Path::to_path_buf))
        })
}

/// Procura a versão nova nas Releases e a baixa em segundo plano; a interface só fica sabendo
/// quando ela está pronta para instalar.
async fn baixar_atualizacao(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let saindo = app.clone();
    let updater = app
        .updater_builder()
        // No Windows, o `install` sai do app para o instalador rodar, e ele não troca um
        // sidecar que ainda roda: o lote para antes, e o projeto volta Pausado.
        .on_before_exit(move || {
            saindo.state::<Nucleo>().interromper();
            saindo.cleanup_before_exit();
        })
        .build()?;
    let Some(atualizacao) = updater.check().await? else {
        return Ok(());
    };
    let pacote = atualizacao.download(|_, _| {}, || {}).await?;
    let pasta = app.path().app_cache_dir()?.join("atualizacao");
    std::fs::create_dir_all(&pasta)?;
    let arquivo = pasta.join(format!("shorts-ai-{}", atualizacao.version));
    std::fs::write(&arquivo, pacote)?;
    let versao = atualizacao.version.clone();
    *app.state::<AtualizacaoBaixada>().travar() = Some((atualizacao, arquivo));
    AtualizacaoPronta { versao }.emit(&app)?;
    Ok(())
}

/// O título e o corpo da notificação do sistema, no idioma do sistema (português ou inglês).
fn texto_da_notificacao(
    motivo: MotivoDeNotificacao,
    projeto: &str,
    lote: &str,
    locale: Option<&str>,
) -> (String, String) {
    let em_portugues = locale.is_some_and(|locale| locale.to_lowercase().starts_with("pt"));
    let (titulo, corpo) = match (motivo, em_portugues) {
        (MotivoDeNotificacao::ProjetoPronto, true) => ("Projeto pronto", projeto),
        (MotivoDeNotificacao::ProjetoPronto, false) => ("Project ready", projeto),
        (MotivoDeNotificacao::ProjetoFalhou, true) => ("Projeto falhou", projeto),
        (MotivoDeNotificacao::ProjetoFalhou, false) => ("Project failed", projeto),
        (MotivoDeNotificacao::AguardandoCota, true) => ("Aguardando cota", projeto),
        (MotivoDeNotificacao::AguardandoCota, false) => ("Waiting for quota", projeto),
        (MotivoDeNotificacao::LoteTerminado, true) => ("Lote terminado", lote),
        (MotivoDeNotificacao::LoteTerminado, false) => ("Batch finished", lote),
    };
    (titulo.to_owned(), corpo.to_owned())
}

// Os comandos são async para rodarem fora da thread principal. Este pega o núcleo pelo
// AppHandle porque um comando async com `State` emprestado precisa devolver Result.
#[tauri::command]
#[specta::specta]
async fn estado_inicial(app: AppHandle) -> EstadoInicial {
    app.state::<Nucleo>().estado_inicial()
}

#[tauri::command]
#[specta::specta]
async fn verificar_preparacao(app: AppHandle) -> EstadoDaPreparacao {
    app.state::<Nucleo>().verificar_preparacao()
}

/// Baixa o que falta da preparação: leva minutos, fora da thread do runtime async.
#[tauri::command]
#[specta::specta]
async fn preparar(app: AppHandle) -> Result<EstadoDaPreparacao, Erro> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Nucleo>().preparar())
        .await
        .map_err(|error| Erro::PreparacaoInterrompida {
            detalhe: error.to_string(),
        })
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
async fn definir_multiplicador(
    nucleo: State<'_, Nucleo>,
    multiplicador: Option<f64>,
) -> Result<PlanoConfirmado, Erro> {
    nucleo.definir_multiplicador(multiplicador)
}

#[tauri::command]
#[specta::specta]
async fn definir_cotacao(
    nucleo: State<'_, Nucleo>,
    valor: Option<f64>,
) -> Result<Option<Cotacao>, Erro> {
    nucleo.definir_cotacao(valor)
}

#[tauri::command]
#[specta::specta]
async fn definir_videos_ao_mesmo_tempo(
    nucleo: State<'_, Nucleo>,
    videos: Option<u8>,
) -> Result<Paralelismo, Erro> {
    nucleo.definir_videos_ao_mesmo_tempo(videos)
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

/// O seletor de pastas do sistema, para a Biblioteca nova; `None` se a pessoa cancela.
#[tauri::command]
#[specta::specta]
async fn escolher_pasta(app: AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|pasta| pasta.into_path().ok())
            .map(|caminho| caminho.display().to_string())
    })
    .await
    .unwrap_or_default()
}

/// Muda a Biblioteca e libera a pasta nova para o player da interface.
#[tauri::command]
#[specta::specta]
async fn definir_biblioteca(app: AppHandle, caminho: String) -> Result<String, Erro> {
    let biblioteca = app.state::<Nucleo>().definir_biblioteca(&caminho)?;
    app.asset_protocol_scope()
        .allow_directory(&biblioteca, true)
        .map_err(|error| Erro::BibliotecaNaoTrocada {
            caminho,
            detalhe: error.to_string(),
        })?;
    Ok(biblioteca)
}

#[tauri::command]
#[specta::specta]
async fn definir_idioma(nucleo: State<'_, Nucleo>, idioma: IdiomaDaInterface) -> Result<(), Erro> {
    nucleo.definir_idioma(idioma)
}

#[tauri::command]
#[specta::specta]
async fn kits(nucleo: State<'_, Nucleo>) -> Result<Vec<Kit>, Erro> {
    nucleo.kits()
}

#[tauri::command]
#[specta::specta]
async fn salvar_kit(nucleo: State<'_, Nucleo>, kit: Kit) -> Result<Vec<Kit>, Erro> {
    nucleo.salvar_kit(kit)
}

#[tauri::command]
#[specta::specta]
async fn verificar_logo(
    nucleo: State<'_, Nucleo>,
    caminho: String,
) -> Result<nucleo::VerificacaoDaLogo, Erro> {
    nucleo.verificar_logo(&caminho)
}

#[tauri::command]
#[specta::specta]
async fn apagar_kit(nucleo: State<'_, Nucleo>, nome: String) -> Result<Vec<Kit>, Erro> {
    nucleo.apagar_kit(&nome)
}

#[tauri::command]
#[specta::specta]
async fn fontes_embutidas() -> Vec<String> {
    nucleo::kit::fontes_embutidas()
}

#[tauri::command]
#[specta::specta]
async fn regras_aprendidas(nucleo: State<'_, Nucleo>) -> Result<Vec<Regra>, Erro> {
    nucleo.regras_aprendidas()
}

#[tauri::command]
#[specta::specta]
async fn editar_regra_aprendida(
    nucleo: State<'_, Nucleo>,
    indice: u32,
    texto: String,
) -> Result<Vec<Regra>, Erro> {
    nucleo.editar_regra_aprendida(indice, &texto)
}

#[tauri::command]
#[specta::specta]
async fn apagar_regra_aprendida(
    nucleo: State<'_, Nucleo>,
    indice: u32,
) -> Result<Vec<Regra>, Erro> {
    nucleo.apagar_regra_aprendida(indice)
}

/// O retrato da máquina; roda programas filhos, fora da thread do runtime async.
#[tauri::command]
#[specta::specta]
async fn diagnosticar(app: AppHandle) -> Result<Diagnostico, Erro> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Nucleo>().diagnosticar())
        .await
        .map_err(|error| Erro::PreparacaoInterrompida {
            detalhe: error.to_string(),
        })
}

/// O seletor de arquivos do sistema, só com os vídeos que o app aceita.
#[tauri::command]
#[specta::specta]
async fn escolher_arquivos(app: AppHandle) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Vídeos", &["mp4", "mov", "mkv"])
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|arquivo| arquivo.into_path().ok())
            .map(|caminho| caminho.display().to_string())
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// O seletor de arquivos do sistema para a logo do kit: PNG ou SVG.
#[tauri::command]
#[specta::specta]
async fn escolher_logo(app: AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Logo", &["png", "svg"])
            .blocking_pick_file()
            .and_then(|arquivo| arquivo.into_path().ok())
            .map(|caminho| caminho.display().to_string())
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
#[specta::specta]
async fn inspecionar_arquivos(
    app: AppHandle,
    caminhos: Vec<String>,
) -> Result<Vec<ArquivoDeVideo>, Erro> {
    // Roda o `ffprobe` como processo filho: fora da thread do runtime async.
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Nucleo>().inspecionar_arquivos(&caminhos)
    })
    .await
    .map_err(|error| Erro::ProjetoNaoCriado {
        caminho: String::new(),
        detalhe: error.to_string(),
    })?
}

/// Estima o custo, as sessões do Claude e o tempo do lote antes de gerar.
#[tauri::command]
#[specta::specta]
async fn estimar_lote(
    nucleo: State<'_, Nucleo>,
    padroes: Padroes,
    duracoes_em_segundos: Vec<Option<f64>>,
) -> Result<Estimativa, Erro> {
    nucleo.estimar(&padroes, &duracoes_em_segundos)
}

#[tauri::command]
#[specta::specta]
async fn criar_lote(
    nucleo: State<'_, Nucleo>,
    arquivos: Vec<ArquivoDoLote>,
    links: Vec<LinkDoLote>,
    padroes: Padroes,
) -> Result<Vec<ProjetoResumo>, Erro> {
    nucleo.criar_lote_com_links(&arquivos, &links, &padroes)
}

/// Define as exceções de um projeto que ainda não começou.
#[tauri::command]
#[specta::specta]
async fn definir_excecoes(
    nucleo: State<'_, Nucleo>,
    projeto: String,
    excecoes: Excecoes,
) -> Result<ProjetoResumo, Erro> {
    nucleo.definir_excecoes(&projeto, &excecoes)
}

/// Põe vídeos no fim da fila de um lote que já existe, com os padrões dele.
#[tauri::command]
#[specta::specta]
async fn adicionar_ao_lote(
    nucleo: State<'_, Nucleo>,
    lote: String,
    arquivos: Vec<ArquivoDoLote>,
    links: Vec<LinkDoLote>,
) -> Result<Vec<ProjetoResumo>, Erro> {
    nucleo.adicionar_ao_lote(&lote, &arquivos, &links)
}

#[tauri::command]
#[specta::specta]
async fn renomear_lote(nucleo: State<'_, Nucleo>, lote: String, nome: String) -> Result<(), Erro> {
    nucleo.renomear_lote(&lote, &nome)
}

/// Os lotes da Biblioteca, do mais novo para o mais antigo.
#[tauri::command]
#[specta::specta]
async fn lotes(app: AppHandle) -> Vec<LoteResumo> {
    app.state::<Nucleo>().lotes()
}

/// Pausa o projeto ao fim da etapa, ou o tira da fila se ainda não começou.
#[tauri::command]
#[specta::specta]
async fn pausar_projeto(nucleo: State<'_, Nucleo>, id: String) -> Result<(), Erro> {
    nucleo.pausar(&id)
}

/// Cancela o projeto na hora, descartando a etapa em curso.
#[tauri::command]
#[specta::specta]
async fn cancelar_projeto(nucleo: State<'_, Nucleo>, id: String) -> Result<(), Erro> {
    nucleo.cancelar(&id)
}

/// Põe o projeto pausado ou cancelado no fim da fila.
#[tauri::command]
#[specta::specta]
async fn retomar_projeto(nucleo: State<'_, Nucleo>, id: String) -> Result<(), Erro> {
    nucleo.retomar(&id)
}

/// Retoma os projetos pausados do lote, na ordem dele.
#[tauri::command]
#[specta::specta]
async fn retomar_lote(nucleo: State<'_, Nucleo>, lote: String) -> Result<(), Erro> {
    nucleo.retomar_lote(&lote)
}

/// Põe o projeto que falhou no fim da fila, para recomeçar da etapa que falhou.
#[tauri::command]
#[specta::specta]
async fn tentar_de_novo(nucleo: State<'_, Nucleo>, id: String) -> Result<(), Erro> {
    nucleo.tentar_de_novo(&id)
}

/// Anda com o projeto que espera a vez na fila.
#[tauri::command]
#[specta::specta]
async fn mover_na_fila(
    nucleo: State<'_, Nucleo>,
    id: String,
    movimento: Movimento,
) -> Result<(), Erro> {
    nucleo.mover_na_fila(&id, movimento)
}

/// Tira da lista o projeto que nunca começou e apaga a pasta dele.
#[tauri::command]
#[specta::specta]
async fn remover_projeto(nucleo: State<'_, Nucleo>, id: String) -> Result<(), Erro> {
    nucleo.remover_projeto(&id)
}

/// Exclui o projeto e devolve os bytes que a exclusão liberou.
#[tauri::command]
#[specta::specta]
async fn excluir_projeto(nucleo: State<'_, Nucleo>, id: String) -> Result<f64, Erro> {
    #[allow(clippy::cast_precision_loss)]
    nucleo.excluir_projeto(&id).map(|bytes| bytes as f64)
}

/// Tira do histórico o projeto cuja pasta sumiu da Biblioteca.
#[tauri::command]
#[specta::specta]
async fn tirar_do_historico(nucleo: State<'_, Nucleo>, id: String) -> Result<(), Erro> {
    nucleo.tirar_do_historico(&id)
}

/// Aponta o projeto para o arquivo que a pessoa localizou no lugar do vídeo original.
#[tauri::command]
#[specta::specta]
async fn localizar_video(
    nucleo: State<'_, Nucleo>,
    id: String,
    caminho: String,
) -> Result<(), Erro> {
    nucleo.localizar_video(&id, &caminho)
}

/// Título, canal e duração de um vídeo do YouTube, antes de baixar.
#[tauri::command]
#[specta::specta]
async fn consultar_link(app: AppHandle, url: String) -> Result<InfoDoLink, Erro> {
    // O `yt-dlp` roda como processo filho: fora da thread do runtime async.
    tauri::async_runtime::spawn_blocking({
        let url = url.clone();
        move || app.state::<Nucleo>().consultar_link(&url)
    })
    .await
    .map_err(|error| Erro::LinkNaoConsultado {
        url,
        detalhe: error.to_string(),
    })?
}

#[tauri::command]
#[specta::specta]
async fn dados_do_projeto(nucleo: State<'_, Nucleo>, id: String) -> Result<DadosDoProjeto, Erro> {
    nucleo.dados_do_projeto(&id)
}

#[tauri::command]
#[specta::specta]
async fn abrir_no_sistema(
    nucleo: State<'_, Nucleo>,
    id: String,
    alvo: AlvoParaAbrir,
) -> Result<(), Erro> {
    nucleo.abrir_no_sistema(&id, alvo)
}

#[tauri::command]
#[specta::specta]
async fn gerar_versao_final(nucleo: State<'_, Nucleo>, ids: Vec<String>) -> Result<(), Erro> {
    nucleo.gerar_versao_final(&ids)
}

/// A versão nova já baixada, para a interface que abriu depois do evento.
#[tauri::command]
#[specta::specta]
async fn atualizacao_pronta(app: AppHandle) -> Option<String> {
    app.state::<AtualizacaoBaixada>()
        .travar()
        .as_ref()
        .map(|(atualizacao, _)| atualizacao.version.clone())
}

/// "Reiniciar e atualizar": instala a versão baixada e abre o app de novo. No Windows, o
/// instalador fecha o app; no Linux, o lote para depois de o pacote ser trocado.
#[tauri::command]
#[specta::specta]
async fn instalar_atualizacao(app: AppHandle) -> Result<(), Erro> {
    let falhou = |detalhe: String| Erro::AppNaoAtualizado { detalhe };
    let (atualizacao, arquivo) = app
        .state::<AtualizacaoBaixada>()
        .travar()
        .take()
        .ok_or_else(|| falhou("nenhuma atualização baixada".to_owned()))?;
    let instalando = app.clone();
    // No .deb, o pkexec pede a senha e espera: fora da thread do runtime async.
    tauri::async_runtime::spawn_blocking(move || {
        let pacote = std::fs::read(&arquivo).map_err(|error| falhou(error.to_string()))?;
        atualizacao
            .install(pacote)
            .map_err(|error| falhou(error.to_string()))?;
        instalando.state::<Nucleo>().interromper();
        instalando.restart()
    })
    .await
    .map_err(|error| falhou(error.to_string()))?
}

/// O link do código-fonte no Sobre.
#[tauri::command]
#[specta::specta]
async fn abrir_codigo_fonte(nucleo: State<'_, Nucleo>) -> Result<(), Erro> {
    nucleo.abrir_codigo_fonte()
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
            verificar_preparacao,
            preparar,
            aceitar_aviso,
            verificar_conta,
            entrar_no_claude_code,
            instalar_claude_code,
            atualizar_claude_code,
            confirmar_plano,
            definir_multiplicador,
            definir_cotacao,
            definir_videos_ao_mesmo_tempo,
            testar_claude,
            escolher_arquivos,
            escolher_pasta,
            escolher_logo,
            definir_biblioteca,
            definir_idioma,
            kits,
            salvar_kit,
            apagar_kit,
            verificar_logo,
            fontes_embutidas,
            regras_aprendidas,
            editar_regra_aprendida,
            apagar_regra_aprendida,
            diagnosticar,
            inspecionar_arquivos,
            estimar_lote,
            consultar_link,
            criar_lote,
            adicionar_ao_lote,
            renomear_lote,
            definir_excecoes,
            lotes,
            pausar_projeto,
            cancelar_projeto,
            retomar_projeto,
            retomar_lote,
            tentar_de_novo,
            mover_na_fila,
            remover_projeto,
            excluir_projeto,
            tirar_do_historico,
            localizar_video,
            dados_do_projeto,
            abrir_no_sistema,
            gerar_versao_final,
            atualizacao_pronta,
            instalar_atualizacao,
            abrir_codigo_fonte,
            sair
        ])
        .events(collect_events![EventoDoNucleo, AtualizacaoPronta])
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // Sem permissão na capability: a interface só fala com o atualizador por estes comandos.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AtualizacaoBaixada::default())
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
                    pasta_de_videos: app.path().video_dir().ok(),
                    ligar_arquivo: None,
                    assets_dir: app.path().resource_dir().ok().map(|dir| dir.join("assets")),
                    npm: None,
                    node: None,
                    sidecar_dir: pasta_dos_sidecars(app),
                    chave_de_api_no_ambiente: std::env::var_os("ANTHROPIC_API_KEY")
                        .is_some_and(|chave| !chave.is_empty()),
                    abrir_com: None,
                    downloads: None,
                    carregadores_do_vulkan: None,
                    // Anexada a cada Release e trocável sem versão nova (precos.yml).
                    precos_url: Some(format!(
                        "{}/releases/latest/download/precos.json",
                        nucleo::REPOSITORIO
                    )),
                },
                move |evento| {
                    if let Evento::Notificacao {
                        motivo,
                        projeto,
                        lote,
                    } = &evento
                    {
                        let (titulo, corpo) = texto_da_notificacao(
                            *motivo,
                            projeto,
                            lote,
                            sys_locale::get_locale().as_deref(),
                        );
                        if let Err(error) = handle
                            .notification()
                            .builder()
                            .title(titulo)
                            .body(corpo)
                            .show()
                        {
                            eprintln!("notificação do sistema não mostrada: {error}");
                        }
                    }
                    if let Err(error) = EventoDoNucleo(evento).emit(&handle) {
                        eprintln!("evento do núcleo não repassado à interface: {error}");
                    }
                },
            );
            // Os reels tocam pelo protocolo de arquivos, só com a Biblioteca no escopo.
            let biblioteca = PathBuf::from(nucleo.estado_inicial().biblioteca);
            std::fs::create_dir_all(&biblioteca)?;
            app.asset_protocol_scope()
                .allow_directory(&biblioteca, true)?;
            app.manage(nucleo);
            // A tabela de preços nova vale da próxima sessão em diante; sem rede, fica a de antes.
            let precos = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = precos.state::<Nucleo>().atualizar_precos() {
                    eprintln!("{error}");
                }
            });
            // No desenvolvimento, a versão é a do Cargo.toml, e não a de uma Release.
            if !cfg!(debug_assertions) {
                let atualizar = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = baixar_atualizacao(atualizar).await {
                        eprintln!("atualização do app não baixada: {error}");
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("o Tauri não conseguiu abrir o app");
}

#[cfg(test)]
mod tests {
    use nucleo::MotivoDeNotificacao;
    use specta_typescript::Typescript;

    use super::texto_da_notificacao;

    #[test]
    fn a_notificacao_segue_o_idioma_do_sistema_e_nomeia_o_projeto_ou_o_lote() {
        let texto =
            |motivo, locale| texto_da_notificacao(motivo, "Aula 1", "Lote de 12/10", locale);
        assert_eq!(
            texto(MotivoDeNotificacao::ProjetoFalhou, Some("pt-BR")),
            ("Projeto falhou".to_owned(), "Aula 1".to_owned())
        );
        assert_eq!(
            texto(MotivoDeNotificacao::AguardandoCota, Some("en-US")),
            ("Waiting for quota".to_owned(), "Aula 1".to_owned())
        );
        assert_eq!(
            texto(MotivoDeNotificacao::LoteTerminado, None),
            ("Batch finished".to_owned(), "Lote de 12/10".to_owned())
        );
        assert_eq!(
            texto(MotivoDeNotificacao::ProjetoPronto, Some("pt-PT")).0,
            "Projeto pronto"
        );
    }

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
