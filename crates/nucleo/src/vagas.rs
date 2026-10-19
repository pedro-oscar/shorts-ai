//! As vagas: quantos projetos usam ao mesmo tempo cada recurso disputado (a GPU na
//! Transcrição, uma sessão do Claude e o render). Quem espera pega a vaga na ordem em que
//! entrou na fila, a espera pode ser interrompida, e a vaga do Claude fecha enquanto a cota
//! não libera.

use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use specta::Type;

/// De quanto em quanto tempo quem espera confere se desistiu (pausa ou cancelamento).
const CONFERIR: Duration = Duration::from_millis(100);

/// Um recurso disputado pelos projetos.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Recurso {
    /// A Transcrição, mesmo quando roda na CPU: dois whisper na mesma GPU dobram a memória
    /// de vídeo sem ganho.
    Gpu,
    /// Uma sessão do Claude, no Roteiro ou na Revisão.
    Claude,
    /// O trabalho local da Produção (corte, rosto e render), da Revisão e da Versão final.
    Render,
}

impl Recurso {
    fn indice(self) -> usize {
        match self {
            Self::Gpu => 0,
            Self::Claude => 1,
            Self::Render => 2,
        }
    }
}

/// Como um projeto está em relação a uma vaga.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum EstadoDaVaga {
    /// Quer a vaga e espera ela abrir.
    Esperando,
    Usando,
    /// Soltou a vaga, ou desistiu de esperar.
    Livre,
}

/// Avisa quem acompanha as vagas: o projeto, o recurso e o estado.
pub(crate) type AvisarVaga = Arc<dyn Fn(&str, Recurso, EstadoDaVaga) + Send + Sync>;

/// Por que a vaga não veio.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Recusa {
    /// Quem esperava desistiu: `parar` ficou verdadeiro.
    Parou,
    /// A vaga está fechada até o instante: a cota do Claude acabou.
    Fechada(Instant),
}

struct Estado {
    capacidade: [usize; 3],
    ocupadas: [usize; 3],
    /// Quem espera cada recurso, com a ordem de entrada na fila.
    esperando: Vec<(Recurso, u64)>,
    fechada_ate: [Option<Instant>; 3],
}

struct Compartilhado {
    estado: Mutex<Estado>,
    mudou: Condvar,
    avisar: AvisarVaga,
}

#[derive(Clone)]
pub(crate) struct Vagas(Arc<Compartilhado>);

/// Uma vaga em uso; ela é solta quando a posse sai de escopo.
pub(crate) struct Posse {
    vagas: Vagas,
    recurso: Recurso,
    projeto: String,
    /// A vaga não estava livre quando o projeto a pediu.
    pub esperou: bool,
}

impl Drop for Posse {
    fn drop(&mut self) {
        let mut estado = self.vagas.travar();
        estado.ocupadas[self.recurso.indice()] -= 1;
        drop(estado);
        self.vagas.0.mudou.notify_all();
        (self.vagas.0.avisar)(&self.projeto, self.recurso, EstadoDaVaga::Livre);
    }
}

impl Vagas {
    /// Uma vaga de cada recurso, todas abertas.
    pub fn new(avisar: AvisarVaga) -> Self {
        Self(Arc::new(Compartilhado {
            estado: Mutex::new(Estado {
                capacidade: [1; 3],
                ocupadas: [0; 3],
                esperando: Vec::new(),
                fechada_ate: [None; 3],
            }),
            mudou: Condvar::new(),
            avisar,
        }))
    }

    fn travar(&self) -> MutexGuard<'_, Estado> {
        self.0.estado.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Muda quantos projetos usam o recurso ao mesmo tempo. Quem já usa continua; abaixo da
    /// capacidade nova, quem espera só pega a vaga quando sobrar uma.
    pub fn definir_capacidade(&self, recurso: Recurso, capacidade: usize) {
        self.travar().capacidade[recurso.indice()] = capacidade.max(1);
        self.0.mudou.notify_all();
    }

    /// Espera a vaga do recurso para o `projeto`, que entrou na fila na posição `ordem`: quem
    /// entrou antes pega a vaga que abre. Desiste quando `parar` fica verdadeiro, e não espera
    /// a vaga fechada.
    pub fn pegar(
        &self,
        recurso: Recurso,
        projeto: &str,
        ordem: u64,
        parar: &dyn Fn() -> bool,
    ) -> Result<Posse, Recusa> {
        let indice = recurso.indice();
        let mut estado = self.travar();
        estado.esperando.push((recurso, ordem));
        let mut esperou = false;
        let recusa = loop {
            if let Some(ate) = estado.fechada_ate[indice].filter(|ate| *ate > Instant::now()) {
                break Recusa::Fechada(ate);
            }
            let primeiro = estado
                .esperando
                .iter()
                .filter(|(quem, _)| *quem == recurso)
                .map(|(_, ordem)| *ordem)
                .min()
                == Some(ordem);
            if primeiro && estado.ocupadas[indice] < estado.capacidade[indice] {
                sair_da_espera(&mut estado, recurso, ordem);
                estado.ocupadas[indice] += 1;
                drop(estado);
                self.0.mudou.notify_all();
                (self.0.avisar)(projeto, recurso, EstadoDaVaga::Usando);
                return Ok(Posse {
                    vagas: self.clone(),
                    recurso,
                    projeto: projeto.to_owned(),
                    esperou,
                });
            }
            if parar() {
                break Recusa::Parou;
            }
            if !esperou {
                esperou = true;
                drop(estado);
                (self.0.avisar)(projeto, recurso, EstadoDaVaga::Esperando);
                estado = self.travar();
                continue;
            }
            estado = self
                .0
                .mudou
                .wait_timeout(estado, CONFERIR)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        };
        sair_da_espera(&mut estado, recurso, ordem);
        drop(estado);
        // Quem vinha atrás pode ter virado o primeiro.
        self.0.mudou.notify_all();
        if esperou {
            (self.0.avisar)(projeto, recurso, EstadoDaVaga::Livre);
        }
        Err(recusa)
    }

    /// Fecha a vaga do recurso até `ate`: quem pede ou espera recebe [`Recusa::Fechada`].
    /// Devolve se ela estava aberta, isto é, se o fechamento é novo.
    pub fn fechar_ate(&self, recurso: Recurso, ate: Instant) -> bool {
        let mut estado = self.travar();
        let fechada = &mut estado.fechada_ate[recurso.indice()];
        let nova = fechada.is_none_or(|antes| antes <= Instant::now());
        if fechada.is_none_or(|antes| antes < ate) {
            *fechada = Some(ate);
        }
        drop(estado);
        self.0.mudou.notify_all();
        nova
    }

    /// Abre a vaga fechada antes da hora: a pessoa pediu para tentar agora.
    pub fn reabrir(&self, recurso: Recurso) {
        self.travar().fechada_ate[recurso.indice()] = None;
        self.0.mudou.notify_all();
    }
}

fn sair_da_espera(estado: &mut Estado, recurso: Recurso, ordem: u64) {
    estado
        .esperando
        .retain(|&(quem, posicao)| !(quem == recurso && posicao == ordem));
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::thread;

    use super::*;

    /// Os avisos das vagas, na ordem em que vieram.
    type Avisos = Arc<Mutex<Vec<(String, Recurso, EstadoDaVaga)>>>;

    fn vagas() -> (Vagas, Avisos) {
        let avisos = Arc::new(Mutex::new(Vec::new()));
        let anotar = Arc::clone(&avisos);
        let vagas = Vagas::new(Arc::new(move |projeto: &str, recurso, estado| {
            anotar
                .lock()
                .unwrap()
                .push((projeto.to_owned(), recurso, estado));
        }));
        (vagas, avisos)
    }

    fn nunca() -> bool {
        false
    }

    /// Espera até `condicao` valer, ou falha depois de alguns segundos.
    fn ate(condicao: impl Fn() -> bool) {
        let limite = Instant::now() + Duration::from_secs(5);
        while !condicao() {
            assert!(Instant::now() < limite, "a condição não chegou a valer");
            thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn a_vaga_livre_vem_na_hora_e_volta_quando_a_posse_cai() {
        let (vagas, avisos) = vagas();

        let posse = vagas.pegar(Recurso::Render, "a", 0, &nunca).unwrap();
        assert!(!posse.esperou);
        drop(posse);

        assert_eq!(
            *avisos.lock().unwrap(),
            [
                ("a".to_owned(), Recurso::Render, EstadoDaVaga::Usando),
                ("a".to_owned(), Recurso::Render, EstadoDaVaga::Livre),
            ]
        );
        assert!(vagas.pegar(Recurso::Render, "b", 1, &nunca).is_ok());
    }

    #[test]
    fn com_a_vaga_ocupada_quem_pede_espera_ela_abrir() {
        let (vagas, avisos) = vagas();
        let posse = vagas.pegar(Recurso::Gpu, "a", 0, &nunca).unwrap();

        let outra = vagas.clone();
        let espera =
            thread::spawn(move || outra.pegar(Recurso::Gpu, "b", 1, &nunca).map(|p| p.esperou));
        ate(|| {
            avisos.lock().unwrap().contains(&(
                "b".to_owned(),
                Recurso::Gpu,
                EstadoDaVaga::Esperando,
            ))
        });
        drop(posse);

        assert_eq!(espera.join().unwrap(), Ok(true));
    }

    #[test]
    fn recursos_diferentes_nao_se_esperam() {
        let (vagas, _) = vagas();
        let _gpu = vagas.pegar(Recurso::Gpu, "a", 0, &nunca).unwrap();

        assert!(vagas.pegar(Recurso::Claude, "b", 1, &nunca).is_ok());
    }

    #[test]
    fn a_capacidade_deixa_mais_de_um_usar_o_recurso() {
        let (vagas, _) = vagas();
        vagas.definir_capacidade(Recurso::Claude, 2);

        let _a = vagas.pegar(Recurso::Claude, "a", 0, &nunca).unwrap();
        let _b = vagas.pegar(Recurso::Claude, "b", 1, &nunca).unwrap();

        let parar = || true;
        assert_eq!(
            vagas.pegar(Recurso::Claude, "c", 2, &parar).err(),
            Some(Recusa::Parou)
        );
    }

    #[test]
    fn quem_entrou_antes_na_fila_pega_a_vaga_que_abre() {
        let (vagas, avisos) = vagas();
        let posse = vagas.pegar(Recurso::Render, "a", 0, &nunca).unwrap();
        let ordem_de_chegada = Arc::new(Mutex::new(Vec::new()));
        // O de ordem 5 pede primeiro; o de ordem 2 entrou antes na fila e pede depois.
        let mut esperas = Vec::new();
        for (projeto, ordem) in [("tarde", 5), ("cedo", 2)] {
            let vagas = vagas.clone();
            let chegada = Arc::clone(&ordem_de_chegada);
            esperas.push(thread::spawn(move || {
                let posse = vagas
                    .pegar(Recurso::Render, projeto, ordem, &nunca)
                    .unwrap();
                chegada.lock().unwrap().push(projeto);
                drop(posse);
            }));
            ate(|| {
                avisos.lock().unwrap().contains(&(
                    projeto.to_owned(),
                    Recurso::Render,
                    EstadoDaVaga::Esperando,
                ))
            });
        }

        drop(posse);
        for espera in esperas {
            espera.join().unwrap();
        }

        assert_eq!(*ordem_de_chegada.lock().unwrap(), ["cedo", "tarde"]);
    }

    #[test]
    fn quem_desiste_de_esperar_sai_sem_a_vaga_e_avisa_que_ficou_livre() {
        let (vagas, avisos) = vagas();
        let _posse = vagas.pegar(Recurso::Gpu, "a", 0, &nunca).unwrap();
        let desistir = Arc::new(AtomicBool::new(false));

        let outra = vagas.clone();
        let flag = Arc::clone(&desistir);
        let espera = thread::spawn(move || {
            outra
                .pegar(Recurso::Gpu, "b", 1, &|| flag.load(Ordering::SeqCst))
                .err()
        });
        ate(|| avisos.lock().unwrap().len() == 2);
        desistir.store(true, Ordering::SeqCst);

        assert_eq!(espera.join().unwrap(), Some(Recusa::Parou));
        assert_eq!(
            avisos.lock().unwrap().last(),
            Some(&("b".to_owned(), Recurso::Gpu, EstadoDaVaga::Livre))
        );
    }

    #[test]
    fn quem_desiste_nao_tranca_quem_vem_atras() {
        let (vagas, _) = vagas();
        let posse = vagas.pegar(Recurso::Render, "a", 0, &nunca).unwrap();
        let parar = || true;
        assert!(vagas.pegar(Recurso::Render, "b", 1, &parar).is_err());
        drop(posse);

        assert!(vagas.pegar(Recurso::Render, "c", 2, &nunca).is_ok());
    }

    #[test]
    fn a_vaga_fechada_recusa_na_hora_ate_reabrir() {
        let (vagas, _) = vagas();
        let ate_la = Instant::now() + Duration::from_secs(60);

        assert!(vagas.fechar_ate(Recurso::Claude, ate_la));
        assert!(!vagas.fechar_ate(Recurso::Claude, ate_la));
        assert_eq!(
            vagas.pegar(Recurso::Claude, "a", 0, &nunca).err(),
            Some(Recusa::Fechada(ate_la))
        );
        assert!(vagas.pegar(Recurso::Gpu, "a", 0, &nunca).is_ok());

        vagas.reabrir(Recurso::Claude);
        assert!(vagas.pegar(Recurso::Claude, "a", 0, &nunca).is_ok());
    }

    #[test]
    fn fechar_acorda_quem_esperava() {
        let (vagas, avisos) = vagas();
        let _posse = vagas.pegar(Recurso::Claude, "a", 0, &nunca).unwrap();
        let outra = vagas.clone();
        let espera = thread::spawn(move || outra.pegar(Recurso::Claude, "b", 1, &nunca).err());
        ate(|| avisos.lock().unwrap().len() == 2);

        let ate_la = Instant::now() + Duration::from_secs(60);
        vagas.fechar_ate(Recurso::Claude, ate_la);

        assert_eq!(espera.join().unwrap(), Some(Recusa::Fechada(ate_la)));
    }

    #[test]
    fn a_vaga_fechada_abre_sozinha_quando_a_hora_passa() {
        let (vagas, _) = vagas();
        vagas.fechar_ate(Recurso::Claude, Instant::now());

        assert!(vagas.pegar(Recurso::Claude, "a", 0, &nunca).is_ok());
        assert!(vagas.fechar_ate(Recurso::Claude, Instant::now() + Duration::from_secs(60)));
    }
}
