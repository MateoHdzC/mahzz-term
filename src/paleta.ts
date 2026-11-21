import { t } from "./i18n";
import { invoke } from "@tauri-apps/api/core";
import { SECCIONES, type SeccionAjustes } from "./ajustesUI";
import { textoAtajo, type Accion } from "./atajos";
import { avisar, confirmar, pedirDatos } from "./dialogos";
import { carpetasRecientes, entradasHistorial, pareceSecreto } from "./historial";
import type { Panel } from "./panel";
import { listarSecretos, revelarSecreto } from "./secretos";
import { abrirSelector, type ItemSelector } from "./selector";

export interface ComandoGuardado {
  id: string;
  nombre: string;
  comando: string;
}

export interface ApiPaleta {
  panel(): Panel | null;
  ejecutarAccion(accion: Accion): void;
  abrirAjustes(seccion: SeccionAjustes): void;
}

const ACCIONES: { accion: Accion; titulo: string }[] = [
  { accion: "nuevaPestana", titulo: t("Nueva pestaña") },
  { accion: "nuevaVentana", titulo: t("Nueva ventana") },
  { accion: "dividirDerecha", titulo: t("Dividir panel a la derecha") },
  { accion: "dividirAbajo", titulo: t("Dividir panel hacia abajo") },
  { accion: "cerrarPanel", titulo: t("Cerrar panel") },
  { accion: "pestanaSiguiente", titulo: t("Ir a la pestaña siguiente") },
  { accion: "pestanaAnterior", titulo: t("Ir a la pestaña anterior") },
  { accion: "buscar", titulo: t("Buscar en los bloques") },
  { accion: "historial", titulo: t("Buscar en el historial de comandos") },
  { accion: "guardarComando", titulo: t("Guardar el comando escrito") },
  { accion: "verGuardados", titulo: t("Ver comandos guardados") },
  { accion: "alternarArchivos", titulo: t("Mostrar u ocultar archivos") },
  { accion: "abrirAjustes", titulo: t("Abrir ajustes") },
  { accion: "alternarCambios", titulo: t("Revisar cambios") },
  { accion: "alternarAgentes", titulo: t("Ver agentes activos") },
  { accion: "reanudarSesion", titulo: t("Reanudar una sesión anterior") },
  { accion: "buscarLogs", titulo: t("Buscar en todos los logs") },
  { accion: "nuevaTarea", titulo: t("Nueva tarea en paralelo para un agente") },
];

const PARAMETRO = /\{\{\s*([\p{L}\p{N}_-]+)\s*\}\}/gu;

export function formatoFecha(fecha: number): string {
  const momento = new Date(fecha);
  const hoy = new Date();
  const hora = momento.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (momento.toDateString() === hoy.toDateString()) return t("hoy {0}", hora);
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);
  if (momento.toDateString() === ayer.toDateString()) return t("ayer {0}", hora);
  return `${momento.toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "2-digit" })} ${hora}`;
}

async function leerGuardados(): Promise<ComandoGuardado[]> {
  return invoke<ComandoGuardado[]>("leer_guardados");
}

async function escribirGuardados(lista: ComandoGuardado[]): Promise<void> {
  await invoke("escribir_guardados", { lista });
  window.dispatchEvent(new Event("mahzz:datos-cambiados"));
}

export function parametrosDe(comando: string): string[] {
  return [...new Set([...comando.matchAll(PARAMETRO)].map((resultado) => resultado[1]))];
}

async function usarGuardado(api: ApiPaleta, guardado: ComandoGuardado): Promise<void> {
  const panel = api.panel();
  if (!panel) return;
  const parametros = parametrosDe(guardado.comando);
  let comando = guardado.comando;

  if (parametros.length > 0) {
    const valores = await pedirDatos(
      guardado.nombre,
      parametros.map((nombre) => ({ clave: nombre, etiqueta: nombre, obligatorio: true })),
      t("Ejecutar"),
    );
    panel.enfocar();
    if (!valores) return;
    comando = comando.replace(PARAMETRO, (_, nombre: string) => valores[nombre] ?? "");
  }
  if (!panel.ejecutarComando(comando)) avisar(t("Esperá a que termine el comando actual"));
}

async function editarGuardado(api: ApiPaleta, base: Partial<ComandoGuardado>): Promise<void> {
  const datos = await pedirDatos(
    base.id ? t("Editar comando guardado") : t("Guardar comando"),
    [
      { clave: "nombre", etiqueta: t("Nombre"), valor: base.nombre ?? "", obligatorio: true },
      {
        clave: "comando",
        etiqueta: t("Comando (usá {{nombre}} para pedir valores)"),
        valor: base.comando ?? "",
        multilinea: true,
        obligatorio: true,
      },
    ],
    t("Guardar"),
  );
  api.panel()?.enfocar();
  if (!datos) return;
  if (pareceSecreto(datos.comando)) {
    avisar(t("No se guardó porque parece incluir una contraseña o clave"));
    return;
  }

  const lista = await leerGuardados();
  const nuevo: ComandoGuardado = {
    id: base.id ?? crypto.randomUUID(),
    nombre: datos.nombre.trim(),
    comando: datos.comando.trim(),
  };
  const indice = lista.findIndex((actual) => actual.id === nuevo.id);
  if (indice >= 0) lista[indice] = nuevo;
  else lista.push(nuevo);
  await escribirGuardados(lista);
  avisar(t("Comando guardado: {0}", nuevo.nombre));
}

export function guardarComando(api: ApiPaleta, comando?: string): void {
  void editarGuardado(api, { comando: comando ?? api.panel()?.textoEditor ?? "" });
}

export async function abrirGuardados(api: ApiPaleta): Promise<void> {
  const lista = await leerGuardados();
  const items: ItemSelector[] = lista.map((guardado) => ({
    id: guardado.id,
    titulo: guardado.nombre,
    detalle: guardado.comando,
    alElegir: () => void usarGuardado(api, guardado),
  }));

  abrirSelector({
    etiqueta: t("Buscar comandos guardados"),
    ayuda: t("Enter ejecuta · Ctrl+E edita · Supr elimina"),
    items,
    alCerrar: () => api.panel()?.enfocar(),
    alTecla: (evento, item, cerrar) => {
      const guardado = lista.find((actual) => actual.id === item?.id);
      if (!guardado) return false;
      if (evento.ctrlKey && evento.key.toLowerCase() === "e") {
        cerrar();
        void editarGuardado(api, guardado);
        return true;
      }
      if (evento.key === "Delete") {
        cerrar();
        void confirmar(t("¿Eliminar este comando?"), guardado.nombre, t("Eliminar")).then(async (aceptado) => {
          if (aceptado) await escribirGuardados(lista.filter((actual) => actual.id !== guardado.id));
          api.panel()?.enfocar();
        });
        return true;
      }
      return false;
    },
  });
}

export function abrirHistorial(api: ApiPaleta): void {
  const carpetaActual = api.panel()?.carpeta ?? null;
  const vistos = new Set<string>();
  const items: ItemSelector[] = [];
  const entradas = entradasHistorial();

  for (let i = entradas.length - 1; i >= 0; i--) {
    const entrada = entradas[i];
    if (vistos.has(entrada.comando)) continue;
    vistos.add(entrada.comando);
    const carpeta = entrada.carpeta?.split("\\").filter(Boolean).at(-1);
    items.push({
      id: String(i),
      titulo: entrada.comando,
      detalle: [carpeta, formatoFecha(entrada.fecha), entrada.codigo === 0 ? "" : t("código {0}", entrada.codigo)]
        .filter(Boolean)
        .join(" · "),
      estado: entrada.codigo === 0 ? "ok" : "error",
      prioridad: entrada.carpeta === carpetaActual ? 6 : 0,
      alElegir: () => api.panel()?.ponerEnEditor(entrada.comando),
    });
  }

  abrirSelector({
    etiqueta: t("Buscar en el historial"),
    ayuda: t("Enter lo lleva al editor · Ctrl+Enter lo ejecuta"),
    items,
    alCerrar: () => api.panel()?.enfocar(),
    alTecla: (evento, item, cerrar) => {
      if (!item || !evento.ctrlKey || evento.key !== "Enter") return false;
      cerrar();
      if (!api.panel()?.ejecutarComando(item.titulo)) avisar(t("Esperá a que termine el comando actual"));
      return true;
    },
  });
}

export async function abrirPaleta(api: ApiPaleta): Promise<void> {
  const items: ItemSelector[] = ACCIONES.map(({ accion, titulo }) => ({
    id: accion,
    titulo,
    seccion: t("Acciones"),
    atajo: textoAtajo(accion),
    alElegir: () => api.ejecutarAccion(accion),
  }));

  for (const guardado of await leerGuardados()) {
    items.push({
      id: `guardado-${guardado.id}`,
      titulo: guardado.nombre,
      detalle: guardado.comando,
      seccion: t("Comandos guardados"),
      alElegir: () => void usarGuardado(api, guardado),
    });
  }

  for (const seccion of SECCIONES) {
    items.push({
      id: `ajuste-${seccion.id}`,
      titulo: seccion.titulo,
      seccion: t("Ajustes"),
      alElegir: () => api.abrirAjustes(seccion.id),
    });
  }

  for (const secreto of await listarSecretos()) {
    items.push({
      id: `secreto-${secreto.id}`,
      titulo: secreto.nombre,
      seccion: t("Secretos guardados"),
      alElegir: () => {
        void revelarSecreto(secreto.id).then((valor) => {
          if (valor) api.panel()?.ponerEnEditor(valor);
        });
      },
    });
  }

  for (const host of await invoke<string[]>("hosts_ssh")) {
    items.push({
      id: `ssh-${host}`,
      titulo: host,
      detalle: `ssh ${host}`,
      seccion: t("Servidores SSH"),
      alElegir: () => {
        if (!api.panel()?.ejecutarComando(`ssh ${host}`)) avisar(t("Esperá a que termine el comando actual"));
      },
    });
  }

  for (const carpeta of carpetasRecientes(12)) {
    items.push({
      id: `carpeta-${carpeta}`,
      titulo: carpeta,
      seccion: t("Carpetas recientes"),
      alElegir: () => {
        const comando = `Set-Location -LiteralPath '${carpeta.replaceAll("'", "''")}'`;
        if (!api.panel()?.ejecutarComando(comando)) avisar(t("Esperá a que termine el comando actual"));
      },
    });
  }

  abrirSelector({
    etiqueta: t("Buscar acciones, comandos y carpetas"),
    ayuda: t("Enter elige · Esc cierra"),
    items,
    alCerrar: () => api.panel()?.enfocar(),
  });
}
