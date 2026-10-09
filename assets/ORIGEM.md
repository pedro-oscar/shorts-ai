# Origem dos assets

Cópia única, feita do commit `af435f2` do repositório `pedro-oscar/claude-ai-shorts-editor` (ADR 0001), sem sincronização futura. A partir daqui os arquivos são do app e mudam só aqui.

- `remotion/`: `skill/corte-viral/template/`, o template Remotion. Cada projeto recebe uma cópia de `src/` e `public/` (ADR 0003); `package.json` e `package-lock.json` definem as dependências instaladas uma vez nos dados do app.  Única mudança: `remotion.config.ts` desliga o cache do webpack.
- `corte-viral/SKILL.md`, `corte-viral/prompts/` e `corte-viral/references/`: o `SKILL.md`, os prompts e as referências, ainda como vieram. Os prompts ainda chamam o `./ae`, que o `shorts-cli` substitui.
- `corte-viral/prompts/roteirizar.md` e `revisar.md`: adaptados ao app (ticket 10): chamam o `shorts-cli` no lugar do `./ae` e usam os marcadores `{SKILL}`, `{APRENDIZADOS}`, `{VIDEO}`, `{ROTEIRO}`, `{CORTES}`, `{IDIOMA}` e `{EXTRA}`. O `SKILL.md` ainda cita o `./ae`; o prompt manda ignorar essas partes.
