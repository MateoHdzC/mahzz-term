import { invoke } from "@tauri-apps/api/core";
import { infoAgente } from "./agentes";
import { avisar } from "./dialogos";
import { t } from "./i18n";
import { formatoFecha } from "./paleta";
import type { DatosNodo, DatosPestana } from "./pestana";
import { abrirSelector, type ItemSelector } from "./selector";

export interface SesionGuardada {
  id: string;
  inicio: number;
  actualizada: number;
  pestanas: DatosPestana[];
  activa: number;
}

function carpetasDe(nodo: DatosNodo, destino: string[]): string[] {
  if (nodo.tipo === "panel") {
    if (nodo.datos.carpeta) destino.push(nodo.datos.carpeta);
  } else {
    carpetasDe(nodo.a, destino);
    carpetasDe(nodo.b, destino);
  }
  return destino;
}

function programasDe(nodo: DatosNodo, destino: string[]): string[] {
  if (nodo.tipo === "panel") {
    const info = infoAgente(nodo.datos.programa);
    if (info) destino.push(info.nombre);
  } else {
    programasDe(nodo.a, destino);
    programasDe(nodo.b, destino);
  }
  return destino;
}

function nombreCarpeta(carpeta: string): string {
  return carpeta.split("\\").filter(Boolean).at(-1) ?? carpeta;
}

// Dos sesiones con las mismas pestañas y carpetas son la misma: se muestra solo la más nueva.
function firma(sesion: SesionGuardada): string {
  return JSON.stringify(
    sesion.pestanas.map((pestana) => [pestana.tituloManual, pestana.color, carpetasDe(pestana.nodo, [])]),
  );
}

export async function listarSesiones(excluir: string): Promise<SesionGuardada[]> {
  const todas = await invoke<SesionGuardada[]>("listar_sesiones");
  const vistas = new Set<string>();
  const resultado: SesionGuardada[] = [];
  for (const sesion of todas) {
    if (sesion.id === excluir || !Array.isArray(sesion.pestanas)) continue;
    const clave = firma(sesion);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    resultado.push(sesion);
  }
  return resultado;
}

// Al reabrir, un panel que tenía Claude Code abierto queda con `claude --continue` listo en el editor.
function prepararNodo(nodo: DatosNodo): DatosNodo {
  if (nodo.tipo === "division") return { ...nodo, a: prepararNodo(nodo.a), b: prepararNodo(nodo.b) };
  const comando = infoAgente(nodo.datos.programa)?.reanudar;
  const { programa: _programa, ...datos } = nodo.datos;
  return { ...nodo, datos: comando && !datos.borrador ? { ...datos, borrador: comando } : datos };
}

export function prepararParaReanudar(pestana: DatosPestana): DatosPestana {
  return { ...pestana, nodo: prepararNodo(pestana.nodo) };
}

function describir(sesion: SesionGuardada): { titulo: string; detalle: string } {
  const titulos = sesion.pestanas.map((pestana, indice) => pestana.titulo ?? pestana.tituloManual ?? t("Pestaña {0}", indice + 1));
  const carpetas = [...new Set(sesion.pestanas.flatMap((pestana) => carpetasDe(pestana.nodo, [])).map(nombreCarpeta))];
  const agentes = [...new Set(sesion.pestanas.flatMap((pestana) => programasDe(pestana.nodo, [])))];
  const cantidad =
    sesion.pestanas.length === 1 ? t("1 pestaña") : t("{0} pestañas", sesion.pestanas.length);
  const partes = [formatoFecha(sesion.actualizada || sesion.inicio), cantidad];
  if (carpetas.length) partes.push(carpetas.slice(0, 4).join(", ") + (carpetas.length > 4 ? "…" : ""));
  if (agentes.length) partes.push(agentes.join(", "));
  return { titulo: titulos.join(" · "), detalle: partes.join(" · ") };
}

export function elegirSesion(
  sesiones: SesionGuardada[],
  alElegir: (sesion: SesionGuardada) => void,
  alCerrar: () => void,
): void {
  if (sesiones.length === 0) {
    avisar(t("No hay sesiones anteriores para reanudar"));
    alCerrar();
    return;
  }
  const items: ItemSelector[] = sesiones.map((sesion, indice) => ({
    id: sesion.id,
    ...describir(sesion),
    seccion: indice === 0 ? t("Más reciente") : indice === 1 ? t("Anteriores") : undefined,
    prioridad: (sesiones.length - indice) * 10,
    alElegir: () => alElegir(sesion),
  }));
  abrirSelector({
    etiqueta: t("Reanudar sesión"),
    ayuda: t("Enter abre sus pestañas · Supr la borra · mahzz --resume 2 abre la segunda"),
    items,
    alCerrar,
    alTecla: (evento, item, cerrar) => {
      if (evento.key !== "Delete" || !item) return false;
      const restantes = sesiones.filter((sesion) => sesion.id !== item.id);
      void invoke("borrar_sesion_guardada", { id: item.id })
        .then(() => {
          cerrar();
          if (restantes.length) elegirSesion(restantes, alElegir, alCerrar);
        })
        .catch((error) => avisar(t("No se pudo borrar: {0}", String(error))));
      return true;
    },
  });
}
