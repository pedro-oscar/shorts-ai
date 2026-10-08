//! A Conta pela interface pública do núcleo, contra um `claude` falso (um script de shell).
//! O estado do login do falso mora no `CLAUDE_CONFIG_DIR`, como no Claude Code de verdade.
#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use nucleo::{Cobranca, Config, Erro, EstadoDaConta, Nucleo};

const FAKE_CLAUDE: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
echo "$CLAUDE_CONFIG_DIR" >> "$dir/config-dirs.log"
if [ "$1" = "--version" ]; then
  echo "$(cat "$dir/version") (Claude Code)"
elif [ "$1 $2" = "auth status" ]; then
  if [ -f "$CLAUDE_CONFIG_DIR/status.json" ]; then cat "$CLAUDE_CONFIG_DIR/status.json"
  else echo '{"loggedIn":false,"authMethod":"none"}'; exit 1; fi
elif [ "$1 $2" = "auth login" ]; then
  echo "$3" > "$dir/login-args"
  [ -f "$dir/login-fails" ] && exit 1
  mkdir -p "$CLAUDE_CONFIG_DIR"
  cp "$dir/after-login.json" "$CLAUDE_CONFIG_DIR/status.json"
elif [ "$1" = "-p" ]; then
  echo "$2" > "$dir/ask"
  [ -f "$dir/ask-fails" ] && { echo "credit balance is too low" >&2; exit 1; }
  echo '{"type":"result","is_error":false,"result":"OK"}'
fi
"#;

const SUBSCRIPTION: &str = r#"{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max","email":"ana@example.com"}"#;
const CONSOLE: &str = r#"{"loggedIn":true,"authMethod":"console","email":"ana@example.com"}"#;

struct Cenario {
    dados: tempfile::TempDir,
    bin: tempfile::TempDir,
}

impl Cenario {
    /// Um `claude` falso na versão dada, num PATH só dele.
    fn com_claude(versao: &str) -> Self {
        let cenario = Self::sem_claude();
        let claude = cenario.bin.path().join("claude");
        fs::write(&claude, FAKE_CLAUDE).unwrap();
        fs::set_permissions(&claude, fs::Permissions::from_mode(0o755)).unwrap();
        cenario.escrever("version", versao);
        cenario.escrever("after-login.json", SUBSCRIPTION);
        cenario
    }

    fn sem_claude() -> Self {
        Self {
            dados: tempfile::tempdir().unwrap(),
            bin: tempfile::tempdir().unwrap(),
        }
    }

    fn escrever(&self, nome: &str, conteudo: &str) {
        fs::write(self.bin.path().join(nome), conteudo).unwrap();
    }

    fn config_dir(&self) -> PathBuf {
        self.dados.path().join("claude")
    }

    fn logar_com(&self, status: &str) {
        fs::create_dir_all(self.config_dir()).unwrap();
        fs::write(self.config_dir().join("status.json"), status).unwrap();
    }

    fn nucleo_com_path(&self, path: &Path) -> Nucleo {
        Nucleo::new(
            Config {
                app_data_dir: self.dados.path().to_path_buf(),
                path_env: Some(path.as_os_str().to_owned()),
                ..Config::default()
            },
            |_| {},
        )
    }

    fn nucleo(&self) -> Nucleo {
        self.nucleo_com_path(self.bin.path())
    }

    fn lido(&self, nome: &str) -> String {
        fs::read_to_string(self.bin.path().join(nome)).unwrap()
    }
}

#[test]
fn sem_claude_code_a_conta_nao_esta_instalada() {
    let cenario = Cenario::sem_claude();

    assert_eq!(
        cenario.nucleo().verificar_conta(),
        EstadoDaConta::NaoInstalado
    );
}

#[test]
fn versao_abaixo_da_minima_trava_com_a_versao_encontrada() {
    for versao in ["2.1.291", "2.0.999", "1.9.9"] {
        let cenario = Cenario::com_claude(versao);
        cenario.logar_com(SUBSCRIPTION);

        assert_eq!(
            cenario.nucleo().verificar_conta(),
            EstadoDaConta::VersaoAntiga {
                versao: versao.to_owned(),
                minima: "2.1.292".to_owned()
            },
            "{versao}"
        );
    }
}

#[test]
fn a_versao_minima_e_as_novas_passam() {
    for versao in ["2.1.292", "2.2.0", "3.0.0", "2.1.1000"] {
        let cenario = Cenario::com_claude(versao);

        assert!(
            matches!(
                cenario.nucleo().verificar_conta(),
                EstadoDaConta::SemLogin { .. }
            ),
            "{versao}"
        );
    }
}

#[test]
fn sem_login_a_conta_traz_a_versao() {
    let cenario = Cenario::com_claude("2.1.300");

    assert_eq!(
        cenario.nucleo().verificar_conta(),
        EstadoDaConta::SemLogin {
            versao: "2.1.300".to_owned()
        }
    );
}

#[test]
fn logado_por_assinatura_mostra_conta_e_plano() {
    let cenario = Cenario::com_claude("2.1.300");
    cenario.logar_com(SUBSCRIPTION);

    assert_eq!(
        cenario.nucleo().verificar_conta(),
        EstadoDaConta::Logado {
            versao: "2.1.300".to_owned(),
            metodo: "claude.ai".to_owned(),
            plano: Some("max".to_owned()),
            email: Some("ana@example.com".to_owned()),
            cobranca: Cobranca::Assinatura,
        }
    );
}

#[test]
fn logado_pelo_console_ou_enterprise_conta_como_preco_de_api() {
    let casos = [
        CONSOLE,
        r#"{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"enterprise"}"#,
    ];
    for status in casos {
        let cenario = Cenario::com_claude("2.1.300");
        cenario.logar_com(status);

        let estado = cenario.nucleo().verificar_conta();

        assert!(
            matches!(
                estado,
                EstadoDaConta::Logado {
                    cobranca: Cobranca::PorUso,
                    ..
                }
            ),
            "{status}: {estado:?}"
        );
    }
}

#[test]
fn todo_claude_roda_com_a_pasta_de_configuracao_do_app() {
    let cenario = Cenario::com_claude("2.1.300");
    cenario.logar_com(SUBSCRIPTION);
    let nucleo = cenario.nucleo();

    nucleo.verificar_conta();
    nucleo.testar_claude().unwrap();

    let esperada = cenario.config_dir().display().to_string();
    let usadas = cenario.lido("config-dirs.log");
    assert!(usadas.lines().count() >= 3);
    assert!(usadas.lines().all(|linha| linha == esperada), "{usadas}");
}

#[test]
fn o_claude_e_achado_nos_locais_de_instalacao_conhecidos() {
    let cenario = Cenario::com_claude("2.1.300");
    let casa = tempfile::tempdir().unwrap();
    let local_bin = casa.path().join(".local").join("bin");
    fs::create_dir_all(&local_bin).unwrap();
    fs::rename(cenario.bin.path().join("claude"), local_bin.join("claude")).unwrap();
    // O falso procura os arquivos de apoio ao lado dele.
    for nome in ["version", "after-login.json"] {
        fs::copy(cenario.bin.path().join(nome), local_bin.join(nome)).unwrap();
    }
    let nucleo = Nucleo::new(
        Config {
            app_data_dir: cenario.dados.path().to_path_buf(),
            path_env: Some("/nao/existe".into()),
            home_dir: Some(casa.path().to_path_buf()),
            ..Config::default()
        },
        |_| {},
    );

    assert!(matches!(
        nucleo.verificar_conta(),
        EstadoDaConta::SemLogin { .. }
    ));
}

#[test]
fn entrar_roda_o_login_da_assinatura_e_devolve_a_conta_logada() {
    let cenario = Cenario::com_claude("2.1.300");
    let nucleo = cenario.nucleo();

    let estado = nucleo.entrar_no_claude_code().unwrap();

    assert!(matches!(estado, EstadoDaConta::Logado { .. }), "{estado:?}");
    assert_eq!(cenario.lido("login-args").trim(), "--claudeai");
    assert_eq!(nucleo.verificar_conta(), estado);
}

#[test]
fn entrar_que_termina_sem_login_e_erro() {
    let cenario = Cenario::com_claude("2.1.300");
    cenario.escrever("login-fails", "");

    let erro = cenario.nucleo().entrar_no_claude_code().unwrap_err();

    assert!(matches!(erro, Erro::LoginNaoConcluido { .. }), "{erro:?}");
}

#[test]
fn entrar_nao_abre_login_sem_claude_code_ou_com_versao_antiga() {
    let sem = Cenario::sem_claude();
    assert_eq!(
        sem.nucleo().entrar_no_claude_code().unwrap(),
        EstadoDaConta::NaoInstalado
    );

    let antigo = Cenario::com_claude("2.0.0");
    assert!(matches!(
        antigo.nucleo().entrar_no_claude_code().unwrap(),
        EstadoDaConta::VersaoAntiga { .. }
    ));
    assert!(!antigo.bin.path().join("login-args").exists());
}

#[test]
fn o_teste_pergunta_ok_ao_claude() {
    let cenario = Cenario::com_claude("2.1.300");
    cenario.logar_com(SUBSCRIPTION);

    cenario.nucleo().testar_claude().unwrap();

    assert_eq!(cenario.lido("ask").trim(), "Responda só: OK");
}

#[test]
fn o_teste_que_falha_traz_o_motivo() {
    let cenario = Cenario::com_claude("2.1.300");
    cenario.logar_com(SUBSCRIPTION);
    cenario.escrever("ask-fails", "");

    let erro = cenario.nucleo().testar_claude().unwrap_err();

    assert!(
        matches!(&erro, Erro::ClaudeNaoRespondeu { detalhe } if detalhe.contains("credit balance")),
        "{erro:?}"
    );
}
