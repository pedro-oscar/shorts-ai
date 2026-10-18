//! O custo pela interface pública do núcleo: a tabela de preços (embutida e baixada), o preço
//! de API calculado com os tokens de `modelUsage` e os totais por projeto, reel e lote.
//!
//! Os casos de referência saem dos `result` das sessões gravadas na pasta de referência.

use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;

use nucleo::custo::{TabelaDePrecos, preco_a_conferir};
use nucleo::sessao::UsoDoModelo;
use nucleo::{Config, Etapa, Nucleo};
use serde_json::{Value, json};

mod comum;

fn gravacao(nome: &str) -> String {
    fs::read_to_string(comum::referencia("sessoes").join(nome)).unwrap()
}

/// Os tokens e o custo do último `result` da gravação, como o núcleo os lê do `modelUsage`.
fn modelos_do_result(nome: &str) -> (BTreeMap<String, UsoDoModelo>, f64) {
    let result: Value = gravacao(nome)
        .lines()
        .filter_map(|linha| serde_json::from_str::<Value>(linha).ok())
        .rfind(|linha| linha["type"] == "result")
        .unwrap();
    let modelos = result["modelUsage"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(modelo, uso)| {
            let numero = |chave: &str| uso[chave].as_u64().unwrap();
            let uso_do_modelo = UsoDoModelo {
                entrada: numero("inputTokens"),
                saida: numero("outputTokens"),
                cache_leitura: numero("cacheReadInputTokens"),
                cache_criacao: numero("cacheCreationInputTokens"),
                custo_usd: uso["costUSD"].as_f64().unwrap(),
                custo_base: uso["costBasis"].as_str().map(str::to_owned),
            };
            (modelo.clone(), uso_do_modelo)
        })
        .collect();
    (modelos, result["total_cost_usd"].as_f64().unwrap())
}

#[test]
fn a_tabela_embutida_tem_a_data_e_os_modelos_da_spec() {
    let tabela = TabelaDePrecos::embutida();

    assert_eq!(tabela.data, "2026-10-07");
    let opus = &tabela.modelos["claude-opus-5-5"];
    assert_eq!(
        (
            opus.entrada,
            opus.escrita5min,
            opus.escrita1h,
            opus.leitura,
            opus.saida
        ),
        (4.0, 5.0, 8.0, 0.2, 20.0)
    );
    assert_eq!(tabela.modelos.len(), 4);
}

#[test]
fn o_preco_de_api_bate_com_o_total_do_claude_code_na_sessao_de_referencia() {
    let (modelos, informado) = modelos_do_result("sessao-roteiro.jsonl");

    let calculado = TabelaDePrecos::embutida().preco_de_api(&modelos);

    let calculado = calculado.unwrap();
    assert!(
        (calculado - informado).abs() < 1e-6,
        "{calculado} {informado}"
    );
    assert!(!preco_a_conferir(Some(calculado), informado, &modelos));
}

#[test]
fn diferenca_de_mais_de_5_por_cento_costbasis_unknown_ou_modelo_fora_da_tabela_ficam_a_conferir() {
    let (modelos, informado) = modelos_do_result("sessao-roteiro-varios-results.jsonl");
    let tabela = TabelaDePrecos::embutida();
    let calculado = tabela.preco_de_api(&modelos);
    assert!(preco_a_conferir(calculado, informado, &modelos));

    let (mut modelos, informado) = modelos_do_result("sessao-roteiro.jsonl");
    let calculado = tabela.preco_de_api(&modelos);
    assert!(!preco_a_conferir(calculado, informado * 1.04, &modelos));
    assert!(preco_a_conferir(calculado, informado * 1.06, &modelos));
    modelos.get_mut("claude-opus-5-5").unwrap().custo_base = Some("unknown".to_owned());
    assert!(preco_a_conferir(calculado, informado, &modelos));

    let mut fora = modelos.clone();
    let uso = fora.remove("claude-opus-5-5").unwrap();
    fora.insert("claude-futuro-9".to_owned(), uso);
    assert_eq!(tabela.preco_de_api(&fora), None);
    assert!(preco_a_conferir(None, informado, &fora));
}

#[test]
fn o_modelo_com_sufixo_de_versao_usa_os_precos_do_nome_base() {
    let (modelos, _) = modelos_do_result("sessao-roteiro.jsonl");
    let uso = modelos["claude-opus-5-5"].clone();
    let tabela = TabelaDePrecos::embutida();
    let com_sufixo = BTreeMap::from([("claude-opus-5-5[1m]".to_owned(), uso)]);

    assert_eq!(
        tabela.preco_de_api(&com_sufixo),
        tabela.preco_de_api(&modelos)
    );
}

fn tabela_json(data: &str, entrada: f64) -> String {
    json!({
        "data": data,
        "modelos": {
            "claude-opus-5-5": {
                "entrada": entrada, "escrita5min": 5, "escrita1h": 8, "leitura": 0.2, "saida": 20
            }
        }
    })
    .to_string()
}

/// Um servidor de uma resposta só, que devolve `corpo`; devolve a URL.
fn servir(corpo: String) -> String {
    let servidor = TcpListener::bind("127.0.0.1:0").unwrap();
    let porta = servidor.local_addr().unwrap().port();
    std::thread::spawn(move || {
        let (mut conexao, _) = servidor.accept().unwrap();
        let mut pedido = [0; 2048];
        let _ = conexao.read(&mut pedido);
        let resposta = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{corpo}",
            corpo.len()
        );
        conexao.write_all(resposta.as_bytes()).unwrap();
    });
    format!("http://127.0.0.1:{porta}/precos.json")
}

#[test]
fn a_tabela_baixada_mais_nova_vale_no_lugar_da_embutida() {
    let dados = tempfile::tempdir().unwrap();
    assert_eq!(TabelaDePrecos::atual(dados.path()).data, "2026-10-07");

    let url = servir(tabela_json("2026-11-01", 5.0));
    let baixada = TabelaDePrecos::baixar(&url, dados.path()).unwrap();

    assert_eq!(baixada.data, "2026-11-01");
    let atual = TabelaDePrecos::atual(dados.path());
    assert_eq!(atual.data, "2026-11-01");
    assert_eq!(atual.modelos["claude-opus-5-5"].entrada, 5.0);
}

#[test]
fn tabela_baixada_mais_velha_que_a_embutida_ou_ilegivel_e_ignorada() {
    let dados = tempfile::tempdir().unwrap();
    fs::write(
        dados.path().join("precos.json"),
        tabela_json("2026-01-01", 1.0),
    )
    .unwrap();
    assert_eq!(TabelaDePrecos::atual(dados.path()).data, "2026-10-07");

    fs::write(dados.path().join("precos.json"), "não é json").unwrap();
    assert_eq!(TabelaDePrecos::atual(dados.path()).data, "2026-10-07");

    let url = servir("<html>não é uma tabela</html>".to_owned());
    assert!(TabelaDePrecos::baixar(&url, dados.path()).is_err());
    assert_eq!(
        fs::read_to_string(dados.path().join("precos.json")).unwrap(),
        "não é json"
    );
}

#[test]
fn atualizar_precos_sem_endereco_configurado_falha_sem_mexer_na_tabela() {
    let dados = tempfile::tempdir().unwrap();
    let nucleo = Nucleo::new(
        Config {
            app_data_dir: dados.path().to_owned(),
            ..Config::default()
        },
        |_| {},
    );

    assert!(nucleo.atualizar_precos().is_err());
    assert!(!dados.path().join("precos.json").exists());
}

fn linha(etapa: &str, custo: f64, calculado: Option<f64>, conferir: bool, entrada: u64) -> Value {
    json!({
        "etapa": etapa,
        "sessionId": "s",
        "inicio": "2026-10-12T10:00:00Z",
        "custoUsd": custo,
        "custoCalculadoUsd": calculado,
        "tabelaData": "2026-10-07",
        "precoAConferir": conferir,
        "turnos": 3,
        "duracaoMs": 2500,
        "parcial": false,
        "modelos": {"claude-opus-5-5": {
            "entrada": entrada, "saida": 20, "cacheLeitura": 300, "cacheCriacao": 40,
            "custoUsd": custo, "custoBase": "list"
        }}
    })
}

struct Cenario {
    _tmp: tempfile::TempDir,
    nucleo: Nucleo,
}

impl Cenario {
    fn novo() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let nucleo = Nucleo::new(
            Config {
                app_data_dir: tmp.path().join("dados"),
                pasta_de_videos: Some(tmp.path().join("Videos")),
                ..Config::default()
            },
            |_| {},
        );
        Self { _tmp: tmp, nucleo }
    }

    fn video(&self, nome: &str) -> String {
        let caminho = self._tmp.path().join(nome);
        fs::write(&caminho, b"video de mentira").unwrap();
        caminho.display().to_string()
    }
}

fn gravar_custos(pasta: &str, linhas: &[Value]) {
    let edit = Path::new(pasta).join("edit");
    fs::create_dir_all(&edit).unwrap();
    fs::write(edit.join("custos.json"), json!(linhas).to_string()).unwrap();
}

fn gravar_roteiro(pasta: &str, produzir: usize, reservas: usize) {
    let corte = |id: usize, status: &str| json!({"id": format!("c{id:02}"), "status": status, "trechos": [[0.0, 10.0]]});
    let cortes: Vec<Value> = (0..produzir)
        .map(|i| corte(i, "produzir"))
        .chain((0..reservas).map(|i| corte(produzir + i, "reserva")))
        .collect();
    let roteiro = json!({"versao": 1, "cortes": cortes});
    fs::write(
        Path::new(pasta).join("edit/roteiro.json"),
        roteiro.to_string(),
    )
    .unwrap();
}

#[test]
fn o_projeto_soma_as_sessoes_numera_as_etapas_e_rateia_pelos_reels_sem_as_reservas() {
    let cenario = Cenario::novo();
    let projeto = cenario
        .nucleo
        .criar_lote(&[cenario.video("um.mp4")], &Default::default())
        .unwrap()
        .remove(0);
    gravar_custos(
        &projeto.pasta,
        &[
            linha("roteiro", 1.0, Some(1.2), false, 100),
            linha("revisao", 0.5, Some(0.6), false, 10),
            linha("revisao", 0.25, None, true, 5),
        ],
    );
    gravar_roteiro(&projeto.pasta, 3, 2);

    let dados = cenario.nucleo.dados_do_projeto(&projeto.id).unwrap();

    let custo = dados.custo;
    let etapas: Vec<(Etapa, u32)> = custo.sessoes.iter().map(|s| (s.etapa, s.ordem)).collect();
    assert_eq!(
        etapas,
        [
            (Etapa::Roteiro, 1),
            (Etapa::Revisao, 1),
            (Etapa::Revisao, 2)
        ]
    );
    // Vale o preço do app; sem ele, o do Claude Code.
    let valores: Vec<f64> = custo.sessoes.iter().map(|s| s.custo_usd).collect();
    assert_eq!(valores, [1.2, 0.6, 0.25]);
    assert!((custo.custo_usd - 2.05).abs() < 1e-9);
    assert_eq!(custo.tokens.entrada, 115);
    assert_eq!(custo.tokens.saida, 60);
    assert_eq!(custo.tokens.cache_leitura, 900);
    assert_eq!(custo.tokens.cache_criacao, 120);
    assert!((custo.duracao_s - 7.5).abs() < 1e-9);
    assert!(custo.preco_a_conferir);
    assert_eq!(custo.sessoes[0].modelos, ["claude-opus-5-5"]);
    assert_eq!(custo.reels, 3);
    assert!((custo.por_reel_usd.unwrap() - 2.05 / 3.0).abs() < 1e-9);
}

#[test]
fn projeto_sem_sessoes_ou_sem_reels_nao_tem_rateio() {
    let cenario = Cenario::novo();
    let projeto = cenario
        .nucleo
        .criar_lote(&[cenario.video("um.mp4")], &Default::default())
        .unwrap()
        .remove(0);

    let custo = cenario.nucleo.dados_do_projeto(&projeto.id).unwrap().custo;

    assert!(custo.sessoes.is_empty());
    assert_eq!(custo.custo_usd, 0.0);
    assert_eq!(custo.por_reel_usd, None);
}

#[test]
fn o_lote_soma_os_projetos_inclusive_o_custo_de_depois_da_geracao() {
    let cenario = Cenario::novo();
    let projetos = cenario
        .nucleo
        .criar_lote(
            &[cenario.video("um.mp4"), cenario.video("dois.mp4")],
            &Default::default(),
        )
        .unwrap();
    gravar_custos(
        &projetos[0].pasta,
        &[linha("roteiro", 1.0, Some(1.0), false, 10)],
    );
    gravar_roteiro(&projetos[0].pasta, 2, 1);
    gravar_custos(
        &projetos[1].pasta,
        &[linha("roteiro", 2.0, Some(2.0), false, 10)],
    );
    gravar_roteiro(&projetos[1].pasta, 1, 0);

    let lote = cenario.nucleo.lotes().remove(0);

    assert!((lote.custo.custo_usd - 3.0).abs() < 1e-9);
    assert_eq!(lote.custo.reels, 3);
    assert!((lote.custo.por_reel_usd.unwrap() - 1.0).abs() < 1e-9);
    assert!(lote.custo.sessoes.is_empty());
    assert!(!lote.custo.preco_a_conferir);
    assert!((lote.projetos[0].custo.custo_usd - 1.0).abs() < 1e-9);

    // Um ajuste posterior no primeiro projeto entra no lote de origem.
    gravar_custos(
        &projetos[0].pasta,
        &[
            linha("roteiro", 1.0, Some(1.0), false, 10),
            linha("revisao", 0.5, Some(0.5), false, 10),
        ],
    );
    let lote = cenario.nucleo.lotes().remove(0);
    assert!((lote.custo.custo_usd - 3.5).abs() < 1e-9);
}
