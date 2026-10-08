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
      cota: "Claude sessions count toward your plan's usage limits, along with the rest of your usage; with a Console account, they are billed at Anthropic's API prices.",
      direito: "Only process videos you have the right to use.",
      remotion:
        "Reels are rendered with Remotion, which is free for individuals, nonprofit organizations and companies with up to 3 employees. Larger companies need their own Remotion license.",
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
      "Remotion: its own license, free for individuals, nonprofit organizations and companies with up to 3 employees.",
    montserrat: "Montserrat font: SIL Open Font License 1.1.",
    voltar: "Back",
  },
  conta: {
    titulo: "Account",
    verificando: "Looking for Claude Code…",
    versaoEncontrada: "Claude Code {{versao}}",
    chip: { console: "Console" },
    naoInstalado:
      "Claude Code is not installed. Install it to continue; Shorts AI uses the official Claude Code to write the scripts.",
    versaoAntiga:
      "Claude Code {{versao}} is too old: Shorts AI needs version {{minima}} or newer. Update Claude Code to continue.",
    semLogin:
      "Claude Code is installed, but you have not signed in with your Claude account yet.",
    logado: "You signed in with the account {{conta}}.",
    entrar: "Sign in to Claude Code",
    entrando:
      "Finish signing in in your browser. Shorts AI waits for Claude Code to confirm it.",
    loginSeparado:
      "Shorts AI uses its own Claude Code configuration, isolated from your hooks, plugins and memories; that is why this sign-in is separate from the Claude Code in your terminal.",
    testando: "Testing that Claude responds…",
    testeOk: "Claude responded to the test.",
    testarDeNovo: "Test again",
    continuar: "Continue",
  },
  videos: {
    titulo: "Videos",
  },
  preferencias: {
    corrompidas:
      "The preferences file was corrupted and was saved to {{backup}}. The preferences went back to the defaults, so the terms of use are shown again.",
  },
  erros: {
    preferenciasIlegiveis:
      "Could not read the preferences at {{caminho}}. Fix or delete the file and open the app again.",
    preferenciasNaoGravadas:
      "Could not save the preferences at {{caminho}}. Check that the folder has free space and write permission, then try again.",
    loginNaoConcluido:
      "Signing in to Claude Code was not completed. Try signing in again.",
    claudeNaoRespondeu:
      "Claude did not respond to the test. Check your account and plan, then try again.",
    detalhe: "Technical details (from the system): {{detalhe}}",
  },
};
