import { invoke } from "@tauri-apps/api/core";
import { pedirDatos } from "./dialogos";
import { t } from "./i18n";

export interface Tarea {
  nombre: string;
  rama: string;
  carpeta: string;
  cambios: number;
  commits: number;
}

export interface ListaTareas {
  repo: string | null;
  base?: string;
  tareas: Tarea[];
}

export interface TareaCreada {
  nombre: string;
  rama: string;
  carpeta: string;
  repo: string;
  base: string;
}

export interface PedidoTarea {
  nombre: string;
  instrucciones: string;
  agente: string;
}

export function listarTareas(carpeta: string): Promise<ListaTareas> {
  return invoke<ListaTareas>("listar_tareas", { carpeta });
}

export function crearTarea(carpeta: string, nombre: string): Promise<TareaCreada> {
  return invoke<TareaCreada>("crear_tarea", { carpeta, nombre });
}

export function unirTarea(carpeta: string, mensaje?: string): Promise<{ unida: string; en: string }> {
  return invoke("unir_tarea", { carpeta, mensaje: mensaje ?? null });
}

export function descartarTarea(carpeta: string): Promise<{ descartada: string }> {
  return invoke("descartar_tarea", { carpeta });
}

export function comandoAgente(agente: string, instrucciones: string): string {
  const programa = agente.trim() || "claude";
  const texto = instrucciones.trim();
  return texto ? `${programa} '${texto.replaceAll("'", "''")}'` : programa;
}

export async function pedirNuevaTarea(): Promise<PedidoTarea | null> {
  const datos = await pedirDatos(
    t("Nueva tarea en paralelo"),
    [
      { clave: "nombre", etiqueta: t("Nombre de la tarea (será la rama mahzz/…)"), obligatorio: true },
      { clave: "instrucciones", etiqueta: t("Qué tiene que hacer el agente (opcional)"), multilinea: true },
      { clave: "agente", etiqueta: t("Comando del agente"), valor: "claude" },
    ],
    t("Crear tarea"),
  );
  if (!datos?.nombre.trim()) return null;
  return { nombre: datos.nombre, instrucciones: datos.instrucciones ?? "", agente: datos.agente ?? "claude" };
}

export function estaDentro(ruta: string | null, carpeta: string): boolean {
  if (!ruta) return false;
  const a = ruta.toLowerCase().replace(/[\\/]+$/, "");
  const b = carpeta.toLowerCase().replace(/[\\/]+$/, "");
  return a === b || a.startsWith(`${b}\\`);
}
