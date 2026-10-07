## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Pre-commit

Depois de clonar, rode `npm ci`: é ele que liga o hook (`.husky/pre-commit`, portões em `lint-staged.config.js`). Commit bloqueado se resolve corrigindo a causa e commitando de novo; `--no-verify` e `HUSKY=0` estão fora de questão.

### Verificação

`npm run check` é o portão de pronto: uma tarefa só termina com ele verde. `npm run check:full` soma o SAST (Semgrep) e os e2e. Além do `npm ci`, cada máquina precisa de:

- `gitleaks` 8.30+ no PATH (binário das releases de github.com/gitleaks/gitleaks); o pre-commit também usa;
- `cargo-audit`: `cargo install cargo-audit --locked`;
- para o `check:full`, Docker ou Podman; sem eles, o script instala o Semgrep com `uv`.
