## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`, a private git repo of its own that this one ignores: a ticket change is a commit there (`git -C .scratch commit`), never here. See `docs/agents/issue-tracker.md`.

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
- para o `check:full`, Docker ou Podman; sem eles, o script instala o Semgrep com `uv`;
- a pasta de referência dos testes do núcleo (vídeo KGfmaHnBQx4 e sessões gravadas, de fora do repositório) em `~/shorts-ai-referencia`, ou onde a `SHORTS_AI_REFERENCIA` apontar; o `LEIA.md` dela diz o que é cada arquivo.

## Loop AFK

Tickets: `npm run -s tickets -- all`. Fábrica: `npm run afk` (até 10 tickets; `npm run afk -- N` para até N), sempre num branch afk/*; o merge no main é humano.
