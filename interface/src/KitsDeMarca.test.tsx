import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "./App";
import {
  ACCEPTED_AT,
  createFakeNucleo,
  planoCompleto,
} from "./test/fakeNucleo";

/** Abre os Kits de marca pelas Configurações. */
async function abrirKits() {
  const fake = createFakeNucleo({
    aceite: { data: ACCEPTED_AT },
    plano: planoCompleto({
      nivel: "max5x",
      periodo: "mensal",
      precoDeApi: false,
    }),
  });
  render(<App nucleo={fake.nucleo} />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Configurações" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Abrir os kits de marca" }),
  );
  await screen.findByRole("heading", { name: "Kits de marca" });
  return { ...fake, user };
}

test("o Padrão abre com as cores e as fontes dele e a Amostra", async () => {
  await abrirKits();

  expect(await screen.findByLabelText("Fonte da legenda")).toHaveValue(
    "Montserrat",
  );
  expect(screen.getByLabelText("Cor de destaque")).toHaveValue("#ff2d2d");
  expect(screen.getByLabelText("Cor da palavra falada")).toHaveValue("#ffe600");
  expect(screen.getByLabelText("Fonte dos títulos").children).toHaveLength(8);
  expect(screen.getByTestId("amostra-do-kit")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /^Padrão/, pressed: true }),
  ).toBeVisible();
});

test("a Amostra acompanha as fontes escolhidas", async () => {
  const { user } = await abrirKits();

  await user.selectOptions(
    await screen.findByLabelText("Fonte dos títulos"),
    "Anton",
  );

  expect(screen.getByText("O erro que quebra empresas")).toHaveStyle({
    fontFamily: '"Anton", sans-serif',
  });
  expect(screen.getByText(/Ninguém te/)).toHaveStyle({
    fontFamily: '"Montserrat", sans-serif',
  });
});

test("o kit só vale depois de salvo com nome, entra na lista e o lote pode usá-lo", async () => {
  const { user, calls, pick } = await abrirKits();
  await user.selectOptions(
    await screen.findByLabelText("Fonte da legenda"),
    "Bebas Neue",
  );
  const salvar = screen.getByRole("button", { name: "Salvar como kit" });
  expect(salvar).toBeDisabled();

  await user.type(screen.getByLabelText("Nome do kit"), "Canal");
  await user.click(salvar);

  expect(calls.kitsSalvos).toEqual([
    {
      nome: "Canal",
      corDeDestaque: "#FF2D2D",
      corDaPalavra: "#FFE600",
      fonteDaLegenda: "Bebas Neue",
      fonteDosTitulos: "Montserrat",
      logo: null,
    },
  ]);
  expect(
    await screen.findByRole("button", { name: "Canal", pressed: true }),
  ).toBeVisible();

  // De volta à folha de Vídeos, o kit novo já é o do lote.
  await user.click(screen.getByRole("button", { name: "Voltar" }));
  await screen.findByRole("heading", { name: "Configurações" });
  await user.click(screen.getByRole("button", { name: "Voltar" }));
  await screen.findByRole("heading", { name: "Vídeos" });
  pick(["/v/aula.mp4"]);
  await user.click(screen.getByRole("button", { name: "Escolher arquivos" }));
  await screen.findByRole("list", { name: "Vídeos escolhidos" });
  expect(
    screen.getByRole("list", { name: "Padrões do lote" }),
  ).toHaveTextContent("Kit Canal");
  await user.click(
    screen.getByRole("button", { name: "Gerar até 6 reels de 1 vídeo" }),
  );
  await screen.findByRole("heading", { name: "Linha de produção" });
  expect(calls.padroes[0]?.kit).toBe("Canal");
});

test("o kit Padrão não tem como apagar, e apagar outro volta ao Padrão", async () => {
  const { user, calls } = await abrirKits();
  await screen.findByLabelText("Fonte da legenda");
  expect(
    screen.queryByRole("button", { name: /Apagar o kit/ }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Nome do kit"), "Canal");
  await user.click(screen.getByRole("button", { name: "Salvar como kit" }));

  await user.click(
    await screen.findByRole("button", { name: "Apagar o kit Canal" }),
  );

  expect(calls.kitsApagados).toEqual(["Canal"]);
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: /^Padrão/, pressed: true }),
    ).toBeVisible();
  });
  expect(screen.queryByRole("button", { name: "Canal" })).toBeNull();
});

test("a logo escolhida aparece na Amostra e entra no kit salvo", async () => {
  const fake = await abrirKits();
  const { user, calls } = fake;
  fake.escolherLogo("/m/logo.png");

  await user.click(
    await screen.findByRole("button", { name: "Escolher logo" }),
  );
  await user.selectOptions(
    screen.getByLabelText("Posição da logo"),
    "inferiorEsquerdo",
  );
  await user.selectOptions(
    screen.getByLabelText("Quando a logo aparece"),
    "fim",
  );

  const logo = await screen.findByTestId("logo-da-amostra");
  expect(logo).toHaveStyle({ bottom: "8%", left: "6%", width: "14%" });
  expect(logo).toHaveStyle({ opacity: "0.8" });
  expect(screen.getByLabelText("Largura da logo (14%)")).toHaveValue("14");
  expect(screen.getByLabelText("Opacidade da logo (80%)")).toHaveValue("80");
  expect(screen.queryByRole("alert")).toBeNull();
  await user.type(screen.getByLabelText("Nome do kit"), "Canal");
  await user.click(screen.getByRole("button", { name: "Salvar como kit" }));
  expect(calls.kitsSalvos[0]?.logo).toEqual({
    arquivo: "/m/logo.png",
    posicao: "inferiorEsquerdo",
    largura: 14,
    opacidade: 80,
    quando: "fim",
    proporcao: 1,
  });
});

test("um PNG sem transparência recebe um aviso claro", async () => {
  const fake = await abrirKits();
  fake.escolherLogo("/m/logo.png", {
    comTransparencia: false,
    proporcao: 1,
    previa: "data:image/png;base64,AAAA",
  });

  await fake.user.click(
    await screen.findByRole("button", { name: "Escolher logo" }),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Este PNG não tem transparência",
  );
});

test("cancelar o seletor ou tirar a logo deixa o kit sem logo", async () => {
  const fake = await abrirKits();
  const { user } = fake;
  const escolher = await screen.findByRole("button", { name: "Escolher logo" });

  await user.click(escolher);
  expect(screen.queryByTestId("logo-da-amostra")).toBeNull();
  fake.escolherLogo("/m/logo.png");
  await user.click(escolher);
  await screen.findByTestId("logo-da-amostra");
  await user.click(screen.getByRole("button", { name: "Tirar logo" }));

  expect(screen.queryByTestId("logo-da-amostra")).toBeNull();
  expect(screen.queryByLabelText("Posição da logo")).toBeNull();
});
