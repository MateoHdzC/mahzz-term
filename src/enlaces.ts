import { invoke } from "@tauri-apps/api/core";
import { avisar } from "./dialogos";
import { t } from "./i18n";

const PATRON =
  /https?:\/\/[^\s<>"'`)\]]+|(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?[\w.-]+(?:[\\/][\w.-]+)+(?::\d+)*|\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/g;

function esHash(texto: string): boolean {
  return /^[0-9a-f]{7,40}$/.test(texto);
}

export function decorarEnlaces(raiz: HTMLElement, soloWeb: boolean): void {
  const recorrido = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  const nodos: Text[] = [];
  while (recorrido.nextNode()) nodos.push(recorrido.currentNode as Text);

  for (const nodo of nodos) {
    const texto = nodo.data;
    const coincidencias = [...texto.matchAll(PATRON)].filter(
      (coincidencia) => !soloWeb || /^https?:/.test(coincidencia[0]),
    );
    if (coincidencias.length === 0) continue;

    const fragmento = document.createDocumentFragment();
    let posicion = 0;
    for (const coincidencia of coincidencias) {
      fragmento.append(texto.slice(posicion, coincidencia.index));
      const enlace = document.createElement("span");
      enlace.className = "enlace";
      enlace.textContent = coincidencia[0];
      enlace.title = t("Ctrl+clic para abrir");
      fragmento.append(enlace);
      posicion = coincidencia.index + coincidencia[0].length;
    }
    fragmento.append(texto.slice(posicion));
    nodo.replaceWith(fragmento);
  }
}

function resolverRuta(texto: string, carpeta: string | null): string {
  const sinLinea = texto.replace(/(:\d+)+$/, "").replaceAll("/", "\\");
  if (/^[A-Za-z]:\\/.test(sinLinea) || !carpeta) return sinLinea;
  return `${carpeta}\\${sinLinea.replace(/^\.\\/, "")}`;
}

export async function abrirEnlace(
  texto: string,
  carpeta: string | null,
  alVerCommit: (comando: string) => void,
): Promise<void> {
  if (esHash(texto)) {
    alVerCommit(`git show ${texto}`);
    return;
  }
  const destino = /^https?:/.test(texto) ? texto : resolverRuta(texto, carpeta);
  try {
    await invoke("abrir_externo", { destino });
  } catch {
    avisar(t("No se pudo abrir: {0}", texto));
  }
}
