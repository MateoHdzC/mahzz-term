import { invoke } from "@tauri-apps/api/core";
import type { ITheme } from "@xterm/xterm";
import { ajustes, type Logo } from "./ajustes";

const avisarCambio = () => window.dispatchEvent(new Event("mahzz:datos-cambiados"));

export const CLAVES_COLOR = [
  "fondo",
  "barra",
  "elevado",
  "borde",
  "texto",
  "textoSuave",
  "acento",
  "acentoClaro",
] as const;

export type ClaveColor = (typeof CLAVES_COLOR)[number];

export interface Tema {
  id: string;
  nombre: string;
  colores: Record<ClaveColor, string>;
  ansi: string[];
}

const VARIABLES: Record<ClaveColor, string> = {
  fondo: "--fondo",
  barra: "--fondo-barra",
  elevado: "--fondo-elevado",
  borde: "--borde",
  texto: "--texto",
  textoSuave: "--texto-suave",
  acento: "--acento",
  acentoClaro: "--acento-claro",
};

export const TEMA_MAHZZ: Tema = {
  id: "mahzz",
  nombre: "MahzzTerm",
  colores: {
    fondo: "#050507",
    barra: "#000000",
    elevado: "#100e16",
    borde: "#1f1a2b",
    texto: "#e4e2ec",
    textoSuave: "#9a98a8",
    acento: "#8b45ff",
    acentoClaro: "#c9a6ff",
  },
  ansi: [
    "#1a1820", "#ff6b81", "#6fdc9c", "#f4c96b", "#74a7ff", "#b98aff", "#62d6e8", "#d5d3de",
    "#6d6b7a", "#ff8fa0", "#93ebb7", "#f9dc96", "#9cc1ff", "#d0b0ff", "#8ce6f2", "#f6f5fa",
  ],
};

let temas: Tema[] = [TEMA_MAHZZ];

function esValido(tema: Tema): boolean {
  return (
    typeof tema?.id === "string" &&
    typeof tema.nombre === "string" &&
    Array.isArray(tema.ansi) &&
    tema.ansi.length === 16 &&
    CLAVES_COLOR.every((clave) => typeof tema.colores?.[clave] === "string")
  );
}

export async function cargarTemas(): Promise<void> {
  const propios = await invoke<Tema[]>("leer_temas");
  temas = [TEMA_MAHZZ, ...propios.filter((tema) => esValido(tema) && tema.id !== TEMA_MAHZZ.id)];
}

export function listaTemas(): readonly Tema[] {
  return temas;
}

export function temaActual(): Tema {
  return temas.find((tema) => tema.id === ajustes().tema) ?? TEMA_MAHZZ;
}

const COLORES_LOGO: Record<Exclude<Logo, "clasico">, { acento: string; acentoClaro: string }> = {
  azul: { acento: "#1a8fe3", acentoClaro: "#7fe3f5" },
  oceano: { acento: "#2f6fe8", acentoClaro: "#6fe0c8" },
  esmeralda: { acento: "#17b885", acentoClaro: "#8bf0cf" },
  hielo: { acento: "#5b8fd6", acentoClaro: "#cfe6ff" },
  aurora: { acento: "#25b4c4", acentoClaro: "#b7a4ff" },
};

function mezclar(base: string, color: string, cantidad: number): string {
  const canal = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(canal(base, i) + (canal(color, i) - canal(base, i)) * cantidad))
    .map((valor) => valor.toString(16).padStart(2, "0"))
    .join("")}`;
}

function conColoresDelLogo(tema: Tema): Tema {
  const logo = ajustes().logo;
  if (tema.id !== TEMA_MAHZZ.id || logo === "clasico") return tema;
  const { acento, acentoClaro } = COLORES_LOGO[logo];
  return {
    ...tema,
    colores: {
      ...tema.colores,
      acento,
      acentoClaro,
      elevado: mezclar("#0d0d10", acento, 0.06),
      borde: mezclar("#18181d", acento, 0.14),
    },
  };
}

export function aplicarTema(base: Tema = temaActual()): void {
  const tema = conColoresDelLogo(base);
  const raiz = document.documentElement.style;
  for (const clave of CLAVES_COLOR) raiz.setProperty(VARIABLES[clave], tema.colores[clave]);
  tema.ansi.forEach((color, indice) => raiz.setProperty(`--ansi-${indice}`, color));
  raiz.setProperty("--fuente-mono", `"${ajustes().fuente}", "JetBrains Mono", Consolas, monospace`);
  raiz.setProperty("--tamano-mono", `${ajustes().tamanoFuente}px`);
}

export function temaTerminal(base: Tema = temaActual()): ITheme {
  const tema = conColoresDelLogo(base);
  const [black, red, green, yellow, blue, magenta, cyan, white] = tema.ansi;
  const [brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] =
    tema.ansi.slice(8);
  return {
    background: tema.colores.fondo,
    foreground: tema.colores.texto,
    cursor: tema.colores.acentoClaro,
    cursorAccent: tema.colores.fondo,
    selectionBackground: `${tema.colores.acento}55`,
    selectionInactiveBackground: `${tema.colores.acento}2e`,
    scrollbarSliderBackground: `${tema.colores.acento}40`,
    scrollbarSliderHoverBackground: `${tema.colores.acento}70`,
    scrollbarSliderActiveBackground: `${tema.colores.acento}a0`,
    black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite,
  };
}

export async function guardarTema(tema: Tema): Promise<void> {
  await invoke("guardar_tema", { id: tema.id, tema });
  temas = [...temas.filter((actual) => actual.id !== tema.id), tema];
  avisarCambio();
}

export async function borrarTema(id: string): Promise<void> {
  await invoke("borrar_tema", { id });
  temas = temas.filter((tema) => tema.id !== id);
  avisarCambio();
}
