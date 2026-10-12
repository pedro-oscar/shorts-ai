//! O lote pela interface pública do núcleo: o registro em `.lotes/`, vídeos adicionados com o
//! lote rodando, o histórico e a fila serial com falha isolada.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use nucleo::{
    ArquivoDoLote, Config, Erro, EstadoDaEtapa, Etapa, Evento, LigarArquivo, ModeloDoClaude,
    Nucleo, Padroes, ProjetoResumo,
};

struct Cenario {
    // Fica vivo até o fim do teste.
    _tmp: tempfile::TempDir,
    entrada: PathBuf,
    nucleo: Nucleo,
    eventos: Receiver<Evento>,
}

impl Cenario {
    fn novo() -> Self {
        Self::com(None)
    }

    fn com(ligar: Option<LigarArquivo>) -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let entrada = tmp.path().join("entrada");
        fs::create_dir_all(&entrada).unwrap();
        let (envio, eventos) = mpsc::channel();
        let envio = Mutex::new(envio);
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: tmp.path().join("dados"),
                pasta_de_videos: Some(tmp.path().join("Videos")),
                ligar_arquivo: ligar,
                ..Config::default()
            },
            move |evento| {
                let _ = envio.lock().unwrap().send(evento);
            },
        );
        Self {
            _tmp: tmp,
            entrada,
            nucleo,
            eventos,
        }
    }

    fn video(&self, nome: &str) -> String {
        let path = self.entrada.join(nome);
        fs::write(&path, b"video de mentira").unwrap();
        path.display().to_string()
    }

    fn arquivo(&self, nome: &str) -> ArquivoDoLote {
        ArquivoDoLote {
            caminho: self.video(nome),
            faixa: None,
        }
    }

    /// Espera as transições de estado da Importação de `quantos` projetos, na ordem em que
    /// chegam: cada uma é `(projeto, estado)` de um estado final.
    fn importacoes_terminadas(&self, quantos: usize) -> Vec<(String, EstadoDaEtapa)> {
        let mut terminadas = Vec::new();
        while terminadas.len() < quantos {
            if let Evento::EtapaMudou {
                projeto,
                etapa: Etapa::Importacao,
                estado: estado @ (EstadoDaEtapa::Concluida | EstadoDaEtapa::Falhou),
                ..
            } = self
                .eventos
                .recv_timeout(Duration::from_secs(10))
                .expect("a Importação não terminou")
            {
                terminadas.push((projeto, estado));
            }
        }
        terminadas
    }

    fn ids(projetos: &[ProjetoResumo]) -> Vec<String> {
        projetos.iter().map(|p| p.id.clone()).collect()
    }
}

#[test]
fn o_lote_e_gravado_com_nome_automatico_padroes_e_ordem() {
    let cenario = Cenario::novo();
    let padroes = Padroes {
        quantidade_de_reels: 3,
        modelo: ModeloDoClaude::Sonnet,
        pedido: "cortes sobre dinheiro".to_owned(),
        ..Padroes::default()
    };

    let projetos = cenario
        .nucleo
        .criar_lote(
            &[cenario.video("um.mp4"), cenario.video("dois.mp4")],
            &padroes,
        )
        .unwrap();

    let lotes = cenario.nucleo.lotes();
    assert_eq!(lotes.len(), 1);
    let lote = &lotes[0];
    assert_eq!(Cenario::ids(&lote.projetos), Cenario::ids(&projetos));
    assert!(lote.aberto);
    // "Lote de dd/mm hh:mm"
    let nome = lote.nome.strip_prefix("Lote de ").expect(&lote.nome);
    let bytes = nome.as_bytes();
    assert_eq!(bytes.len(), 11, "{nome}");
    assert_eq!((bytes[2], bytes[5], bytes[8]), (b'/', b' ', b':'), "{nome}");
    assert!(projetos.iter().all(|p| p.lote == lote.id));
    assert_eq!(lote.padroes, padroes);
}

#[test]
fn adicionar_com_o_lote_rodando_poe_no_fim_da_fila_com_os_padroes_do_lote() {
    let cenario = Cenario::novo();
    let padroes = Padroes {
        quantidade_de_reels: 4,
        revisoes: 2,
        ..Padroes::default()
    };
    let primeiros = cenario
        .nucleo
        .criar_lote(
            &[cenario.video("um.mp4"), cenario.video("dois.mp4")],
            &padroes,
        )
        .unwrap();
    let lote = cenario.nucleo.lotes().remove(0);

    let novos = cenario
        .nucleo
        .adicionar_ao_lote(&lote.id, &[cenario.arquivo("tres.mp4")], &[])
        .unwrap();

    assert_eq!(novos.len(), 1);
    assert_eq!(novos[0].lote, lote.id);
    let todos = cenario.nucleo.lotes().remove(0);
    let mut esperados = Cenario::ids(&primeiros);
    esperados.push(novos[0].id.clone());
    assert_eq!(Cenario::ids(&todos.projetos), esperados);
    let ordem: Vec<_> = cenario
        .importacoes_terminadas(3)
        .into_iter()
        .map(|(projeto, _)| projeto)
        .collect();
    assert_eq!(ordem, esperados);
    // Os padrões do lote valem para o projeto adicionado.
    let json: serde_json::Value = serde_json::from_slice(
        &fs::read(
            cenario
                .nucleo
                .estado_inicial()
                .biblioteca
                .parse::<PathBuf>()
                .unwrap()
                .join(&novos[0].id)
                .join("projeto.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(json["opcoes"]["quantidadeDeReels"], 4);
    assert_eq!(json["opcoes"]["revisoes"], 2);
}

#[test]
fn adicionar_o_mesmo_video_de_novo_cria_outro_projeto() {
    let cenario = Cenario::novo();
    let caminho = cenario.video("aula.mp4");
    let arquivo = ArquivoDoLote {
        caminho,
        faixa: None,
    };
    let primeiros = cenario
        .nucleo
        .criar_lote(std::slice::from_ref(&arquivo.caminho), &Padroes::default())
        .unwrap();
    let lote = cenario.nucleo.lotes().remove(0);

    let novos = cenario
        .nucleo
        .adicionar_ao_lote(&lote.id, &[arquivo], &[])
        .unwrap();

    assert_ne!(novos[0].id, primeiros[0].id);
    assert_eq!(cenario.nucleo.lotes()[0].projetos.len(), 2);
}

#[test]
fn adicionar_a_um_lote_que_nao_existe_falha() {
    let cenario = Cenario::novo();

    let erro = cenario
        .nucleo
        .adicionar_ao_lote("2026-01-01T00-00-00", &[cenario.arquivo("a.mp4")], &[])
        .unwrap_err();

    assert_eq!(
        erro,
        Erro::LoteNaoEncontrado {
            id: "2026-01-01T00-00-00".to_owned()
        }
    );
}

#[test]
fn o_nome_do_lote_pode_ser_editado() {
    let cenario = Cenario::novo();
    cenario
        .nucleo
        .criar_lote(&[cenario.video("aula.mp4")], &Padroes::default())
        .unwrap();
    let id = cenario.nucleo.lotes().remove(0).id;

    cenario
        .nucleo
        .renomear_lote(&id, "  Pregações de outubro ")
        .unwrap();

    assert_eq!(cenario.nucleo.lotes()[0].nome, "Pregações de outubro");
    assert!(matches!(
        cenario.nucleo.renomear_lote(&id, "   ").unwrap_err(),
        Erro::PadroesInvalidos { .. }
    ));
    assert_eq!(
        cenario.nucleo.renomear_lote("nao-existe", "x").unwrap_err(),
        Erro::LoteNaoEncontrado {
            id: "nao-existe".to_owned()
        }
    );
}

#[test]
fn o_historico_lista_o_mais_novo_primeiro_e_so_ele_pode_estar_aberto() {
    let cenario = Cenario::novo();
    cenario
        .nucleo
        .criar_lote(&[cenario.video("velho.mp4")], &Padroes::default())
        .unwrap();
    // Os ids dos lotes vão até o segundo; dois lotes no mesmo segundo ganham `-2`.
    cenario
        .nucleo
        .criar_lote(&[cenario.video("novo.mp4")], &Padroes::default())
        .unwrap();

    let lotes = cenario.nucleo.lotes();

    assert_eq!(lotes.len(), 2);
    assert_eq!(lotes[0].projetos[0].titulo, "novo");
    assert_eq!(lotes[1].projetos[0].titulo, "velho");
    assert!(lotes[0].aberto);
    assert!(!lotes[1].aberto);
}

#[test]
fn um_projeto_que_falha_nao_para_os_outros() {
    // A Importação do primeiro espera, para o segundo arquivo sumir antes da vez dele.
    let (libera, espera) = mpsc::channel::<()>();
    let espera = Mutex::new(espera);
    let primeira = AtomicBool::new(true);
    let cenario = Cenario::com(Some(Arc::new(move |origem, destino| {
        if primeira.swap(false, Ordering::SeqCst) {
            let _ = espera.lock().unwrap().recv_timeout(Duration::from_secs(10));
        }
        fs::hard_link(origem, destino)
    })));
    let caminhos = [
        cenario.video("um.mp4"),
        cenario.video("dois.mp4"),
        cenario.video("tres.mp4"),
    ];
    let projetos = cenario
        .nucleo
        .criar_lote(&caminhos, &Padroes::default())
        .unwrap();
    fs::remove_file(&caminhos[1]).unwrap();
    libera.send(()).unwrap();

    let terminadas = cenario.importacoes_terminadas(3);

    assert_eq!(
        terminadas,
        [
            (projetos[0].id.clone(), EstadoDaEtapa::Concluida),
            (projetos[1].id.clone(), EstadoDaEtapa::Falhou),
            (projetos[2].id.clone(), EstadoDaEtapa::Concluida),
        ]
    );
}
