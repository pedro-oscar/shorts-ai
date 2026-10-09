Você está rodando **sem ninguém para responder** (sessão do Roteiro do Shorts AI). Não faça perguntas: decida e documente o porquê no roteiro.

O app já importou e transcreveu o vídeo. Ignore as partes do `SKILL.md` e das referências que falam de `./ae`, de transcrever, de baixar ou de produzir: isso o app faz. Suas ferramentas são `shorts-cli validar`, `shorts-cli tsc`, `shorts-cli still` e `shorts-cli cena`.

Use a skill **corte-viral**. Leia, nesta ordem:
- `{SKILL}/SKILL.md`
- `{APRENDIZADOS}/aprendizados.md` (regras do usuário, têm prioridade; se o arquivo não existir, siga sem ele)
- `{SKILL}/references/rubrica-viral.md`
- `{SKILL}/references/roteiro.md`
- `{SKILL}/references/motion-guide.md`

## Tarefa

O vídeo `{VIDEO}` já foi transcrito. O **idioma do vídeo** é `{IDIOMA}`. A transcrição compactada, uma frase por linha com o intervalo em segundos, está em `edit/transcricao-compactada.txt`. Para precisão de palavra, consulte `edit/transcricao.json` só com `grep`/`head`/`sed -n` em janelas pequenas, nunca inteiro.

1. Leia a transcrição inteira (em blocos, se for longa) e avalie de 10 a 16 candidatos com a rubrica.
2. Escreva o roteiro em `{ROTEIRO}`, no formato de `references/roteiro.md`:
   - até **{CORTES}** cortes com `"status": "produzir"` (nota ≥ 7, categorias variadas); os demais bons candidatos como `"reserva"`;
   - `"fonte": "{VIDEO}"`;
   - para cada corte: `trechos` enxutos (sem enrolação, começando no gancho), `titulo`, `enfase`, `motions` sincronizados com `word` + `at`, `gancho`, `payoff`, `porque`, `nota`, `categoria` e `descricao`, o texto do post do reel;
   - **escreva em `{IDIOMA}`** os títulos, as correções, a `descricao` e o texto de capa e dos motions;
   - duração ideal 35–60 s; **até 90 s só quando a história precisar**;
   - o **último trecho termina numa frase completa** que fecha a ideia, sem corte seco no meio de raciocínio;
   - a posição dos motions é automática e nunca cobre o rosto: escolha só tipo, conteúdo e tempo. Textos curtos (título ≤ 5 palavras, keyword ≤ 2), nada nos últimos 0,8 s. Em plano fechado, prefira keyword/counter a cards;
   - `correcoes` globais para nomes próprios e termos que o Whisper errou.
3. Se algum motion `scene` precisar de ilustração que não existe em `remotion/src/scenes/`, crie a cena:
   - padrão de `Dinheiro.tsx`, caixa 940×760, SVG em código;
   - registre em `SCENES` e coloque props de exemplo em `EXEMPLOS`, ambos no `index.ts`.
   - Se forem várias, use um sub-agente por cena, em paralelo; sub-agentes não rodam comandos, então quem valida é você.
   - Rode `shorts-cli tsc` até passar e confira cada cena nova com `shorts-cli cena <Nome> <segundos> card` (gera um PNG em `remotion/out/`; abra e olhe).
   - Não crie arquivos de pré-visualização avulsos.
4. Rode `shorts-cli validar {ROTEIRO}` e corrija até não haver erros nem avisos relevantes. **Você só termina com o roteiro válido.**

Se o pedido do usuário (abaixo) expressar uma **preferência geral**, que vale para os próximos vídeos, registre-a com data em `{APRENDIZADOS}/aprendizados.md`.

Não baixe nada, não produza nem apague arquivos e não altere nada fora de `edit/roteiro.json`, `remotion/src/scenes/` e `{APRENDIZADOS}/aprendizados.md`. A skill em `{SKILL}` é somente leitura. Rascunhos e scripts auxiliares vão em `/tmp`.
{EXTRA}
## Resposta final

Uma tabela curta: id | duração | título | nota | por quê. Depois, uma linha por cena nova criada.
