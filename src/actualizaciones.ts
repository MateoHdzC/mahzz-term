import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { avisar, confirmar } from "./dialogos";
import { t } from "./i18n";

// Busca una versión nueva en los releases de GitHub. Las actualizaciones vienen firmadas:
// si la firma no coincide con la clave pública de la app, no se instalan.
export async function buscarActualizacion(manual: boolean): Promise<void> {
  let actualizacion;
  try {
    actualizacion = await check();
  } catch (error) {
    if (manual) avisar(t("No se pudo buscar actualizaciones: {0}", String(error)));
    return;
  }
  if (!actualizacion) {
    if (manual) avisar(t("Ya tenés la última versión"));
    return;
  }
  const instalar = await confirmar(
    t("MahzzTerm {0} está disponible", actualizacion.version),
    actualizacion.body?.trim() || t("Hay una versión nueva. Se descarga, se instala y MahzzTerm se reinicia."),
    t("Actualizar ahora"),
  );
  if (!instalar) return;
  avisar(t("Descargando la actualización…"));
  try {
    await actualizacion.downloadAndInstall();
    await relaunch();
  } catch (error) {
    avisar(t("No se pudo actualizar: {0}", String(error)));
  }
}
