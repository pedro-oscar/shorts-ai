//! O ciclo de vida do projeto pela interface pública do núcleo: pausar, cancelar, retomar,
//! tentar de novo e reabrir o app com projetos interrompidos.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use nucleo::{
    ArquivoDoLote, Config, Erro, EstadoDaEtapa, Etapa, Evento, LigarArquivo, Nucleo, Padroes,
    Parada, ProjetoResumo,
};

struct Cenario {
    // Fica vivo até o fim do teste.
    _tmp: tempfile::TempDir,
    entrada: PathBuf,
    nucleo: Nucleo,
    eventos: Receiver<Evento>,
    /// A Importação do primeiro projeto avisa aqui que entrou e espera `liberar`.
    entrou: Receiver<()>,
    liberar: Sender<()>,
}

impl Cenario {
    /// A primeira Importação fica presa até `liberar`; as seguintes passam direto.
    fn novo() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let entrada = tmp.path().join("entrada");
        fs::create_dir_all(&entrada).unwrap();
        let (envia_entrou, entrou) = mpsc::channel();
        let (liberar, recebe_liberar) = mpsc::channel::<()>();
        let recebe_liberar = Mutex::new(recebe_liberar);
        let envia_entrou = Mutex::new(envia_entrou);
        let primeira = AtomicBool::new(true);
        let ligar: LigarArquivo = Arc::new(move |_, _| {
            if primeira.swap(false, Ordering::SeqCst) {
                let _ = envia_entrou.lock().unwrap().send(());
                let _ = recebe_liberar
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(10));
            }
            Ok(())
        });
        let (nucleo, eventos) = Self::abrir(tmp.path(), Some(ligar));
        Self {
            _tmp: tmp,
            entrada,
            nucleo,
            eventos,
            entrou,
            liberar,
        }
    }

    fn abrir(raiz: &std::path::Path, ligar: Option<LigarArquivo>) -> (Nucleo, Receiver<Evento>) {
        let (envio, eventos) = mpsc::channel();
        let envio = Mutex::new(envio);
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: raiz.join("dados"),
                pasta_de_videos: Some(raiz.join("Videos")),
                ligar_arquivo: ligar,
                ..Config::default()
            },
            move |evento| {
                let _ = envio.lock().unwrap().send(evento);
            },
        );
        (nucleo, eventos)
    }

    fn arquivo(&self, nome: &str) -> ArquivoDoLote {
        let caminho = self.entrada.join(nome);
        fs::write(&caminho, b"video de mentira").unwrap();
        ArquivoDoLote {
            caminho: caminho.display().to_string(),
            faixa: None,
        }
    }

    fn lote(&self, nomes: &[&str]) -> Vec<ProjetoResumo> {
        let arquivos: Vec<_> = nomes.iter().map(|nome| self.arquivo(nome)).collect();
        self.nucleo
            .criar_lote_com_links(&arquivos, &[], &Padroes::default())
            .unwrap()
    }

    /// O primeiro projeto está dentro da Importação, travado.
    fn esperar_importacao_do_primeiro(&self) {
        self.entrou
            .recv_timeout(Duration::from_secs(10))
            .expect("a Importação não começou");
    }

    fn esperar<T>(&self, mut filtro: impl FnMut(Evento) -> Option<T>) -> T {
        loop {
            let evento = self
                .eventos
                .recv_timeout(Duration::from_secs(10))
                .expect("o evento esperado não veio");
            if let Some(achado) = filtro(evento) {
                return achado;
            }
        }
    }

    fn esperar_parada(&self, id: &str, esperada: Option<Parada>) {
        self.esperar(|evento| match evento {
            Evento::ParadaMudou { projeto, parada } if projeto == id && parada == esperada => {
                Some(())
            }
            _ => None,
        });
    }

    fn esperar_importacao(&self, id: &str, esperado: EstadoDaEtapa) {
        self.esperar(|evento| match evento {
            Evento::EtapaMudou {
                projeto,
                etapa: Etapa::Importacao,
                estado,
                ..
            } if projeto == id && estado == esperado => Some(()),
            _ => None,
        });
    }

    fn projeto(&self, id: &str) -> ProjetoResumo {
        self.nucleo
            .lotes()
            .into_iter()
            .flat_map(|lote| lote.projetos)
            .find(|projeto| projeto.id == id)
            .unwrap()
    }
}

fn estado_da(projeto: &ProjetoResumo, etapa: Etapa) -> EstadoDaEtapa {
    projeto
        .etapas
        .iter()
        .find(|item| item.etapa == etapa)
        .unwrap()
        .estado
}

#[test]
fn pausar_o_que_roda_para_ao_fim_da_etapa() {
    let cenario = Cenario::novo();
    let projetos = cenario.lote(&["um.mp4"]);
    let id = &projetos[0].id;
    cenario.esperar_importacao_do_primeiro();

    cenario.nucleo.pausar(id).unwrap();
    assert_eq!(cenario.projeto(id).parada, None, "ainda termina a etapa");
    cenario.liberar.send(()).unwrap();

    cenario.esperar_parada(id, Some(Parada::Pausado));
    let projeto = cenario.projeto(id);
    assert_eq!(
        estado_da(&projeto, Etapa::Importacao),
        EstadoDaEtapa::Concluida
    );
    assert_eq!(projeto.parada, Some(Parada::Pausado));
}

#[test]
fn pausar_o_que_espera_a_vez_tira_da_fila_e_libera_a_vaga() {
    let cenario = Cenario::novo();
    let projetos = cenario.lote(&["um.mp4", "dois.mp4", "tres.mp4"]);
    cenario.esperar_importacao_do_primeiro();

    cenario.nucleo.pausar(&projetos[1].id).unwrap();
    cenario.esperar_parada(&projetos[1].id, Some(Parada::Pausado));
    cenario.liberar.send(()).unwrap();

    // O terceiro roda sem que o segundo tenha rodado.
    cenario.esperar_importacao(&projetos[2].id, EstadoDaEtapa::Concluida);
    let segundo = cenario.projeto(&projetos[1].id);
    assert_eq!(
        estado_da(&segundo, Etapa::Importacao),
        EstadoDaEtapa::Pendente
    );
    assert_eq!(segundo.parada, Some(Parada::Pausado));
}

#[test]
fn cancelar_o_que_roda_descarta_a_etapa_em_curso() {
    let cenario = Cenario::novo();
    let projetos = cenario.lote(&["um.mp4"]);
    let id = &projetos[0].id;
    cenario.esperar_importacao_do_primeiro();

    cenario.nucleo.cancelar(id).unwrap();
    cenario.liberar.send(()).unwrap();

    cenario.esperar_parada(id, Some(Parada::Cancelado));
    let projeto = cenario.projeto(id);
    assert_eq!(
        estado_da(&projeto, Etapa::Importacao),
        EstadoDaEtapa::Pendente
    );
    assert_eq!(projeto.parada, Some(Parada::Cancelado));
}

#[test]
fn cancelar_o_pausado_vale_e_o_cancelado_pode_ser_retomado() {
    let cenario = Cenario::novo();
    let projetos = cenario.lote(&["um.mp4", "dois.mp4"]);
    let id = &projetos[1].id;
    cenario.esperar_importacao_do_primeiro();
    cenario.nucleo.pausar(id).unwrap();
    cenario.nucleo.cancelar(id).unwrap();
    assert_eq!(cenario.projeto(id).parada, Some(Parada::Cancelado));
    cenario.liberar.send(()).unwrap();

    cenario.nucleo.retomar(id).unwrap();

    cenario.esperar_importacao(id, EstadoDaEtapa::Concluida);
    let projeto = cenario.projeto(id);
    assert_eq!(projeto.parada, None);
}

#[test]
fn retomar_poe_o_projeto_no_fim_da_fila() {
    let cenario = Cenario::novo();
    let projetos = cenario.lote(&["um.mp4", "dois.mp4", "tres.mp4"]);
    cenario.esperar_importacao_do_primeiro();
    cenario.nucleo.pausar(&projetos[1].id).unwrap();
    cenario.nucleo.retomar(&projetos[1].id).unwrap();
    cenario.liberar.send(()).unwrap();

    let mut ordem = Vec::new();
    while ordem.len() < 3 {
        ordem.push(cenario.esperar(|evento| match evento {
            Evento::EtapaMudou {
                projeto,
                etapa: Etapa::Importacao,
                estado: EstadoDaEtapa::Concluida,
                ..
            } => Some(projeto),
            _ => None,
        }));
    }
    assert_eq!(
        ordem,
        [&projetos[0].id, &projetos[2].id, &projetos[1].id]
            .map(Clone::clone)
            .to_vec()
    );
}

#[test]
fn tentar_de_novo_recomeca_da_etapa_que_falhou() {
    let cenario = Cenario::novo();
    let projetos = cenario.lote(&["um.mp4", "dois.mp4"]);
    let id = &projetos[1].id;
    cenario.esperar_importacao_do_primeiro();
    let original = cenario.entrada.join("dois.mp4");
    fs::remove_file(&original).unwrap();
    cenario.liberar.send(()).unwrap();
    cenario.esperar_importacao(id, EstadoDaEtapa::Falhou);
    let falhou = cenario.projeto(id);
    assert!(falhou.falha.is_some());

    fs::write(&original, b"de volta").unwrap();
    cenario.nucleo.tentar_de_novo(id).unwrap();

    cenario.esperar_importacao(id, EstadoDaEtapa::Concluida);
    let projeto = cenario.projeto(id);
    assert_eq!(projeto.falha, None);
}

#[test]
fn acoes_fora_da_tabela_de_estados_sao_recusadas() {
    let cenario = Cenario::novo();
    let projetos = cenario.lote(&["um.mp4"]);
    let id = &projetos[0].id;
    cenario.esperar_importacao_do_primeiro();

    // Rodando: não retoma nem tenta de novo.
    assert!(matches!(
        cenario.nucleo.retomar(id),
        Err(Erro::AcaoIndisponivel { .. })
    ));
    assert!(matches!(
        cenario.nucleo.tentar_de_novo(id),
        Err(Erro::AcaoIndisponivel { .. })
    ));
    cenario.nucleo.cancelar(id).unwrap();
    cenario.liberar.send(()).unwrap();
    cenario.esperar_parada(id, Some(Parada::Cancelado));

    // Cancelado: não pausa nem cancela de novo.
    assert!(matches!(
        cenario.nucleo.pausar(id),
        Err(Erro::AcaoIndisponivel { .. })
    ));
    assert!(matches!(
        cenario.nucleo.cancelar(id),
        Err(Erro::AcaoIndisponivel { .. })
    ));
}

#[test]
fn reabrir_o_app_deixa_pausado_o_projeto_interrompido_e_nada_retoma_sozinho() {
    let cenario = Cenario::novo();
    let projetos = cenario.lote(&["um.mp4"]);
    let projeto = &projetos[0];
    cenario.esperar_importacao_do_primeiro();
    cenario.liberar.send(()).unwrap();
    cenario.esperar_importacao(&projeto.id, EstadoDaEtapa::Concluida);
    // O app foi fechado com a Transcrição em andamento.
    let arquivo = PathBuf::from(&projeto.pasta).join("projeto.json");
    let mut json: serde_json::Value = serde_json::from_slice(&fs::read(&arquivo).unwrap()).unwrap();
    json["etapas"][1]["estado"] = "emAndamento".into();
    fs::write(&arquivo, serde_json::to_vec(&json).unwrap()).unwrap();

    let (reaberto, eventos) = Cenario::abrir(cenario._tmp.path(), None);

    let lotes = reaberto.lotes();
    let reaberto_projeto = &lotes[0].projetos[0];
    assert_eq!(reaberto_projeto.parada, Some(Parada::Pausado));
    assert_eq!(
        estado_da(reaberto_projeto, Etapa::Transcricao),
        EstadoDaEtapa::Pendente
    );
    assert_eq!(
        estado_da(reaberto_projeto, Etapa::Importacao),
        EstadoDaEtapa::Concluida
    );
    assert!(lotes[0].aberto);
    assert!(
        eventos.recv_timeout(Duration::from_millis(300)).is_err(),
        "nada roda sozinho"
    );

    reaberto.retomar_lote(&lotes[0].id).unwrap();
    assert_eq!(reaberto.lotes()[0].projetos[0].parada, None);
}

#[test]
fn reabrir_nao_mexe_em_projeto_pronto_nem_que_falhou() {
    let cenario = Cenario::novo();
    let projetos = cenario.lote(&["um.mp4", "dois.mp4"]);
    cenario.esperar_importacao_do_primeiro();
    fs::remove_file(cenario.entrada.join("dois.mp4")).unwrap();
    cenario.liberar.send(()).unwrap();
    cenario.esperar_importacao(&projetos[1].id, EstadoDaEtapa::Falhou);

    let (reaberto, _eventos) = Cenario::abrir(cenario._tmp.path(), None);

    let falho = &reaberto.lotes()[0].projetos[1];
    assert_eq!(falho.parada, None);
    assert!(falho.falha.is_some());
}
