# Claude Code com pasta de configuração própria do app

O app roda o Claude Code oficial com `CLAUDE_CONFIG_DIR` apontando para uma pasta dentro dos dados do app, e não para a configuração pessoal da pessoa. Assim os hooks, `CLAUDE.md`, plugins, memórias e ajustes pessoais dela não interferem no pipeline, e o comportamento é o mesmo em qualquer máquina. O custo é um login a mais para quem já usa o Claude Code no terminal; a tela Conta explica por quê. O app nunca lê a credencial: só consulta `claude auth status --json`.

## Consequences

- Quem usa cobrança por uso entra com a conta do Console nessa mesma pasta (`claude auth login --console`). Um `ANTHROPIC_API_KEY` no ambiente também é detectado, mas não é o caminho principal, porque um app aberto pelo menu Iniciar ou pelo Dock costuma não ver as variáveis do perfil do terminal.
- Quando o login pede um código, o terminal do sistema precisa abrir já com o `CLAUDE_CONFIG_DIR` do app; senão o login cai na configuração pessoal da pessoa.

## Considered Options

- Usar a configuração padrão da pessoa (sem login extra), confiando em `--strict-mcp-config` e na lista fechada de ferramentas. Rejeitada porque hooks e ajustes pessoais continuariam rodando dentro do pipeline.
