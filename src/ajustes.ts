import { invoke } from "@tauri-apps/api/core";
import { guardarIdioma } from "./i18n";

// Logos elegibles en Ajustes → Apariencia. "clasico" es el de siempre y el que viene por defecto.
export const LOGOS = ["clasico", "azul", "oceano", "esmeralda", "hielo", "aurora"] as const;
export type Logo = (typeof LOGOS)[number];

export interface Ajustes {
  idioma: "auto" | "es" | "en";
  primerUsoHecho: boolean;
  tema: string;
  fuente: string;
  tamanoFuente: number;
  cursor: "bar" | "block" | "underline";
  parpadeo: boolean;
  // Logo de la app: el de la barra y el icono de las ventanas en la barra de tareas.
  logo: Logo;
  scrollback: number;
  restaurarPestanas: boolean;
  posicionPestanas: "arriba" | "izquierda" | "derecha";
  controlIA: boolean;
  avisarComandos: boolean;
  segundosAviso: number;
  avisarPegado: boolean;
  preguntarSecretos: boolean;
  desplegableActivo: boolean;
  desplegableAtajo: string;
  integracionWindows: boolean;
  integracionPreguntada: boolean;
  modeloPreguntado: boolean;
  buscarActualizaciones: boolean;
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
  logo: "clasico",
  scrollback: 10_000,
  restaurarPestanas: true,
  posicionPestanas: "arriba",
  controlIA: true,
  avisarComandos: true,
  segundosAviso: 30,
  avisarPegado: true,
  preguntarSecretos: true,
  desplegableActivo: false,
  desplegableAtajo: "Ctrl+Backquote",
  integracionWindows: false,
  integracionPreguntada: false,
  modeloPreguntado: false,
  buscarActualizaciones: true,
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
  const combinados = resultado as unknown as Ajustes;
  if (!(LOGOS as readonly string[]).includes(combinados.logo)) combinados.logo = "clasico";
  return combinados;
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
