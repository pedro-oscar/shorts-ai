import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Regra } from "../bindings";
import { useAppStore } from "../context";

function LinhaDaRegra({ regra }: { regra: Regra }) {
  const { t } = useTranslation();
  const editar = useAppStore((store) => store.editarRegraAprendida);
  const apagar = useAppStore((store) => store.apagarRegraAprendida);
  const [texto, setTexto] = useState(regra.texto);

  return (
    <li>
      <input
        type="text"
        aria-label={t("regras.regra", { numero: regra.indice + 1 })}
        value={texto}
        onChange={(event) => {
          setTexto(event.target.value);
        }}
      />
      <button
        type="button"
        aria-label={t("regras.salvarRegra", { numero: regra.indice + 1 })}
        disabled={texto === regra.texto}
        onClick={() => void editar(regra.indice, texto)}
      >
        {t("regras.salvar")}
      </button>
      <button
        type="button"
        aria-label={t("regras.apagarRegra", { numero: regra.indice + 1 })}
        onClick={() => void apagar(regra.indice)}
      >
        {t("regras.apagar")}
      </button>
    </li>
  );
}

/** As regras que o Claude anotou, para a pessoa ler, editar e apagar. */
export function RegrasAprendidas() {
  const { t } = useTranslation();
  const regras = useAppStore((store) => store.regrasAprendidas);
  const carregar = useAppStore((store) => store.carregarRegrasAprendidas);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <>
      <h2>{t("regras.titulo")}</h2>
      <p className="muted">{t("regras.dica")}</p>
      {regras?.length === 0 && <p className="muted">{t("regras.vazio")}</p>}
      <ul className="regras">
        {regras?.map((regra) => (
          <LinhaDaRegra
            key={[regra.indice, regra.texto].join(":")}
            regra={regra}
          />
        ))}
      </ul>
    </>
  );
}
