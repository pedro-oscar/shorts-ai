# Independente do CLI `./ae`

O Shorts AI não compartilha código com o CLI `claude-ai-shorts-editor` (`./ae`) e não garante que um projeto abra nos dois: o contrato do roteiro, os prompts, o layout do projeto e as tecnologias podem mudar livremente aqui. A estrutura de pastas do projeto (`bruto/`, `edit/`, `publicar/`) é mantida só por conveniência, sem garantia; migrar uma pasta entre o app e o CLI fica por conta da pessoa. Escolhemos isso porque o app muda o motor em várias frentes (pasta por projeto, kit de marca, capa, custos, Windows nativo) e manter paridade com um script bash exigiria mudanças coordenadas em dois repositórios.

## Considered Options

- Monorepo com o CLI, com o motor importado com histórico e o `./ae` mantido funcionando.
- Repositórios separados, com o motor como submódulo fixado por versão.
- Motor como pacote versionado publicado pelo CLI e baixado pelo app.
