//! A sessão do Claude do Roteiro pela interface pública do núcleo, com um `claude` falso (um
//! script de shell) que repete uma sessão gravada, recortada: os eventos, o roteiro, o log e o
//! `custos.json`. Variações: vários `result`, sessão que cai e roteiro inválido.
#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use nucleo::sessao::{ErroDoRoteiro, EventoDaSessao, Pedido, Roteirista, Skill, preparar_skill};
use serde_json::{Value, json};

/// O `claude` falso guarda como foi chamado, devolve a sessão gravada e, conforme as marcas
/// na pasta dele, escreve um roteiro bom, um roteiro ruim ou cai no meio.
const CLAUDE: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
echo "$@" > "$dir/args.log"
pwd > "$dir/cwd.log"
echo "$CLAUDE_CONFIG_DIR" > "$dir/config.log"
echo "$PATH" > "$dir/path.log"
cat > "$dir/prompt.log"
[ -f "$dir/roteiro-valido" ] && cp "$dir/roteiro.json" edit/roteiro.json
[ -f "$dir/roteiro-invalido" ] && echo '{"cortes":[{"id":"c01","trechos":[]}]}' > edit/roteiro.json
cat "$dir/stream.jsonl"
[ -f "$dir/cai" ] && { echo "Claude derrubou a sessão" >&2; exit 3; }
exit 0
"#;

fn raiz() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

struct Cenario {
    tmp: tempfile::TempDir,
    roteirista: Roteirista,
    pasta: PathBuf,
    aprendizados: PathBuf,
}

impl Cenario {
    fn novo() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("bin");
        fs::create_dir(&bin).unwrap();
        let claude = bin.join("claude");
        fs::write(&claude, CLAUDE).unwrap();
        fs::set_permissions(&claude, fs::Permissions::from_mode(0o755)).unwrap();
        fs::copy(
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/dados/sessao-roteiro.jsonl"
            ),
            bin.join("stream.jsonl"),
        )
        .unwrap();
        let referencia = raiz().join(".scratch/shorts-ai-mvp/referencia-kgfmahnbqx4");
        fs::copy(referencia.join("roteiro.json"), bin.join("roteiro.json")).unwrap();
        fs::write(bin.join("roteiro-valido"), "").unwrap();

        let dados = tmp.path().join("dados");
        let Skill {
            skill,
            aprendizados,
        } = preparar_skill(&raiz().join("assets"), &dados).unwrap();
        let roteirista = Roteirista::new(
            claude,
            dados.join("claude"),
            Skill {
                skill,
                aprendizados: aprendizados.clone(),
            },
            Some(tmp.path().join("cli")),
        );

        let pasta = tmp.path().join("projeto");
        fs::create_dir_all(pasta.join("edit")).unwrap();
        fs::create_dir_all(pasta.join("remotion/src/scenes")).unwrap();
        fs::copy(
            referencia.join("transcricao.json"),
            pasta.join("edit/transcricao.json"),
        )
        .unwrap();
        fs::write(
            pasta.join("remotion/src/scenes/index.ts"),
            "export const SCENES = { PortaGritos, MaoNaCabeca, DiaboNaTerra, Censo, Marionete, Avestruz, Comparacao };\n",
        )
        .unwrap();
        Self {
            tmp,
            roteirista,
            pasta,
            aprendizados,
        }
    }

    fn bin(&self) -> PathBuf {
        self.tmp.path().join("bin")
    }

    fn marcar(&self, nome: &str) {
        fs::write(self.bin().join(nome), "").unwrap();
    }

    fn desmarcar(&self, nome: &str) {
        let _ = fs::remove_file(self.bin().join(nome));
    }

    fn lido(&self, nome: &str) -> String {
        fs::read_to_string(self.bin().join(nome)).unwrap()
    }

    fn rodar(&self, modelo: Option<&str>) -> (Result<(), ErroDoRoteiro>, Vec<EventoDaSessao>) {
        let mut eventos = Vec::new();
        let resultado = self.roteirista.roteirizar(
            &Pedido {
                pasta: &self.pasta,
                video: "aula.mp4",
                idioma: "pt",
                cortes: 6,
                pedido: "",
                modelo,
            },
            &AtomicBool::new(false),
            &mut |evento| eventos.push(evento),
        );
        (resultado, eventos)
    }

    /// As linhas do `custos.json`, uma por sessão.
    fn custos(&self) -> Vec<Value> {
        serde_json::from_str(&fs::read_to_string(self.pasta.join("edit/custos.json")).unwrap())
            .unwrap()
    }

    /// A linha da última sessão no `custos.json`.
    fn ultimo_custo(&self) -> Value {
        self.custos().pop().unwrap()
    }

    fn acrescentar_ao_stream(&self, linha: &str) {
        let caminho = self.bin().join("stream.jsonl");
        let mut texto = fs::read_to_string(&caminho).unwrap();
        texto.push_str(linha);
        texto.push('\n');
        fs::write(caminho, texto).unwrap();
    }
}

fn acao(ferramenta: &str, alvo: &str) -> EventoDaSessao {
    EventoDaSessao::Acao {
        ferramenta: ferramenta.to_owned(),
        alvo: Some(alvo.to_owned()),
    }
}

#[test]
fn cada_linha_do_stream_vira_um_evento_com_os_tokens_somados_por_mensagem() {
    let cenario = Cenario::novo();

    let (resultado, eventos) = cenario.rodar(None);

    resultado.unwrap();
    assert_eq!(
        eventos,
        [
            acao("texto", "Vou ler a skill e a transcrição."),
            EventoDaSessao::Tokens {
                entrada: 6,
                cache: 12_000
            },
            acao("Read", "/dados/skill/corte-viral/SKILL.md"),
            // A mesma mensagem repete o `usage`: a soma não dobra.
            EventoDaSessao::Tokens {
                entrada: 6,
                cache: 12_000
            },
            acao("Bash", "head -n 20 edit/transcricao-compactada.txt"),
            EventoDaSessao::Tokens {
                entrada: 9,
                cache: 24_800
            },
            acao("Write", "/projeto/edit/roteiro.json"),
            EventoDaSessao::Tokens {
                entrada: 11,
                cache: 37_900
            },
        ]
    );
}

#[test]
fn o_log_da_sessao_guarda_as_linhas_do_stream_no_projeto() {
    let cenario = Cenario::novo();

    cenario.rodar(None).0.unwrap();

    assert_eq!(
        fs::read_to_string(cenario.pasta.join("edit/sessao-roteiro.jsonl")).unwrap(),
        cenario.lido("stream.jsonl")
    );
}

#[test]
fn a_nova_tentativa_acrescenta_ao_log_sem_apagar_a_sessao_anterior() {
    let cenario = Cenario::novo();

    cenario.rodar(None).0.unwrap();
    cenario.rodar(None).0.unwrap();

    let stream = cenario.lido("stream.jsonl");
    assert_eq!(
        fs::read_to_string(cenario.pasta.join("edit/sessao-roteiro.jsonl")).unwrap(),
        format!("{stream}{stream}")
    );
}

#[test]
fn o_custo_vem_do_ultimo_result_sem_somar() {
    let cenario = Cenario::novo();

    cenario.rodar(None).0.unwrap();

    let custos = cenario.custos();
    assert_eq!(custos.len(), 1);
    let roteiro = &custos[0];
    assert_eq!(roteiro["etapa"], "roteiro");
    assert_eq!(roteiro["sessionId"], "s1");
    assert!(
        time::OffsetDateTime::parse(
            roteiro["inicio"].as_str().unwrap(),
            &time::format_description::well_known::Rfc3339
        )
        .is_ok(),
        "{roteiro}"
    );
    assert_eq!(roteiro["custoUsd"], 0.42);
    assert_eq!(roteiro["turnos"], 6);
    assert_eq!(roteiro["duracaoMs"], 52_000);
    assert_eq!(roteiro["parcial"], false);
    assert_eq!(roteiro["modelos"].as_object().unwrap().len(), 2);
    assert_eq!(
        roteiro["modelos"]["claude-opus-5-5"],
        json!({
            "entrada": 11,
            "saida": 1100,
            "cacheLeitura": 24_800,
            "cacheCriacao": 13_100,
            "custoUsd": 0.35
        })
    );
}

#[test]
fn result_final_com_erro_e_custo_zerado_usa_o_anterior_e_marca_parcial() {
    let cenario = Cenario::novo();
    cenario.acrescentar_ao_stream(
        r#"{"type":"result","subtype":"error_during_execution","is_error":true,"duration_ms":10,"num_turns":0,"total_cost_usd":0,"modelUsage":{}}"#,
    );

    cenario.rodar(None).0.unwrap();

    let roteiro = cenario.ultimo_custo();
    assert_eq!(roteiro["custoUsd"], 0.42);
    assert_eq!(roteiro["turnos"], 6);
    assert_eq!(roteiro["parcial"], true);
}

#[test]
fn result_final_com_erro_e_custo_proprio_vale_e_sai_parcial() {
    let cenario = Cenario::novo();
    cenario.acrescentar_ao_stream(
        r#"{"type":"result","subtype":"error_during_execution","is_error":true,"duration_ms":70000,"num_turns":9,"total_cost_usd":0.6,"modelUsage":{"claude-opus-5-5":{"inputTokens":1,"outputTokens":2,"cacheReadInputTokens":3,"cacheCreationInputTokens":4,"costUSD":0.6}}}"#,
    );

    cenario.rodar(None).0.unwrap();

    let roteiro = cenario.ultimo_custo();
    assert_eq!(roteiro["custoUsd"], 0.6);
    assert_eq!(roteiro["parcial"], true);
}

#[test]
fn cada_sessao_acrescenta_uma_linha_ao_custos_json_sem_apagar_as_anteriores() {
    let cenario = Cenario::novo();
    fs::write(
        cenario.pasta.join("edit/custos.json"),
        r#"[{"etapa": "revisao", "custoUsd": 1.5}]"#,
    )
    .unwrap();

    // Uma tentativa que cai e a nova tentativa que passa: as duas custaram.
    cenario.marcar("cai");
    cenario.rodar(None).0.unwrap_err();
    cenario.desmarcar("cai");
    cenario.rodar(None).0.unwrap();

    let custos = cenario.custos();
    assert_eq!(custos.len(), 3);
    assert_eq!(custos[0], json!({"etapa": "revisao", "custoUsd": 1.5}));
    for custo in &custos[1..] {
        assert_eq!(custo["etapa"], "roteiro");
        assert_eq!(custo["custoUsd"], 0.42);
    }
}

#[test]
fn a_sessao_roda_na_pasta_do_projeto_com_as_flags_e_as_ferramentas_da_spec() {
    let cenario = Cenario::novo();

    cenario.rodar(Some("claude-sonnet-5-5")).0.unwrap();

    let args = cenario.lido("args.log");
    for trecho in [
        "-p --output-format stream-json --verbose --strict-mcp-config",
        "--permission-mode acceptEdits",
        "--model claude-sonnet-5-5",
        "Read,Write,Edit,MultiEdit,Glob,Grep,Skill,Task,Agent,TodoWrite,",
        "Bash(shorts-cli validar:*),Bash(shorts-cli tsc:*),Bash(shorts-cli still:*),Bash(shorts-cli cena:*)",
        "Bash(grep:*),Bash(ls:*),Bash(head:*),Bash(tail:*),Bash(wc:*),Bash(sed -n:*),Bash(cat:*)",
        "--disallowedTools Bash(rm:*),WebFetch,WebSearch",
    ] {
        assert!(args.contains(trecho), "faltou {trecho}: {args}");
    }
    let dados = cenario.tmp.path().join("dados");
    assert!(args.contains(&format!(
        "--add-dir {0}/skill/corte-viral --add-dir {0}/aprendizados",
        dados.display()
    )));
    // A skill é somente leitura: a negação vence o `acceptEdits`, e os aprendizados seguem
    // graváveis.
    assert!(
        args.contains(&format!("Edit(/{}/skill/corte-viral/**)", dados.display())),
        "{args}"
    );
    assert!(!args.contains("aprendizados/**"), "{args}");
    assert_eq!(
        Path::new(cenario.lido("cwd.log").trim()),
        fs::canonicalize(&cenario.pasta).unwrap()
    );
    assert_eq!(
        Path::new(cenario.lido("config.log").trim()),
        dados.join("claude")
    );
    assert!(
        cenario
            .lido("path.log")
            .starts_with(&format!("{}:", cenario.tmp.path().join("cli").display()))
    );
}

#[test]
fn sem_modelo_escolhido_nao_passa_o_model() {
    let cenario = Cenario::novo();

    cenario.rodar(None).0.unwrap();

    assert!(!cenario.lido("args.log").contains("--model"));
}

#[test]
fn o_prompt_vai_pela_entrada_padrao_com_idioma_quantidade_e_pastas() {
    let cenario = Cenario::novo();

    cenario.rodar(None).0.unwrap();

    let prompt = cenario.lido("prompt.log");
    assert!(prompt.contains("O **idioma do vídeo** é `pt`"), "{prompt}");
    assert!(prompt.contains("até **6** cortes"));
    assert!(prompt.contains("shorts-cli validar edit/roteiro.json"));
    assert!(prompt.contains("`descricao`"));
    assert!(prompt.contains("\"fonte\": \"aula.mp4\""));
    assert!(prompt.contains(&format!(
        "{}/aprendizados.md",
        cenario.aprendizados.display()
    )));
    assert!(!prompt.contains("./ae "), "{prompt}");
    assert!(!prompt.contains("{SKILL}") && !prompt.contains("{EXTRA}"));
    assert!(!prompt.contains("Erros da tentativa anterior"));
    assert!(!prompt.contains("Pedido do usuário"));
}

#[test]
fn o_pedido_do_lote_entra_no_prompt() {
    let cenario = Cenario::novo();

    cenario
        .roteirista
        .roteirizar(
            &Pedido {
                pasta: &cenario.pasta,
                video: "aula.mp4",
                idioma: "pt",
                cortes: 3,
                pedido: "Prefiro cortes sobre dinheiro",
                modelo: None,
            },
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap();

    assert!(
        cenario
            .lido("prompt.log")
            .contains("Pedido do usuário para este lote\n\nPrefiro cortes sobre dinheiro")
    );
}

#[test]
fn sessao_que_cai_falha_com_o_stderr_e_ainda_registra_o_custo() {
    let cenario = Cenario::novo();
    cenario.marcar("cai");

    let (resultado, _) = cenario.rodar(None);

    let erro = resultado.unwrap_err();
    assert!(
        matches!(&erro, ErroDoRoteiro::SessaoCaiu(detalhe) if detalhe.contains("Claude derrubou a sessão")),
        "{erro:?}"
    );
    assert_eq!(cenario.ultimo_custo()["custoUsd"], 0.42);
}

#[test]
fn sessao_sem_nenhum_result_falha() {
    let cenario = Cenario::novo();
    fs::write(
        cenario.bin().join("stream.jsonl"),
        "{\"type\":\"system\"}\n",
    )
    .unwrap();

    let (resultado, _) = cenario.rodar(None);

    assert!(matches!(resultado, Err(ErroDoRoteiro::SessaoCaiu(_))));
    assert!(!cenario.pasta.join("edit/custos.json").exists());
}

#[test]
fn sessao_que_termina_sem_roteiro_falha() {
    let cenario = Cenario::novo();
    cenario.desmarcar("roteiro-valido");

    let (resultado, _) = cenario.rodar(None);

    assert!(matches!(resultado, Err(ErroDoRoteiro::SemRoteiro)));
}

#[test]
fn roteiro_invalido_falha_com_os_erros_e_a_nova_tentativa_os_recebe() {
    let cenario = Cenario::novo();
    cenario.desmarcar("roteiro-valido");
    cenario.marcar("roteiro-invalido");

    let (resultado, _) = cenario.rodar(None);

    let ErroDoRoteiro::Invalido(erros) = resultado.unwrap_err() else {
        panic!("esperava roteiro inválido");
    };
    assert!(erros.contains("o corte não tem trechos"), "{erros}");
    assert!(erros.contains("Roteiro inválido: 1 erro(s)"), "{erros}");

    // A nova tentativa recebe os erros e, com o roteiro bom, o projeto segue.
    cenario.desmarcar("roteiro-invalido");
    cenario.marcar("roteiro-valido");
    cenario.rodar(None).0.unwrap();

    let prompt = cenario.lido("prompt.log");
    assert!(prompt.contains("Erros da tentativa anterior"), "{prompt}");
    assert!(prompt.contains("o corte não tem trechos"), "{prompt}");
    // Passou a valer, então a tentativa seguinte já não os recebe.
    cenario.rodar(None).0.unwrap();
    assert!(
        !cenario
            .lido("prompt.log")
            .contains("Erros da tentativa anterior")
    );
}

#[test]
fn sessao_cancelada_morre_e_nao_valida() {
    let cenario = Cenario::novo();
    let cancelar = AtomicBool::new(true);

    let resultado = cenario.roteirista.roteirizar(
        &Pedido {
            pasta: &cenario.pasta,
            video: "aula.mp4",
            idioma: "pt",
            cortes: 6,
            pedido: "",
            modelo: None,
        },
        &cancelar,
        &mut |_| {},
    );

    assert!(matches!(resultado, Err(ErroDoRoteiro::Cancelado)));
}

#[test]
fn a_skill_vai_para_os_dados_do_app_e_os_aprendizados_ficam_numa_pasta_gravavel() {
    let tmp = tempfile::tempdir().unwrap();
    let dados = tmp.path().join("dados");

    let primeira = preparar_skill(&raiz().join("assets"), &dados).unwrap();

    assert!(primeira.skill.join("SKILL.md").is_file());
    assert!(primeira.skill.join("prompts/roteirizar.md").is_file());
    assert!(!primeira.skill.join("references/aprendizados.md").exists());
    let semente = fs::read_to_string(primeira.aprendizados.join("aprendizados.md")).unwrap();
    assert!(semente.contains("O usuário não quer escrever nem escolher nada"));

    // Uma atualização troca a skill, mas não perde o que o Claude aprendeu.
    fs::write(
        primeira.aprendizados.join("aprendizados.md"),
        "regra nova\n",
    )
    .unwrap();
    fs::write(primeira.skill.join("velho.md"), "").unwrap();
    let segunda = preparar_skill(&raiz().join("assets"), &dados).unwrap();
    assert!(!segunda.skill.join("velho.md").exists());
    assert_eq!(
        fs::read_to_string(segunda.aprendizados.join("aprendizados.md")).unwrap(),
        "regra nova\n"
    );
}

mod na_fila {
    use std::sync::Mutex;
    use std::sync::mpsc;
    use std::time::Duration;

    use nucleo::{Config, EstadoDaEtapa, Etapa, Evento, Nucleo};

    use super::*;

    /// A etapa Roteiro depois da Transcrição: a sessão aparece como eventos e o roteiro
    /// inválido leva o projeto a Falhou, com os erros.
    #[test]
    fn roteiro_invalido_falha_a_etapa_com_os_erros_depois_das_acoes_do_claude() {
        let cenario = Cenario::novo();
        cenario.desmarcar("roteiro-valido");
        cenario.marcar("roteiro-invalido");
        let tmp = cenario.tmp.path();
        let bin = tmp.join("bin-transcricao");
        fs::create_dir(&bin).unwrap();
        fs::write(
            bin.join("ffmpeg"),
            "#!/bin/sh\nfor u; do :; done\nhead -c 3200000 /dev/zero > \"$u\"\n",
        )
        .unwrap();
        let gravado = raiz().join(".scratch/shorts-ai-mvp/spike-transcricao/gravado");
        fs::write(
            bin.join("whisper-cli"),
            format!(
                "#!/bin/sh\ncase \"$1\" in\n\
                 @*) saida=\"$(grep -A1 '^-of$' \"${{1#@}}\" | tail -1)\" ;;\n\
                 *) while [ $# -gt 0 ]; do [ \"$1\" = \"-of\" ] && saida=\"$2\"; shift; done ;;\n\
                 esac\n\
                 cp '{}' \"$saida.json\"\ncat '{}' >&2\n",
                gravado.join("transcricao.json").display(),
                gravado.join("whisper.log").display()
            ),
        )
        .unwrap();
        for nome in ["ffmpeg", "whisper-cli"] {
            fs::set_permissions(bin.join(nome), fs::Permissions::from_mode(0o755)).unwrap();
        }
        let dados = tmp.join("dados-do-nucleo");
        let skill = preparar_skill(&raiz().join("assets"), &dados).unwrap();
        let (envio, eventos) = mpsc::channel();
        let envio = Mutex::new(envio);
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: dados.clone(),
                pasta_de_videos: Some(tmp.join("Videos")),
                transcritor: Some(nucleo::transcricao::Transcritor::new(
                    bin.join("ffmpeg"),
                    bin.join("whisper-cli"),
                    "modelo.bin".into(),
                    "vad.bin".into(),
                )),
                roteirista: Some(Roteirista::new(
                    cenario.bin().join("claude"),
                    dados.join("claude"),
                    skill,
                    None,
                )),
                ..Config::default()
            },
            move |evento| {
                let _ = envio.lock().unwrap().send(evento);
            },
        );
        let video = tmp.join("aula.mp4");
        fs::write(&video, b"video de mentira").unwrap();

        let projeto = nucleo
            .criar_lote(&[video.display().to_string()])
            .unwrap()
            .remove(0);

        let mut acoes = 0;
        let mut ultimos_tokens = None;
        let falha = loop {
            match eventos
                .recv_timeout(Duration::from_secs(20))
                .expect("o Roteiro não terminou")
            {
                Evento::AcaoDoClaude {
                    etapa: Etapa::Roteiro,
                    ..
                } => acoes += 1,
                Evento::TokensDoClaude {
                    etapa: Etapa::Roteiro,
                    entrada,
                    cache,
                    ..
                } => ultimos_tokens = Some((entrada, cache)),
                Evento::EtapaMudou {
                    etapa: Etapa::Roteiro,
                    estado: EstadoDaEtapa::Falhou,
                    falha,
                    ..
                } => break falha.unwrap(),
                Evento::EtapaMudou {
                    etapa: Etapa::Roteiro,
                    estado: EstadoDaEtapa::Concluida,
                    ..
                } => panic!("o roteiro inválido não pode concluir"),
                _ => {}
            }
        };

        assert_eq!(acoes, 4);
        assert_eq!(ultimos_tokens, Some((11, 37_900)));
        assert!(falha.contains("o corte não tem trechos"), "{falha}");
        let pasta = PathBuf::from(&projeto.pasta);
        let json: Value =
            serde_json::from_slice(&fs::read(pasta.join("projeto.json")).unwrap()).unwrap();
        assert!(json["falha"].as_str().unwrap().contains("roteiro inválido"));
        assert_eq!(json["etapas"][2]["estado"], "falhou");
        assert!(pasta.join("edit/sessao-roteiro.jsonl").is_file());
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(pasta.join("edit/custos.json")).unwrap())
                .unwrap()[0]["custoUsd"],
            0.42
        );
    }
}
