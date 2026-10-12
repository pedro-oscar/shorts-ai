//! O custo efetivo no plano e a moeda pela interface pública do núcleo: os multiplicadores
//! padrão, o desconto da cobrança anual, o multiplicador que a pessoa edita e a cotação do R$.

use std::path::Path;

use nucleo::{Config, Erro, NivelDoPlano, Nucleo, PeriodoDeCobranca};

fn abrir(dados: &Path) -> Nucleo {
    Nucleo::new(
        Config {
            app_data_dir: dados.to_path_buf(),
            system_locale: Some("pt-BR".to_owned()),
            ..Config::default()
        },
        |_| {},
    )
}

fn perto(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-9
}

#[test]
fn o_max_mensal_usa_o_multiplicador_padrao_da_spec() {
    let tmp = tempfile::tempdir().unwrap();
    let nucleo = abrir(tmp.path());

    let plano = nucleo
        .confirmar_plano(NivelDoPlano::Max5x, PeriodoDeCobranca::Mensal)
        .unwrap();

    assert!(perto(plano.multiplicador, 3.0));
    assert!(perto(plano.multiplicador_padrao, 3.0));
    assert!(perto(plano.fator_de_custo, 1.0 / 3.0));
}

#[test]
fn a_cobranca_anual_desconta_a_mensalidade() {
    let tmp = tempfile::tempdir().unwrap();
    let nucleo = abrir(tmp.path());

    let pro = nucleo
        .confirmar_plano(NivelDoPlano::Pro, PeriodoDeCobranca::Anual)
        .unwrap();
    assert!(perto(pro.fator_de_custo, 0.85 / 2.5));

    let team = nucleo
        .confirmar_plano(NivelDoPlano::TeamPremium, PeriodoDeCobranca::Anual)
        .unwrap();
    assert!(perto(team.multiplicador, 2.5));
    assert!(perto(team.fator_de_custo, 0.8 / 2.5));

    let max = nucleo
        .confirmar_plano(NivelDoPlano::Max20x, PeriodoDeCobranca::Anual)
        .unwrap();
    assert!(perto(max.fator_de_custo, 1.0 / 5.0));
}

#[test]
fn console_e_enterprise_valem_o_preco_de_api() {
    let tmp = tempfile::tempdir().unwrap();
    let nucleo = abrir(tmp.path());

    for nivel in [NivelDoPlano::Console, NivelDoPlano::Enterprise] {
        let plano = nucleo
            .confirmar_plano(nivel, PeriodoDeCobranca::Anual)
            .unwrap();
        assert!(perto(plano.multiplicador, 1.0));
        assert!(perto(plano.fator_de_custo, 1.0));
    }
}

#[test]
fn o_multiplicador_editado_vale_agora_e_na_proxima_vez_que_o_app_abre() {
    let tmp = tempfile::tempdir().unwrap();
    let nucleo = abrir(tmp.path());
    nucleo
        .confirmar_plano(NivelDoPlano::Pro, PeriodoDeCobranca::Mensal)
        .unwrap();

    let plano = nucleo.definir_multiplicador(Some(4.0)).unwrap();

    assert!(perto(plano.multiplicador, 4.0));
    assert!(perto(plano.multiplicador_padrao, 2.5));
    assert!(perto(plano.fator_de_custo, 0.25));
    let reaberto = abrir(tmp.path()).estado_inicial().plano.unwrap();
    assert!(perto(reaberto.multiplicador, 4.0));
    assert!(perto(reaberto.fator_de_custo, 0.25));

    let padrao = nucleo.definir_multiplicador(None).unwrap();
    assert!(perto(padrao.multiplicador, 2.5));
}

#[test]
fn confirmar_outro_plano_volta_ao_multiplicador_padrao() {
    let tmp = tempfile::tempdir().unwrap();
    let nucleo = abrir(tmp.path());
    nucleo
        .confirmar_plano(NivelDoPlano::Pro, PeriodoDeCobranca::Mensal)
        .unwrap();
    nucleo.definir_multiplicador(Some(4.0)).unwrap();

    let plano = nucleo
        .confirmar_plano(NivelDoPlano::Max20x, PeriodoDeCobranca::Mensal)
        .unwrap();

    assert!(perto(plano.multiplicador, 5.0));
}

#[test]
fn multiplicador_invalido_ou_sem_assinatura_e_recusado() {
    let tmp = tempfile::tempdir().unwrap();
    let nucleo = abrir(tmp.path());
    assert!(matches!(
        nucleo.definir_multiplicador(Some(3.0)),
        Err(Erro::MultiplicadorInvalido { .. })
    ));

    nucleo
        .confirmar_plano(NivelDoPlano::Console, PeriodoDeCobranca::Mensal)
        .unwrap();
    assert!(matches!(
        nucleo.definir_multiplicador(Some(3.0)),
        Err(Erro::MultiplicadorInvalido { .. })
    ));

    nucleo
        .confirmar_plano(NivelDoPlano::Pro, PeriodoDeCobranca::Mensal)
        .unwrap();
    for ruim in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert!(matches!(
            nucleo.definir_multiplicador(Some(ruim)),
            Err(Erro::MultiplicadorInvalido { .. })
        ));
    }
}

#[test]
fn a_cotacao_digitada_fica_com_a_data_e_o_arquivo_de_custos_segue_em_dolar() {
    let tmp = tempfile::tempdir().unwrap();
    let nucleo = abrir(tmp.path());
    assert!(nucleo.estado_inicial().cotacao.is_none());

    let cotacao = nucleo.definir_cotacao(Some(5.42)).unwrap().unwrap();

    assert!(perto(cotacao.valor, 5.42));
    assert_eq!(cotacao.data.len(), 10);
    let reaberto = abrir(tmp.path()).estado_inicial().cotacao.unwrap();
    assert_eq!(reaberto, cotacao);

    assert_eq!(nucleo.definir_cotacao(None).unwrap(), None);
    assert!(abrir(tmp.path()).estado_inicial().cotacao.is_none());
    assert!(matches!(
        nucleo.definir_cotacao(Some(0.0)),
        Err(Erro::CotacaoInvalida)
    ));
}
