//! A sessão do Claude do Roteiro pela interface pública do núcleo, com um `claude` falso (um
//! script de shell) que repete uma sessão gravada, recortada: os eventos, o roteiro, o log e o
//! `custos.json`. Variações: vários `result`, sessão que cai e roteiro inválido.
//!
//! As gravações são sessões reais de roteiro do CLI (`~/ai-editor/edit/logs/`), recortadas:
//! ficam algumas linhas, na ordem, e cada texto com mais de 200 caracteres é cortado com `…`;
//! números, ids e tipos ficam como vieram.
//! - `sessao-roteiro.jsonl`: `20261006-150110-roteirizar.jsonl`, do KGfmaHnBQx4, cujo roteiro
//!   final é o da referência que o `claude` falso escreve.
//! - `sessao-roteiro-varios-results.jsonl`: `20261007-145036-roteirizar.jsonl`, outro vídeo, em
//!   que os sub-agentes em segundo plano fazem a sessão terminar com quatro `result`.
#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use nucleo::ClaudeCode;
use nucleo::sessao::{
    ErroDoRoteiro, EventoDaSessao, Pedido, ResultadoDaRevisao, Roteirista, preparar_skill,
};
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

/// O `total_cost_usd` do `result` da sessão gravada do KGfmaHnBQx4.
const CUSTO_GRAVADO: f64 = 2.4658704000000005;

fn raiz() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn gravacao(nome: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/dados")
        .join(nome)
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
        fs::copy(gravacao("sessao-roteiro.jsonl"), bin.join("stream.jsonl")).unwrap();
        let referencia = raiz().join(".scratch/shorts-ai-mvp/referencia-kgfmahnbqx4");
        fs::copy(referencia.join("roteiro.json"), bin.join("roteiro.json")).unwrap();
        fs::write(bin.join("roteiro-valido"), "").unwrap();

        let dados = tmp.path().join("dados");
        let roteirista = Roteirista::new(
            ClaudeCode::new(
                Some(bin.clone().into_os_string()),
                None,
                dados.join("claude"),
            ),
            raiz().join("assets"),
            dados.clone(),
            Some(tmp.path().join("cli")),
        );
        let aprendizados = dados.join("aprendizados");

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

    fn revisar(
        &self,
    ) -> (
        Result<ResultadoDaRevisao, ErroDoRoteiro>,
        Vec<EventoDaSessao>,
    ) {
        let mut eventos = Vec::new();
        let resultado = self.roteirista.revisar(
            &Pedido {
                pasta: &self.pasta,
                video: "aula.mp4",
                idioma: "pt",
                cortes: 6,
                pedido: "",
                modelo: None,
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

    /// O `claude` falso passa a repetir outra gravação.
    fn usar_gravacao(&self, nome: &str) {
        fs::copy(gravacao(nome), self.bin().join("stream.jsonl")).unwrap();
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

fn tokens(entrada: u32, cache: u32) -> EventoDaSessao {
    EventoDaSessao::Tokens { entrada, cache }
}

#[test]
fn cada_linha_do_stream_vira_um_evento_com_os_tokens_somados_por_mensagem() {
    let cenario = Cenario::novo();

    let (resultado, eventos) = cenario.rodar(None);

    resultado.unwrap();
    assert_eq!(
        eventos,
        [
            // Um bloco de raciocínio não é ação, mas a mensagem já conta os tokens.
            tokens(2, 22_947),
            // O alvo é a primeira linha, em até 120 caracteres.
            acao(
                "Bash",
                "cat /home/pomsan/.claude/skills/corte-viral/SKILL.md; echo ======; \
                 cat /home/pomsan/.claude/skills/corte-viral/reference"
            ),
            // A mesma mensagem repete o `usage`: a soma não dobra.
            tokens(2, 22_947),
            acao("Grep", "/home/pomsan/ai-editor/edit/takes_packed.md"),
            tokens(4, 58_137),
            acao("texto", "Short video (12 min). Reading the whole section."),
            tokens(6, 94_392),
            acao("Read", "/home/pomsan/ai-editor/edit/takes_packed.md"),
            tokens(6, 94_392),
            acao(
                "texto",
                "Seleção feita (6 para produzir + 5 reservas), reaproveitando as cenas já \
                 existentes. Escrevendo o roteiro."
            ),
            tokens(8, 188_813),
            acao(
                "Write",
                "/home/pomsan/ai-editor/edit/roteiros/KGfmaHnBQx4.json"
            ),
            tokens(8, 188_813),
            acao(
                "Bash",
                "./ae validar edit/roteiros/KGfmaHnBQx4.json 2>&1 | tail -60"
            ),
            tokens(10, 298_628),
            acao(
                "texto",
                "O roteiro está pronto em `edit/roteiros/KGfmaHnBQx4.json`. `./ae validar` passa \
                 sem erros e sem avisos, e o resumo legív"
            ),
            tokens(12, 427_892),
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
fn o_custo_vem_do_result_da_sessao() {
    let cenario = Cenario::novo();

    cenario.rodar(None).0.unwrap();

    let custos = cenario.custos();
    assert_eq!(custos.len(), 1);
    let roteiro = &custos[0];
    assert_eq!(roteiro["etapa"], "roteiro");
    assert_eq!(roteiro["sessionId"], "c941c34d-e576-40f8-b77f-3ae19bf3fabc");
    assert!(
        time::OffsetDateTime::parse(
            roteiro["inicio"].as_str().unwrap(),
            &time::format_description::well_known::Rfc3339
        )
        .is_ok(),
        "{roteiro}"
    );
    assert_eq!(roteiro["custoUsd"], CUSTO_GRAVADO);
    assert_eq!(roteiro["turnos"], 35);
    assert_eq!(roteiro["duracaoMs"], 591_837);
    assert_eq!(roteiro["parcial"], false);
    assert_eq!(
        roteiro["modelos"],
        json!({
            "claude-opus-5-5": {
                "entrada": 64,
                "saida": 54_169,
                "cacheLeitura": 2_283_532,
                "cacheCriacao": 115_691,
                "custoUsd": CUSTO_GRAVADO,
                "custoBase": "list"
            }
        })
    );
}

/// Os sub-agentes em segundo plano reabrem a sessão: quatro `result`, cada um com o
/// `total_cost_usd` acumulado. Vale o último, sem somar.
#[test]
fn com_varios_results_o_custo_vem_do_ultimo_sem_somar() {
    let cenario = Cenario::novo();
    cenario.usar_gravacao("sessao-roteiro-varios-results.jsonl");

    let (resultado, eventos) = cenario.rodar(None);

    resultado.unwrap();
    let roteiro = cenario.ultimo_custo();
    assert_eq!(roteiro["sessionId"], "8ccee9ed-900d-4708-af6e-2821e0f506ad");
    assert_eq!(roteiro["custoUsd"], 13.655_747_6);
    assert_eq!(roteiro["turnos"], 8);
    assert_eq!(roteiro["duracaoMs"], 42_452);
    assert_eq!(roteiro["parcial"], false);
    assert_eq!(
        roteiro["modelos"]["claude-opus-5-5"],
        json!({
            "entrada": 197,
            "saida": 348_469,
            "cacheLeitura": 13_117_193,
            "cacheCriacao": 651_999,
            "custoUsd": 13.655_747_6,
            "custoBase": "list"
        })
    );
    // Os tokens ao vivo somam as mensagens das quatro voltas.
    assert_eq!(eventos.last(), Some(&tokens(15, 1_646_923)));
}

#[test]
fn result_final_com_erro_e_custo_zerado_usa_o_anterior_e_marca_parcial() {
    let cenario = Cenario::novo();
    cenario.acrescentar_ao_stream(
        r#"{"type":"result","subtype":"error_during_execution","is_error":true,"duration_ms":10,"num_turns":0,"total_cost_usd":0,"modelUsage":{}}"#,
    );

    cenario.rodar(None).0.unwrap();

    let roteiro = cenario.ultimo_custo();
    assert_eq!(roteiro["custoUsd"], CUSTO_GRAVADO);
    assert_eq!(roteiro["turnos"], 35);
    assert_eq!(roteiro["parcial"], true);
}

#[test]
fn result_final_com_erro_e_custo_proprio_vale_e_nao_e_parcial() {
    let cenario = Cenario::novo();
    cenario.acrescentar_ao_stream(
        r#"{"type":"result","subtype":"error_during_execution","is_error":true,"duration_ms":70000,"num_turns":9,"total_cost_usd":0.6,"modelUsage":{"claude-opus-5-5":{"inputTokens":1,"outputTokens":2,"cacheReadInputTokens":3,"cacheCreationInputTokens":4,"costUSD":0.6}}}"#,
    );

    cenario.rodar(None).0.unwrap();

    let roteiro = cenario.ultimo_custo();
    assert_eq!(roteiro["custoUsd"], 0.6);
    assert_eq!(roteiro["turnos"], 9);
    assert_eq!(roteiro["parcial"], false);
}

#[test]
fn unico_result_com_erro_e_custo_zerado_fica_zerado_e_parcial() {
    let cenario = Cenario::novo();
    fs::write(
        cenario.bin().join("stream.jsonl"),
        concat!(
            r#"{"type":"system","subtype":"init","session_id":"s9"}"#,
            "\n",
            r#"{"type":"result","subtype":"error_during_execution","is_error":true,"duration_ms":10,"num_turns":0,"total_cost_usd":0,"modelUsage":{}}"#,
            "\n"
        ),
    )
    .unwrap();

    cenario.rodar(None).0.unwrap();

    let roteiro = cenario.ultimo_custo();
    assert_eq!(roteiro["custoUsd"], 0.0);
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
        assert_eq!(custo["custoUsd"], CUSTO_GRAVADO);
    }
}

#[test]
fn a_linha_do_custos_json_traz_o_preco_calculado_pelo_app_e_a_data_da_tabela() {
    let cenario = Cenario::novo();

    cenario.rodar(None).0.unwrap();

    let custo = cenario.ultimo_custo();
    let calculado = custo["custoCalculadoUsd"].as_f64().unwrap();
    assert!((calculado - CUSTO_GRAVADO).abs() < 1e-6, "{calculado}");
    assert_eq!(custo["tabelaData"], "2026-10-07");
    assert_eq!(custo["precoAConferir"], false);
    assert_eq!(custo["modelos"]["claude-opus-5-5"]["custoBase"], "list");
}

#[test]
fn preco_calculado_que_diverge_do_claude_code_em_mais_de_5_por_cento_fica_a_conferir() {
    let cenario = Cenario::novo();
    // Nesta gravação os sub-agentes em segundo plano pesam no `modelUsage`: o app calcula
    // US$ 14,81 contra os US$ 13,66 do Claude Code.
    cenario.usar_gravacao("sessao-roteiro-varios-results.jsonl");

    cenario.rodar(None).0.unwrap();

    let custo = cenario.ultimo_custo();
    assert_eq!(custo["precoAConferir"], true);
    assert!(custo["custoCalculadoUsd"].as_f64().unwrap() > 14.0);
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
        // O Claude Code do Windows sem Git Bash roda os comandos pelo PowerShell.
        "PowerShell(shorts-cli validar *),PowerShell(shorts-cli tsc *),PowerShell(shorts-cli still *),PowerShell(shorts-cli cena *)",
        "PowerShell(Get-ChildItem *),PowerShell(Get-Content *),PowerShell(Select-String *),PowerShell(Select-Object *),PowerShell(Measure-Object *)",
        "--disallowedTools Bash(rm:*),WebFetch,WebSearch",
        "PowerShell(Remove-Item *),PowerShell(Invoke-WebRequest *),PowerShell(Invoke-RestMethod *),PowerShell(curl *),PowerShell(wget *),PowerShell(yt-dlp *),PowerShell(ffmpeg *)",
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
    assert_eq!(cenario.ultimo_custo()["custoUsd"], CUSTO_GRAVADO);
}

#[test]
fn rate_limit_event_de_limite_atingido_leva_a_cota_esgotada_com_a_hora_de_liberar() {
    let cenario = Cenario::novo();
    cenario.desmarcar("roteiro-valido");
    fs::write(
        cenario.bin().join("stream.jsonl"),
        concat!(
            r#"{"type":"system","subtype":"init","session_id":"abc"}"#,
            "\n",
            r#"{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1791397200,"rateLimitType":"five_hour"}}"#,
            "\n",
            r#"{"type":"result","subtype":"success","is_error":true,"result":"limite atingido","total_cost_usd":0.1}"#,
            "\n",
        ),
    )
    .unwrap();

    let (resultado, _) = cenario.rodar(None);

    assert!(
        matches!(
            resultado,
            Err(ErroDoRoteiro::CotaEsgotada {
                libera_em: Some(1_791_397_200)
            })
        ),
        "{resultado:?}"
    );
    assert_eq!(cenario.custos().len(), 1);
}

#[test]
fn credits_required_tambem_e_cota_esgotada_mesmo_com_a_sessao_caindo() {
    let cenario = Cenario::novo();
    cenario.desmarcar("roteiro-valido");
    cenario.marcar("cai");
    fs::write(
        cenario.bin().join("stream.jsonl"),
        concat!(
            r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","errorCode":"credits_required"}}"#,
            "\n",
        ),
    )
    .unwrap();

    let (resultado, _) = cenario.rodar(None);

    assert!(
        matches!(
            resultado,
            Err(ErroDoRoteiro::CotaEsgotada { libera_em: None })
        ),
        "{resultado:?}"
    );
}

#[test]
fn rate_limit_event_permitido_nao_atrapalha_a_sessao() {
    let cenario = Cenario::novo();

    let (resultado, _) = cenario.rodar(None);

    resultado.unwrap();
}

#[test]
fn limite_atingido_numa_sessao_que_terminou_bem_nao_e_cota_esgotada() {
    let cenario = Cenario::novo();
    cenario.acrescentar_ao_stream(
        r#"{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1791397200}}"#,
    );

    let (resultado, _) = cenario.rodar(None);

    resultado.unwrap();
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
fn sem_o_claude_code_instalado_a_sessao_falha_sem_rodar() {
    let cenario = Cenario::novo();
    let dados = cenario.tmp.path().join("dados");
    let roteirista = Roteirista::new(
        ClaudeCode::new(Some("/nao/existe".into()), None, dados.join("claude")),
        raiz().join("assets"),
        dados,
        None,
    );

    let resultado = roteirista.roteirizar(
        &Pedido {
            pasta: &cenario.pasta,
            video: "aula.mp4",
            idioma: "pt",
            cortes: 6,
            pedido: "",
            modelo: None,
        },
        &AtomicBool::new(false),
        &mut |_| {},
    );

    assert!(matches!(resultado, Err(ErroDoRoteiro::ClaudeNaoEncontrado)));
    assert!(!cenario.pasta.join("edit/sessao-roteiro.jsonl").exists());
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

    use nucleo::{
        Config, EstadoDaEtapa, Etapa, Evento, MotivoDeNotificacao, Nucleo, Padroes, Parada,
    };

    use super::*;

    /// O núcleo com a Transcrição de mentira (ffmpeg e whisper-cli falsos) e o `claude` falso do
    /// cenário, e um vídeo para o lote.
    fn abrir_nucleo(cenario: &Cenario) -> (Nucleo, mpsc::Receiver<Evento>, PathBuf) {
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
        let (envio, eventos) = mpsc::channel();
        let envio = Mutex::new(envio);
        // O ffmpeg e o whisper-cli vêm da pasta dos sidecars; o `claude`, do PATH.
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: tmp.join("dados-do-nucleo"),
                pasta_de_videos: Some(tmp.join("Videos")),
                path_env: Some(cenario.bin().into_os_string()),
                assets_dir: Some(raiz().join("assets")),
                sidecar_dir: Some(bin.clone()),
                ..Config::default()
            },
            move |evento| {
                let _ = envio.lock().unwrap().send(evento);
            },
        );
        let video = tmp.join("aula.mp4");
        fs::write(&video, b"video de mentira").unwrap();

        (nucleo, eventos, video)
    }

    fn criar_projeto(nucleo: &Nucleo, video: &Path) -> nucleo::ProjetoResumo {
        nucleo
            .criar_lote(&[video.display().to_string()], &Padroes::default())
            .unwrap()
            .remove(0)
    }

    /// Espera o evento que o filtro aceita.
    fn esperar<T>(
        eventos: &mpsc::Receiver<Evento>,
        mut filtro: impl FnMut(Evento) -> Option<T>,
    ) -> T {
        loop {
            let evento = eventos
                .recv_timeout(Duration::from_secs(20))
                .expect("o evento esperado não veio");
            if let Some(achado) = filtro(evento) {
                return achado;
            }
        }
    }

    fn esperar_parada(eventos: &mpsc::Receiver<Evento>, esperada: Option<Parada>) {
        esperar(eventos, |evento| match evento {
            Evento::ParadaMudou { parada, .. } if parada == esperada => Some(()),
            _ => None,
        });
    }

    /// A sessão do Roteiro roda de novo, sem a Transcrição se repetir.
    fn esperar_roteiro_retomado(eventos: &mpsc::Receiver<Evento>) {
        esperar(eventos, |evento| match evento {
            Evento::EtapaMudou {
                etapa: Etapa::Transcricao,
                estado: EstadoDaEtapa::EmAndamento,
                ..
            } => panic!("a Transcrição não pode se repetir"),
            Evento::TokensDoClaude {
                etapa: Etapa::Roteiro,
                ..
            } => Some(()),
            _ => None,
        });
    }

    /// A gravação que o `claude` falso repete passa a dizer que a cota acabou e libera em
    /// `libera_em` (segundos desde 1970).
    fn esgotar_a_cota(cenario: &Cenario, libera_em: i64) {
        fs::write(
            cenario.bin().join("stream.jsonl"),
            format!(
                "{{\"type\":\"rate_limit_event\",\"rate_limit_info\":{{\"status\":\"rejected\",\"resetsAt\":{libera_em}}}}}\n\
                 {{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":true,\"result\":\"limite\",\"total_cost_usd\":0.1}}\n"
            ),
        )
        .unwrap();
    }

    fn agora() -> i64 {
        i64::try_from(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        )
        .unwrap()
    }

    #[test]
    fn cota_esgotada_deixa_o_projeto_aguardando_sem_refazer_e_retomar_agora_continua() {
        let cenario = Cenario::novo();
        esgotar_a_cota(&cenario, 4_102_444_800);
        let (nucleo, eventos, video) = abrir_nucleo(&cenario);
        let projeto = criar_projeto(&nucleo, &video);

        esperar_parada(&eventos, Some(Parada::AguardandoCota));

        let aguardando = nucleo
            .lotes()
            .into_iter()
            .flat_map(|lote| lote.projetos)
            .find(|item| item.id == projeto.id)
            .unwrap();
        assert_eq!(aguardando.parada, Some(Parada::AguardandoCota));
        assert_eq!(aguardando.falha, None);
        let estados: Vec<_> = aguardando.etapas.iter().map(|item| item.estado).collect();
        assert_eq!(
            estados[..3],
            [
                EstadoDaEtapa::Concluida,
                EstadoDaEtapa::Concluida,
                EstadoDaEtapa::Pendente
            ]
        );
        assert!(
            nucleo.pausar(&projeto.id).is_err(),
            "quem aguarda a cota não pausa"
        );

        // Retomar agora, com a cota de volta: a Transcrição não se repete.
        fs::copy(
            gravacao("sessao-roteiro.jsonl"),
            cenario.bin().join("stream.jsonl"),
        )
        .unwrap();
        nucleo.retomar(&projeto.id).unwrap();

        esperar_roteiro_retomado(&eventos);
    }

    #[test]
    fn o_projeto_aguardando_a_cota_retoma_sozinho_quando_ela_libera() {
        let cenario = Cenario::novo();
        esgotar_a_cota(&cenario, agora() + 2);
        let (nucleo, eventos, video) = abrir_nucleo(&cenario);
        criar_projeto(&nucleo, &video);

        esperar_parada(&eventos, Some(Parada::AguardandoCota));
        fs::copy(
            gravacao("sessao-roteiro.jsonl"),
            cenario.bin().join("stream.jsonl"),
        )
        .unwrap();

        esperar_parada(&eventos, None);
        esperar_roteiro_retomado(&eventos);
    }

    #[test]
    fn cancelar_o_projeto_aguardando_a_cota_impede_a_retomada() {
        let cenario = Cenario::novo();
        esgotar_a_cota(&cenario, agora() + 2);
        let (nucleo, eventos, video) = abrir_nucleo(&cenario);
        let projeto = criar_projeto(&nucleo, &video);

        esperar_parada(&eventos, Some(Parada::AguardandoCota));
        nucleo.cancelar(&projeto.id).unwrap();
        esperar_parada(&eventos, Some(Parada::Cancelado));

        assert!(
            eventos
                .recv_timeout(Duration::from_secs(4))
                .map_or(true, |evento| !matches!(
                    evento,
                    Evento::ParadaMudou { parada: None, .. }
                ))
        );
        let atual = nucleo
            .lotes()
            .into_iter()
            .flat_map(|lote| lote.projetos)
            .find(|item| item.id == projeto.id)
            .unwrap();
        assert_eq!(atual.parada, Some(Parada::Cancelado));
    }

    #[test]
    fn notificacoes_avisam_que_aguarda_a_cota_e_que_falhou_e_o_lote_terminou() {
        let cenario = Cenario::novo();
        esgotar_a_cota(&cenario, 4_102_444_800);
        let (nucleo, eventos, video) = abrir_nucleo(&cenario);
        let projeto = criar_projeto(&nucleo, &video);

        let (titulo, lote) = esperar(&eventos, |evento| match evento {
            Evento::Notificacao {
                motivo: MotivoDeNotificacao::AguardandoCota,
                projeto,
                lote,
            } => Some((projeto, lote)),
            _ => None,
        });
        assert_eq!(titulo, projeto.titulo);
        assert!(lote.starts_with("Lote de"), "{lote}");

        // Com a cota de volta e um roteiro inválido, o projeto falha e fecha o lote.
        cenario.desmarcar("roteiro-valido");
        cenario.marcar("roteiro-invalido");
        fs::copy(
            gravacao("sessao-roteiro.jsonl"),
            cenario.bin().join("stream.jsonl"),
        )
        .unwrap();
        nucleo.retomar(&projeto.id).unwrap();

        let motivos: Vec<_> =
            std::iter::from_fn(|| eventos.recv_timeout(Duration::from_secs(20)).ok())
                .filter_map(|evento| match evento {
                    Evento::Notificacao { motivo, .. } => Some(motivo),
                    _ => None,
                })
                .take(2)
                .collect();
        assert_eq!(
            motivos,
            [
                MotivoDeNotificacao::ProjetoFalhou,
                MotivoDeNotificacao::LoteTerminado
            ]
        );
    }

    /// A etapa Roteiro depois da Transcrição: a sessão aparece como eventos e o roteiro
    /// inválido leva o projeto a Falhou, com os erros.
    #[test]
    fn roteiro_invalido_falha_a_etapa_com_os_erros_depois_das_acoes_do_claude() {
        let cenario = Cenario::novo();
        cenario.desmarcar("roteiro-valido");
        cenario.marcar("roteiro-invalido");
        let (nucleo, eventos, video) = abrir_nucleo(&cenario);

        let projeto = criar_projeto(&nucleo, &video);

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

        assert_eq!(acoes, 8);
        assert_eq!(ultimos_tokens, Some((12, 427_892)));
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
            CUSTO_GRAVADO
        );
    }
}

/// As gravações da revisão são sessões recortadas à mão no formato real do `stream-json`: o
/// `~/ai-editor/edit/logs/` desta máquina não guarda nenhuma sessão de revisão.
#[test]
fn a_revisao_sem_mudancas_termina_com_a_marca_e_registra_log_e_custo() {
    let cenario = Cenario::novo();
    cenario.usar_gravacao("sessao-revisao-sem-mudancas.jsonl");
    fs::copy(
        cenario.bin().join("roteiro.json"),
        cenario.pasta.join("edit/roteiro.json"),
    )
    .unwrap();
    cenario.desmarcar("roteiro-valido");

    let (resultado, eventos) = cenario.revisar();

    assert_eq!(resultado.unwrap(), ResultadoDaRevisao::SemMudancas);
    assert_eq!(eventos[0], acao("Read", "edit/producao.json"));
    assert_eq!(
        eventos
            .iter()
            .filter(|e| matches!(e, EventoDaSessao::Tokens { .. }))
            .count(),
        3
    );
    let log = fs::read_to_string(cenario.pasta.join("edit/sessao-revisao.jsonl")).unwrap();
    assert!(log.lines().next().unwrap().contains("7a1d3c52"), "{log}");
    assert!(!cenario.pasta.join("edit/sessao-roteiro.jsonl").exists());
    let custo = cenario.ultimo_custo();
    assert_eq!(custo["etapa"], "revisao");
    assert_eq!(custo["custoUsd"], 0.4172);
    assert_eq!(custo["turnos"], 3);
    assert_eq!(custo["parcial"], false);
    let prompt = cenario.lido("prompt.log");
    assert!(prompt.contains("sessão de Revisão"), "{prompt}");
    assert!(prompt.contains("idioma `pt`"), "{prompt}");
    assert!(prompt.contains("edit/roteiro.json"), "{prompt}");
}

#[test]
fn a_revisao_que_muda_o_roteiro_termina_com_roteiro_atualizado() {
    let cenario = Cenario::novo();
    cenario.usar_gravacao("sessao-revisao-atualizada.jsonl");

    let (resultado, _) = cenario.revisar();

    assert_eq!(resultado.unwrap(), ResultadoDaRevisao::Atualizado);
}

#[test]
fn sem_marca_na_resposta_vale_o_roteiro_ter_mudado_ou_nao() {
    let cenario = Cenario::novo();
    cenario.usar_gravacao("sessao-roteiro.jsonl");
    cenario.desmarcar("roteiro-valido");
    fs::copy(
        cenario.bin().join("roteiro.json"),
        cenario.pasta.join("edit/roteiro.json"),
    )
    .unwrap();
    assert_eq!(
        cenario.revisar().0.unwrap(),
        ResultadoDaRevisao::SemMudancas
    );

    cenario.marcar("roteiro-invalido");
    let (resultado, _) = cenario.revisar();
    assert!(matches!(resultado, Err(ErroDoRoteiro::Invalido(_))));
}

#[test]
fn roteiro_invalido_depois_da_revisao_falha_com_os_erros() {
    let cenario = Cenario::novo();
    cenario.usar_gravacao("sessao-revisao-atualizada.jsonl");
    cenario.desmarcar("roteiro-valido");
    cenario.marcar("roteiro-invalido");

    let (resultado, _) = cenario.revisar();

    let ErroDoRoteiro::Invalido(erros) = resultado.unwrap_err() else {
        panic!("esperava roteiro inválido");
    };
    assert!(erros.contains("o corte não tem trechos"), "{erros}");
    assert_eq!(cenario.ultimo_custo()["etapa"], "revisao");
}

const KIT_COM_TITULOS_CONDENSADOS: &str = r##"{"nome": "Canal", "corDeDestaque": "#00AAFF", "corDaPalavra": "#FFFFFF", "fonteDaLegenda": "Inter", "fonteDosTitulos": "Anton"}"##;

fn estilo_do_roteiro(cenario: &Cenario) -> Value {
    let roteiro: Value =
        serde_json::from_str(&fs::read_to_string(cenario.pasta.join("edit/roteiro.json")).unwrap())
            .unwrap();
    roteiro["estilo"].clone()
}

#[test]
fn o_resumo_do_kit_entra_no_prompt() {
    let cenario = Cenario::novo();
    fs::write(cenario.pasta.join("kit.json"), KIT_COM_TITULOS_CONDENSADOS).unwrap();

    cenario.rodar(None).0.unwrap();

    let prompt = cenario.lido("prompt.log");
    assert!(prompt.contains("Kit de marca do projeto"), "{prompt}");
    assert!(prompt.contains("Anton (condensada"), "{prompt}");
    assert!(prompt.contains("Inter (larga"), "{prompt}");
}

#[test]
fn o_estilo_do_kit_vai_para_o_roteiro_que_veio_sem_ele() {
    let cenario = Cenario::novo();
    let escrito = cenario.bin().join("roteiro.json");
    let mut roteiro: Value = serde_json::from_slice(&fs::read(&escrito).unwrap()).unwrap();
    roteiro.as_object_mut().unwrap().remove("estilo");
    fs::write(&escrito, roteiro.to_string()).unwrap();
    fs::write(cenario.pasta.join("kit.json"), KIT_COM_TITULOS_CONDENSADOS).unwrap();

    cenario.rodar(None).0.unwrap();

    let estilo = estilo_do_roteiro(&cenario);
    assert_eq!(estilo["accent"], "#00AAFF");
    assert_eq!(estilo["highlight"], "#FFFFFF");
    assert_eq!(estilo["fontes"]["legenda"], "Inter");
    assert_eq!(estilo["fontes"]["titulos"], "Anton");
}

#[test]
fn o_roteiro_semeado_com_o_estilo_e_sem_cortes_nao_vale_como_escrito() {
    let cenario = Cenario::novo();
    cenario.desmarcar("roteiro-valido");
    fs::write(cenario.pasta.join("kit.json"), KIT_COM_TITULOS_CONDENSADOS).unwrap();

    let (resultado, _) = cenario.rodar(None);

    assert!(matches!(resultado, Err(ErroDoRoteiro::SemRoteiro)));
    assert_eq!(estilo_do_roteiro(&cenario)["fontes"]["titulos"], "Anton");
}

#[test]
fn o_que_o_claude_escolheu_no_estilo_vale_mais_que_o_kit() {
    let cenario = Cenario::novo();
    fs::write(cenario.pasta.join("kit.json"), KIT_COM_TITULOS_CONDENSADOS).unwrap();

    cenario.rodar(None).0.unwrap();

    let estilo = estilo_do_roteiro(&cenario);
    assert_eq!(estilo["accent"], "#FF2D2D");
    assert_eq!(estilo["fontes"]["titulos"], "Anton");
}
