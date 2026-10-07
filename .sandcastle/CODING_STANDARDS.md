# Padrões de código

O revisor carrega este arquivo (`review-prompt.md`). Ele não repete as regras que os portões já cobram: aponta onde elas moram e o que só a revisão pega.

## Portões

- Pronto é `npm run check` verde (`AGENTS.md`): Prettier, ESLint com zero avisos (`eslint.config.js`: tipos estritos, segurança e React), tsc estrito (`tsconfig.json`), testes, gitleaks e auditoria das dependências.
- O pre-commit roda os mesmos portões sobre o que vai no commit. Commit bloqueado se resolve corrigindo a causa, nunca pulando o hook.

## Nomes e domínio

- Termos de domínio em português, como no `GLOSSARY.md` (ADR 0004): `Projeto`, `Lote`, `Corte`, `Roteiro`, `Etapa`, `Reel`. Nada dos sinônimos que o glossário manda evitar. Código técnico (infraestrutura, utilidades, integrações) em inglês.
- Antes de mexer numa área, leia os ADRs dela em `docs/adr/`. Mudança que contraria um ADR diz isso explicitamente e por quê, em vez de passar por cima calada (`docs/agents/domain.md`).

## Testes

- Comportamento novo ou alterado vem com teste, escrito antes (o implementador segue RGR).
- O app testa nos dois seams da spec: o núcleo (`crates/nucleo`) pela interface pública dele, com `cargo test`; a interface com vitest e Testing Library, contra o núcleo falso de `interface/src/test/fakeNucleo.ts`. A casca Tauri não tem seam próprio.
- As ferramentas de `scripts/` testam com `node:test` (`npm run test:scripts`), pela linha de comando.

## Comentários

- Comentário explica o porquê ou a restrição que o código não mostra; não narra o que a linha faz. Nos arquivos do projeto, em português, como no resto do repositório.
