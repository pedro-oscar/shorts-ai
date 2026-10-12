//! A folha de revisão de um reel: até 12 quadros (início, fim, início de cada motion, flashes e
//! trocas de cena), em grade de 6 colunas, cada um com o tempo marcado. O Claude a abre na
//! Revisão para conferir rosto, legenda e motions sem assistir ao vídeo.

use crate::roteiro::Plano;

/// Quantos quadros cabem na folha.
pub(crate) const MAX_QUADROS: usize = 12;
/// Colunas da grade.
pub(crate) const COLUNAS: usize = 6;
/// O primeiro quadro fica depois do título entrar.
const INICIO: f64 = 0.6;
/// O último quadro fica antes do escurecimento final.
const FOLGA_DO_FIM: f64 = 1.0;
/// Num reel curtíssimo o último quadro não recua além deste instante.
const FIM_MINIMO: f64 = 0.1;
/// A entrada de uma motion leva este tempo; o quadro é tirado depois dela.
const DEPOIS_DA_ENTRADA: f64 = 0.5;
/// O flash está no auge logo depois do `at`.
const DEPOIS_DO_FLASH: f64 = 0.08;
/// A troca de cena já terminou este tempo depois da junção.
const DEPOIS_DA_JUNCAO: f64 = 0.3;

/// Os instantes (em segundos do reel, em ordem) dos quadros da folha, deslocados como no CLI para
/// cair depois da entrada de cada animação: início, fim, motions, flashes e junções de trechos,
/// ralos por igual quando passam do que cabe. Todos ficam dentro do reel.
pub(crate) fn instantes(plano: &Plano) -> Vec<f64> {
    let mut candidatos = vec![INICIO, (plano.duracao - FOLGA_DO_FIM).max(FIM_MINIMO)];
    for motion in &plano.motion.motions {
        if let Some(inicio) = motion["start"].as_f64() {
            candidatos.push(inicio + DEPOIS_DA_ENTRADA);
        }
        if motion["type"] == "flash"
            && let Some(at) = motion["at"].as_f64()
        {
            candidatos.push(at + DEPOIS_DO_FLASH);
        }
    }
    let mut corte = 0.0;
    for (inicio, final_) in plano
        .trechos
        .iter()
        .take(plano.trechos.len().saturating_sub(1))
    {
        corte += final_ - inicio;
        candidatos.push(corte + DEPOIS_DA_JUNCAO);
    }
    candidatos.retain(|&t| t < plano.duracao);
    candidatos.sort_by(f64::total_cmp);
    candidatos.dedup();
    if candidatos.len() > MAX_QUADROS {
        let n = candidatos.len();
        return (0..MAX_QUADROS)
            .map(|i| candidatos[i * (n - 1) / (MAX_QUADROS - 1)])
            .collect();
    }
    candidatos
}

#[cfg(test)]
mod tests {
    use serde_json::{Map, json};

    use super::*;
    use crate::roteiro::PlanoDeMotion;

    fn plano(duracao: f64, motions: Vec<serde_json::Value>, trechos: Vec<(f64, f64)>) -> Plano {
        Plano {
            id: "c01".into(),
            chave: "v-c01".into(),
            titulo: None,
            pins: vec![],
            trechos,
            duracao,
            legendas: vec![],
            motion: PlanoDeMotion {
                style: Map::new(),
                emphasis: vec![],
                motions,
            },
        }
    }

    #[test]
    fn nunca_passa_de_doze_quadros_e_mantem_o_inicio_e_o_fim() {
        let motions = (1..40)
            .map(|n| json!({"type": "zoom", "start": f64::from(n)}))
            .collect();

        let instantes = instantes(&plano(50.0, motions, vec![(0.0, 50.0)]));

        assert_eq!(instantes.len(), MAX_QUADROS);
        assert_eq!(instantes[0], 0.6);
        assert!((instantes[MAX_QUADROS - 1] - 49.0).abs() < 1e-9);
        assert!(instantes.windows(2).all(|par| par[0] < par[1]));
    }

    #[test]
    fn segue_os_deslocamentos_do_cli() {
        let motions = vec![
            json!({"type": "flash", "at": 3.0}),
            json!({"type": "scene", "start": 4.0}),
        ];

        let instantes = instantes(&plano(10.0, motions, vec![(0.0, 6.0), (20.0, 24.0)]));

        let esperado = [0.6, 3.08, 4.5, 6.3, 9.0];
        assert_eq!(instantes.len(), esperado.len());
        for (obtido, esperado) in instantes.iter().zip(esperado) {
            assert!((obtido - esperado).abs() < 1e-9, "{obtido} != {esperado}");
        }
    }

    #[test]
    fn descarta_o_que_passa_da_duracao_e_o_fim_nunca_fica_antes_de_um_decimo() {
        let motions = vec![json!({"type": "zoom", "start": 9.8})];

        let curto = instantes(&plano(0.5, vec![], vec![(0.0, 0.5)]));
        let longo = instantes(&plano(10.0, motions, vec![(0.0, 10.0)]));

        assert_eq!(curto, [0.1]);
        assert_eq!(longo, [0.6, 9.0]);
    }
}
