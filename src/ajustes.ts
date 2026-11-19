import { invoke } from "@tauri-apps/api/core";
import { guardarIdioma } from "./i18n";

export interface Ajustes {
  idioma: "auto" | "es" | "en";
  primerUsoHecho: boolean;
  tema: string;
  fuente: string;
  tamanoFuente: number;
  cursor: "bar" | "block" | "underline";
  parpadeo: boolean;
  scrollback: number;
  restaurarPestanas: boolean;
  posicionPestanas: "arriba" | "izquierda" | "derecha";
  avisarComandos: boolean;
  segundosAviso: number;
  avisarPegado: boolean;
  preguntarSecretos: boolean;
  desplegableActivo: boolean;
  desplegableAtajo: string;
  atajos: Record<string, string>;
}

const VALORES_INICIALES: Ajustes = {
  idioma: "auto",
  primerUsoHecho: false,
  tema: "mahzz",
  fuente: "JetBrains Mono",
  tamanoFuente: 14,
  cursor: "bar",
  parpadeo: true,
  scrollback: 10_000,
  restaurarPestanas: true,
  posicionPestanas: "arriba",
  avisarComandos: true,
  segundosAviso: 30,
  avisarPegado: true,
  preguntarSecretos: true,
  desplegableActivo: false,
  desplegableAtajo: "Ctrl+Backquote",
  atajos: {},
};

type Oyente = () => void;

let actuales: Ajustes = { ...VALORES_INICIALES };
const oyentes = new Set<Oyente>();

// Conserva solo valores válidos, por si el archivo se editó a mano con errores.
function combinar(leidos: Record<string, unknown>): Ajustes {
  const resultado = { ...VALORES_INICIALES } as Record<string, unknown>;
  for (const [clave, inicial] of Object.entries(VALORES_INICIALES)) {
    if (typeof leidos[clave] === typeof inicial) resultado[clave] = leidos[clave];
  }
  return resultado as unknown as Ajustes;
}

export function ajustes(): Ajustes {
  return actuales;
}

export function alCambiarAjustes(oyente: Oyente): void {
  oyentes.add(oyente);
}

function avisar(): void {
  guardarIdioma(actuales.idioma);
  for (const oyente of oyentes) oyente();
}

export async function cargarAjustes(): Promise<void> {
  const anterior = JSON.stringify(actuales);
  actuales = combinar(await invoke<Record<string, unknown>>("leer_config"));
  if (JSON.stringify(actuales) !== anterior) avisar();
}

export async function cambiarAjustes(cambios: Partial<Ajustes>): Promise<void> {
  actuales = { ...actuales, ...cambios };
  await invoke("escribir_config", { config: actuales });
  avisar();
}
