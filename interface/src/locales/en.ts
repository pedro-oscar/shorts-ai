import type { ptBR } from "./pt-BR";

export const en: typeof ptBR = {
  app: {
    nome: "Shorts AI",
  },
  aviso: {
    titulo: "Terms of use",
    introducao:
      "Before you start, read how Shorts AI works and what you need to respect.",
    itens: {
      pessoal:
        "Shorts AI is for personal, noncommercial use, under the PolyForm Noncommercial 1.0.0 license.",
      conta:
        "It uses your own Claude account, through the official Claude Code you sign in to. The app never sees your password, token or key.",
      direito: "Only process videos you have the right to use.",
      remotion:
        "Reels are rendered with Remotion, which is free for individuals and companies with up to 3 employees. Larger companies need their own Remotion license.",
    },
    privacidadeTitulo: "What leaves your computer",
    privacidade:
      "The video and audio stay on your computer; Claude receives the transcript text, the script and images of a few frames of the reels, used in the review.",
    concordo: "I have read and agree",
    continuar: "Continue",
    sair: "Quit",
  },
  sobre: {
    abrir: "About",
    titulo: "About Shorts AI",
    versao: "Version {{versao}}",
    aceitoEm: "You accepted the terms of use on {{data}}.",
    naoAceito: "You have not accepted the terms of use yet.",
    licencaTitulo: "License",
    licenca:
      "Shorts AI is distributed under the PolyForm Noncommercial 1.0.0 license.",
    terceirosTitulo: "Third-party licenses",
    remotion:
      "Remotion: its own license, free for individuals and companies with up to 3 employees.",
    montserrat: "Montserrat font: SIL Open Font License 1.1.",
    voltar: "Back",
  },
  conta: {
    titulo: "Account",
  },
  erros: {
    preferenciasIlegiveis:
      "Could not read the preferences at {{caminho}}. Fix or delete the file and open the app again.",
    preferenciasNaoGravadas:
      "Could not save the preferences at {{caminho}}. Check that the folder has free space and write permission, then try again.",
    detalhe: "Details: {{detalhe}}",
  },
};
