import { invoke } from "@tauri-apps/api/core";
import { ajustes } from "./ajustes";
import { avisar, pedirDatos } from "./dialogos";
import { t } from "./i18n";

export interface SecretoGuardado {
  id: string;
  nombre: string;
}

const consultados = new Set<string>();

export function listarSecretos(): Promise<SecretoGuardado[]> {
  return invoke<SecretoGuardado[]>("listar_secretos");
}

export async function revelarSecreto(id: string): Promise<string | null> {
  try {
    return await invoke<string | null>("revelar_secreto", { id });
  } catch {
    avisar(t("No se pudo leer el secreto"));
    return null;
  }
}

export function borrarSecreto(id: string): Promise<void> {
  return invoke("borrar_secreto", { id });
}

export async function ofrecerGuardarSecreto(comando: string, alTerminar: () => void): Promise<void> {
  if (!ajustes().preguntarSecretos || consultados.has(comando)) return;
  consultados.add(comando);

  const datos = await pedirDatos(
    t("¿Deseás guardar esto?"),
    [{ clave: "nombre", etiqueta: t("Nombre para encontrarlo después"), obligatorio: true }],
    t("Guardar en este equipo"),
  );
  alTerminar();
  if (!datos) return;
  await invoke("guardar_secreto", { id: crypto.randomUUID(), nombre: datos.nombre.trim(), valor: comando });
  avisar(t("Secreto guardado: {0}", datos.nombre.trim()));
}
