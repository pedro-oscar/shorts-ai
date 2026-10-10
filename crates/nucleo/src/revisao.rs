//! A folha de revisão de um reel: até 12 quadros (início, fim, início de cada motion, flashes e
//! trocas de cena), em grade de 6 colunas, cada um com o tempo marcado. O Claude a abre na
//! Revisão para conferir rosto, legenda e motions sem assistir ao vídeo.

use crate::roteiro::Plano;

/// Quantos quadros cabem na folha.
pub(crate) const MAX_QUADROS: usize = 12;
/// Colunas da grade.
pub(crate) const COLUNAS: usize = 6;
/// Dois instantes mais próximos que isto são o mesmo quadro.
const DISTANCIA_MINIMA: f64 = 0.4;
/// O último quadro fica um pouco antes do fim, onde ainda há imagem.
const FOLGA_DO_FIM: f64 = 0.1;

/// Os instantes (em segundos do reel, em ordem) dos quadros da folha. O início e o fim sempre
/// entram; o resto são os começos de motion, os flashes e as trocas de cena, ralos por igual
/// quando passam do que cabe.
pub(crate) fn instantes(plano: &Plano) -> Vec<f64> {
    let fim = (plano.duracao - FOLGA_DO_FIM).max(0.0);
    let mut candidatos: Vec<f64> = plano
        .motion
        .motions
        .iter()
        .filter_map(|motion| motion["start"].as_f64().or_else(|| motion["at"].as_f64()))
        .collect();
    let mut corte = 0.0;
    for (inicio, final_) in plano
        .trechos
        .iter()
        .take(plano.trechos.len().saturating_sub(1))
    {
        corte += final_ - inicio;
        candidatos.push(corte);
    }
    candidatos.retain(|&t| t > 0.0 && t < fim);
    candidatos.sort_by(f64::total_cmp);
    let mut distintos: Vec<f64> = vec![0.0];
    for t in candidatos {
        if t - distintos[distintos.len() - 1] >= DISTANCIA_MINIMA && fim - t >= DISTANCIA_MINIMA {
            distintos.push(t);
        }
    }
    let meio = &distintos[1..];
    let vagas = MAX_QUADROS - 2;
    let mut escolhidos: Vec<f64> = if meio.len() > vagas {
        (0..vagas).map(|i| meio[i * meio.len() / vagas]).collect()
    } else {
        meio.to_vec()
    };
    escolhidos.insert(0, 0.0);
    if fim > 0.0 {
        escolhidos.push(fim);
    }
    escolhidos
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
        assert_eq!(instantes[0], 0.0);
        assert!((instantes[MAX_QUADROS - 1] - 49.9).abs() < 1e-9);
        assert!(instantes.windows(2).all(|par| par[0] < par[1]));
    }

    #[test]
    fn inclui_flashes_e_trocas_de_cena_sem_repetir_instantes_proximos() {
        let motions = vec![
            json!({"type": "flash", "at": 3.0}),
            json!({"type": "scene", "start": 3.1}),
        ];

        let instantes = instantes(&plano(10.0, motions, vec![(0.0, 6.0), (20.0, 24.0)]));

        assert_eq!(instantes, [0.0, 3.0, 6.0, 9.9]);
    }
}
