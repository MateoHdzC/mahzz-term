import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { avisar, confirmar } from "./dialogos";
import { t } from "./i18n";

// Busca versiones nuevas en los releases de GitHub. Las actualizaciones vienen firmadas:
// si la firma no coincide con la clave pública de la app, no se instalan.

const PRIMERA_REVISION = 8_000;
const CADA_CUANTO = 6 * 60 * 60 * 1000;
const CLAVE_AVISADA = "mahzz-actualizacion-avisada";

let pendiente: Update | null = null;
const oyentes = new Set<() => void>();

export function actualizacionPendiente(): Update | null {
  return pendiente;
}

export function alCambiarActualizacion(oyente: () => void): void {
  oyentes.add(oyente);
}

function definirPendiente(actualizacion: Update | null): void {
  pendiente = actualizacion;
  // Puntito en el botón de Ajustes mientras haya una versión sin instalar.
  const boton = document.getElementById("ajustes");
  boton?.classList.toggle("barra__boton--aviso", Boolean(actualizacion));
  if (boton) boton.title = actualizacion ? t("Ajustes: MahzzTerm {0} está disponible", actualizacion.version) : t("Ajustes");
  for (const oyente of oyentes) oyente();
}

function yaAvisada(version: string): boolean {
  try {
    return localStorage.getItem(CLAVE_AVISADA) === version;
  } catch {
    return false;
  }
}

function marcarAvisada(version: string): void {
  try {
    localStorage.setItem(CLAVE_AVISADA, version);
  } catch {
    // Sin almacenamiento, en el peor caso se vuelve a avisar la misma versión.
  }
}

// Revisión silenciosa: si hay versión nueva, notificación de Windows (una sola vez por versión).
async function revisar(): Promise<void> {
  let actualizacion: Update | null;
  try {
    actualizacion = await check();
  } catch {
    return;
  }
  definirPendiente(actualizacion);
  if (!actualizacion || yaAvisada(actualizacion.version)) return;
  marcarAvisada(actualizacion.version);
  void invoke("avisar_comando", {
    titulo: t("MahzzTerm {0} está disponible", actualizacion.version),
    cuerpo: t("Abrí Ajustes y tocá Actualizar. Tarda menos de un minuto."),
  }).catch(() => undefined);
}

// La ventana principal revisa al abrir y después cada 6 horas mientras siga abierta.
export function iniciarActualizaciones(): void {
  setTimeout(() => void revisar(), PRIMERA_REVISION);
  setInterval(() => void revisar(), CADA_CUANTO);
}

export async function instalarActualizacion(): Promise<void> {
  const actualizacion = pendiente;
  if (!actualizacion) return;
  avisar(t("Descargando MahzzTerm {0}…", actualizacion.version));
  try {
    await actualizacion.downloadAndInstall();
    await relaunch();
  } catch (error) {
    avisar(t("No se pudo actualizar: {0}", String(error)));
  }
}

// Desde Ajustes: busca ahora y, si hay versión nueva, pregunta si instalarla.
export async function buscarActualizacion(): Promise<void> {
  let actualizacion: Update | null;
  try {
    actualizacion = await check();
  } catch (error) {
    avisar(t("No se pudo buscar actualizaciones: {0}", String(error)));
    return;
  }
  definirPendiente(actualizacion);
  if (!actualizacion) {
    avisar(t("Ya tenés la última versión"));
    return;
  }
  const instalar = await confirmar(
    t("MahzzTerm {0} está disponible", actualizacion.version),
    actualizacion.body?.trim() || t("Hay una versión nueva. Se descarga, se instala y MahzzTerm se reinicia."),
    t("Actualizar ahora"),
  );
  if (instalar) await instalarActualizacion();
}
