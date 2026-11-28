import { t } from "./i18n";

export type Accion =
  | "nuevaPestana"
  | "duplicarPestana"
  | "nuevaVentana"
  | "cerrarPanel"
  | "pestanaSiguiente"
  | "pestanaAnterior"
  | "dividirDerecha"
  | "dividirAbajo"
  | "panelIzquierda"
  | "panelDerecha"
  | "panelArriba"
  | "panelAbajo"
  | "buscar"
  | "bloqueAnterior"
  | "bloqueSiguiente"
  | "historial"
  | "paleta"
  | "guardarComando"
  | "verGuardados"
  | "alternarArchivos"
  | "abrirAjustes"
  | "alternarCambios"
  | "alternarAgentes"
  | "alternarMahzz"
  | "reanudarSesion"
  | "buscarLogs"
  | "nuevaTarea"
  | `irPestana${number}`;

interface Atajo {
  accion: Accion;
  tecla: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

const ATAJOS: Atajo[] = [
  { accion: "nuevaPestana", tecla: "t", ctrl: true, shift: true },
  { accion: "duplicarPestana", tecla: "u", ctrl: true, shift: true },
  { accion: "nuevaVentana", tecla: "n", ctrl: true, shift: true },
  { accion: "cerrarPanel", tecla: "w", ctrl: true, shift: true },
  { accion: "pestanaSiguiente", tecla: "tab", ctrl: true },
  { accion: "pestanaSiguiente", tecla: "pagedown", ctrl: true },
  { accion: "pestanaAnterior", tecla: "tab", ctrl: true, shift: true },
  { accion: "pestanaAnterior", tecla: "pageup", ctrl: true },
  { accion: "dividirDerecha", tecla: "d", ctrl: true, shift: true },
  { accion: "dividirAbajo", tecla: "e", ctrl: true, shift: true },
  { accion: "panelIzquierda", tecla: "arrowleft", ctrl: true, alt: true },
  { accion: "panelDerecha", tecla: "arrowright", ctrl: true, alt: true },
  { accion: "panelArriba", tecla: "arrowup", ctrl: true, alt: true },
  { accion: "panelAbajo", tecla: "arrowdown", ctrl: true, alt: true },
  { accion: "buscar", tecla: "f", ctrl: true },
  { accion: "bloqueAnterior", tecla: "arrowup", ctrl: true },
  { accion: "bloqueSiguiente", tecla: "arrowdown", ctrl: true },
  { accion: "historial", tecla: "r", ctrl: true },
  { accion: "paleta", tecla: "p", ctrl: true, shift: true },
  { accion: "guardarComando", tecla: "s", ctrl: true, shift: true },
  { accion: "verGuardados", tecla: "o", ctrl: true, shift: true },
  { accion: "alternarArchivos", tecla: "b", ctrl: true, shift: true },
  { accion: "abrirAjustes", tecla: ",", ctrl: true },
  { accion: "alternarCambios", tecla: "g", ctrl: true, shift: true },
  { accion: "alternarAgentes", tecla: "a", ctrl: true, shift: true },
  { accion: "alternarMahzz", tecla: "m", ctrl: true, shift: true },
  { accion: "buscarLogs", tecla: "f", ctrl: true, shift: true },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(
    (numero): Atajo => ({ accion: `irPestana${numero}`, tecla: String(numero), ctrl: true }),
  ),
];

let activos: Atajo[] = ATAJOS;

export const ACCIONES_EDITABLES: { accion: Accion; titulo: string }[] = [
  { accion: "nuevaPestana", titulo: t("Nueva pestaña") },
  { accion: "duplicarPestana", titulo: t("Duplicar pestaña") },
  { accion: "nuevaVentana", titulo: t("Nueva ventana") },
  { accion: "cerrarPanel", titulo: t("Cerrar panel") },
  { accion: "dividirDerecha", titulo: t("Dividir panel a la derecha") },
  { accion: "dividirAbajo", titulo: t("Dividir panel hacia abajo") },
  { accion: "buscar", titulo: t("Buscar en los bloques") },
  { accion: "historial", titulo: t("Buscar en el historial de comandos") },
  { accion: "paleta", titulo: t("Paleta de comandos") },
  { accion: "guardarComando", titulo: t("Guardar el comando escrito") },
  { accion: "verGuardados", titulo: t("Ver comandos guardados") },
  { accion: "alternarArchivos", titulo: t("Mostrar u ocultar archivos") },
  { accion: "abrirAjustes", titulo: t("Abrir ajustes") },
  { accion: "alternarCambios", titulo: t("Revisar cambios") },
  { accion: "alternarAgentes", titulo: t("Ver agentes activos") },
  { accion: "alternarMahzz", titulo: t("Abrir Mahzz-AI") },
  { accion: "reanudarSesion", titulo: t("Reanudar una sesión anterior") },
  { accion: "buscarLogs", titulo: t("Buscar en todos los logs") },
  { accion: "nuevaTarea", titulo: t("Nueva tarea en paralelo para un agente") },
];

function desdeTexto(accion: Accion, combinacion: string): Atajo {
  const partes = combinacion.toLowerCase().split("+");
  return {
    accion,
    tecla: partes.at(-1) ?? "",
    ctrl: partes.includes("ctrl"),
    shift: partes.includes("shift"),
    alt: partes.includes("alt"),
  };
}

export function definirAtajos(propios: Record<string, string>): void {
  const cambiadas = Object.entries(propios).map(([accion, texto]) => desdeTexto(accion as Accion, texto));
  activos = [...ATAJOS.filter((atajo) => !(atajo.accion in propios)), ...cambiadas];
}

function aTexto(atajo: Atajo): string {
  return [atajo.ctrl && "ctrl", atajo.shift && "shift", atajo.alt && "alt", atajo.tecla].filter(Boolean).join("+");
}

export function combinacionActual(accion: Accion): string | undefined {
  const atajo = activos.find((candidato) => candidato.accion === accion);
  return atajo && aTexto(atajo);
}

export function combinacionDeEvento(evento: KeyboardEvent): string | null {
  const tecla = evento.key.toLowerCase();
  if (["control", "shift", "alt", "meta"].includes(tecla)) return null;
  return aTexto({
    accion: "buscar",
    tecla,
    ctrl: evento.ctrlKey,
    shift: evento.shiftKey,
    alt: evento.altKey,
  });
}

export const ACCIONES_DE_BLOQUES: readonly Accion[] = [
  "buscar",
  "bloqueAnterior",
  "bloqueSiguiente",
  "historial",
];

const NOMBRES_TECLAS: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  pagedown: "RePág",
  pageup: "AvPág",
  tab: "Tab",
};

export function textoAtajo(accion: Accion): string | undefined {
  const atajo = activos.find((candidato) => candidato.accion === accion);
  if (!atajo) return undefined;
  const tecla = NOMBRES_TECLAS[atajo.tecla] ?? atajo.tecla.toUpperCase();
  return [atajo.ctrl && "Ctrl", atajo.shift && "Shift", atajo.alt && "Alt", tecla].filter(Boolean).join("+");
}

export function accionDeTecla(evento: KeyboardEvent): Accion | null {
  const tecla = evento.key.toLowerCase();
  const atajo = activos.find(
    (candidato) =>
      candidato.tecla === tecla &&
      Boolean(candidato.ctrl) === evento.ctrlKey &&
      Boolean(candidato.shift) === evento.shiftKey &&
      Boolean(candidato.alt) === evento.altKey,
  );
  return atajo?.accion ?? null;
}
