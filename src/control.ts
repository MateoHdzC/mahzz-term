import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ajustes } from "./ajustes";
import { entradasHistorial } from "./historial";
import type { Panel } from "./panel";
import type { Pestana } from "./pestana";
import { buscarRegistros } from "./registros";
import { listarTareas, type PedidoTarea, type TareaCreada } from "./tareas";

// Lo que el gestor de pestañas le presta al control por IA.
export interface ApiControl {
  pestanas(): Pestana[];
  activa(): Pestana | null;
  activar(pestana: Pestana): void;
  nuevaPestana(carpeta: string | null, titulo: string | null): Promise<Pestana>;
  cerrarPanel(pestana: Pestana, panel: Panel): void;
  crearTarea(pedido: PedidoTarea, carpeta: string | null): Promise<{ pestana: Pestana; tarea: TareaCreada }>;
  terminarTarea(carpeta: string, modo: "unir" | "descartar"): Promise<unknown>;
  renombrar(pestana: Pestana, titulo: string | null): void;
  agentes(): unknown[];
  abrirArchivo(ruta: string): void;
}

interface Pedido {
  id: number;
  accion: string;
  args: Record<string, unknown>;
}

const MAXIMO_SALIDA = 20_000;

const TECLAS: Record<string, string> = {
  enter: "\r", tab: "\t", esc: "\x1b", escape: "\x1b", backspace: "\x7f", delete: "\x1b[3~", space: " ",
  up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", home: "\x1b[H", end: "\x1b[F",
  pageup: "\x1b[5~", pagedown: "\x1b[6~",
  "ctrl+c": "\x03", "ctrl+d": "\x04", "ctrl+z": "\x1a", "ctrl+l": "\x0c", "ctrl+r": "\x12",
  "ctrl+a": "\x01", "ctrl+e": "\x05", "ctrl+u": "\x15", "ctrl+w": "\x17",
};

function numero(valor: unknown, porDefecto: number, minimo: number, maximo: number): number {
  const leido = typeof valor === "number" && Number.isFinite(valor) ? Math.round(valor) : porDefecto;
  return Math.min(maximo, Math.max(minimo, leido));
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor : null;
}

// Si la salida es muy larga se queda con el final, que es donde suelen estar los errores.
function recortar(salida: string, maximo: number): string {
  if (salida.length <= maximo) return salida;
  return `…[recortado: se omitieron ${salida.length - maximo} caracteres del principio]\n${salida.slice(-maximo)}`;
}

function esperar(ms: number): Promise<void> {
  return new Promise((listo) => setTimeout(listo, ms));
}

function ubicar(api: ApiControl, id: unknown): { pestana: Pestana; panel: Panel } {
  if (id === undefined || id === null) {
    const pestana = api.activa();
    if (!pestana) throw new Error("No hay pestañas abiertas");
    return { pestana, panel: pestana.activo };
  }
  for (const pestana of api.pestanas()) {
    for (const panel of pestana.paneles) if (panel.id === id) return { pestana, panel };
  }
  throw new Error(`No existe el panel ${String(id)}. Usá listar_pestanas para ver los ids.`);
}

function describirPanel(pestana: Pestana, panel: Panel) {
  return {
    id: panel.id,
    activo: panel === pestana.activo,
    carpeta: panel.carpeta,
    programa: panel.programa,
    ocupado: panel.ocupado,
    rama: panel.ramaActual,
    ssh: panel.hostRemoto,
    shell_vivo: panel.sesion !== null,
  };
}

async function ejecutar(api: ApiControl, args: Record<string, unknown>) {
  const comando = texto(args.comando);
  if (!comando) throw new Error("Falta el comando");
  const { panel } = ubicar(api, args.panel);
  if (panel.ocupado) {
    const programa = panel.programa ? ` con ${panel.programa}` : "";
    throw new Error(`El panel ${panel.id} está ocupado${programa}. Usá enviar_teclas, otro panel o nueva_pestana.`);
  }
  const fin = panel.esperarFinComando();
  if (!panel.ejecutarComando(comando)) {
    throw new Error("El panel no aceptó el comando: puede estar arrancando o sin PowerShell. Probá de nuevo en un momento.");
  }
  if (args.esperar === false) return { panel: panel.id, enviado: true };

  const espera = numero(args.timeout_s, 60, 1, 900) * 1000;
  const resultado = await Promise.race([fin, esperar(espera).then(() => null)]);
  if (!resultado) {
    return {
      panel: panel.id,
      terminado: false,
      mensaje: "El comando sigue corriendo. Usá leer_pantalla para ver cómo va o enviar_teclas con ctrl+c para cortarlo.",
      pantalla: recortar(panel.textoPantalla(150), MAXIMO_SALIDA),
    };
  }
  return {
    panel: panel.id,
    terminado: true,
    codigo: resultado.codigo,
    duracion_ms: resultado.duracion,
    carpeta: resultado.carpeta,
    salida: recortar(resultado.salida, numero(args.max_caracteres, MAXIMO_SALIDA, 200, 200_000)),
  };
}

async function atender(api: ApiControl, accion: string, args: Record<string, unknown>): Promise<unknown> {
  if (!ajustes().controlIA) throw new Error("El control por IA está desactivado en Ajustes de MahzzTerm.");

  switch (accion) {
    case "listar_pestanas": {
      const activa = api.activa();
      return {
        pestanas: api.pestanas().map((pestana, indice) => ({
          indice,
          titulo: pestana.titulo,
          activa: pestana === activa,
          paneles: pestana.paneles.map((panel) => describirPanel(pestana, panel)),
        })),
      };
    }

    case "leer_bloques": {
      const { pestana, panel } = ubicar(api, args.panel);
      const maximo = numero(args.max_caracteres, MAXIMO_SALIDA, 200, 200_000);
      let bloques = panel.lista.exportar().filter((bloque) => bloque.tipo === "comando");
      if (args.solo_errores === true) bloques = bloques.filter((bloque) => bloque.codigo !== 0);
      bloques = bloques.slice(-numero(args.cantidad, 10, 1, 200));
      return {
        panel: describirPanel(pestana, panel),
        bloques: bloques.map((bloque) => ({
          comando: bloque.comando,
          carpeta: bloque.carpeta,
          rama: bloque.rama,
          inicio: new Date(bloque.inicio).toISOString(),
          duracion_ms: bloque.duracion,
          codigo: bloque.codigo,
          salida: recortar(bloque.texto, maximo),
        })),
        nota: panel.ocupado ? "Hay algo corriendo ahora: su salida en vivo está en leer_pantalla." : undefined,
      };
    }

    case "leer_pantalla": {
      const { pestana, panel } = ubicar(api, args.panel);
      return {
        panel: describirPanel(pestana, panel),
        pantalla: recortar(panel.textoPantalla(numero(args.lineas, 200, 1, 5000)), 200_000),
      };
    }

    case "ejecutar":
      return ejecutar(api, args);

    case "enviar_teclas": {
      const { panel } = ubicar(api, args.panel);
      let datos = typeof args.texto === "string" ? args.texto : "";
      const teclas = Array.isArray(args.teclas) ? args.teclas : [];
      for (const tecla of teclas) {
        const codigo = TECLAS[String(tecla).toLowerCase().replaceAll(" ", "")];
        if (!codigo) throw new Error(`Tecla desconocida: ${String(tecla)}`);
        datos += codigo;
      }
      if (!datos) throw new Error("Pasá texto o teclas");
      const soloCorte = datos === "\x03";
      if (!panel.ocupado && !soloCorte) {
        throw new Error("No hay ningún programa corriendo en ese panel. Para correr un comando usá ejecutar.");
      }
      if (!panel.escribirCrudo(datos)) throw new Error("El panel no tiene PowerShell abierto");
      await esperar(400);
      return { panel: panel.id, enviado: true, pantalla: recortar(panel.textoPantalla(60), MAXIMO_SALIDA) };
    }

    case "nueva_pestana": {
      const pestana = await api.nuevaPestana(texto(args.carpeta), texto(args.titulo));
      const panel = pestana.activo;
      const comando = texto(args.comando);
      if (comando) panel.ejecutarComando(comando);
      return { panel: panel.id, carpeta: panel.carpeta };
    }

    case "dividir_panel": {
      const { pestana, panel } = ubicar(api, args.panel);
      api.activar(pestana);
      pestana.activarPanel(panel);
      await pestana.dividir(args.direccion === "abajo" ? "columna" : "fila");
      const nuevo = pestana.activo;
      const comando = texto(args.comando);
      if (comando) nuevo.ejecutarComando(comando);
      return { panel: nuevo.id, carpeta: nuevo.carpeta };
    }

    case "cerrar_panel": {
      const { pestana, panel } = ubicar(api, args.panel);
      if (panel.ocupado && args.forzar !== true) {
        throw new Error(`El panel ${panel.id} tiene algo corriendo${panel.programa ? ` (${panel.programa})` : ""}. Pasá forzar=true para cerrarlo igual.`);
      }
      api.cerrarPanel(pestana, panel);
      return { cerrado: panel.id };
    }

    case "enfocar_panel": {
      const { pestana, panel } = ubicar(api, args.panel);
      api.activar(pestana);
      pestana.activarPanel(panel);
      panel.enfocar();
      return { panel: panel.id };
    }

    case "renombrar_pestana": {
      const { pestana } = ubicar(api, args.panel);
      api.renombrar(pestana, texto(args.titulo));
      return { titulo: pestana.titulo };
    }

    case "estado_agentes":
      return { agentes: api.agentes() };

    case "historial": {
      const filtro = texto(args.filtro)?.toLowerCase();
      const entradas = entradasHistorial().filter((entrada) => !filtro || entrada.comando.toLowerCase().includes(filtro));
      return {
        comandos: entradas.slice(-numero(args.cantidad, 50, 1, 1000)).map((entrada) => ({
          comando: entrada.comando,
          carpeta: entrada.carpeta,
          fecha: new Date(entrada.fecha).toISOString(),
          codigo: entrada.codigo,
        })),
      };
    }

    case "buscar_logs": {
      const maximo = numero(args.max_caracteres, 4000, 200, 100_000);
      const resultados = await buscarRegistros(
        typeof args.consulta === "string" ? args.consulta : "",
        numero(args.limite, 20, 1, 200),
        args.solo_errores === true,
      );
      return {
        resultados: resultados.map((registro) => ({
          comando: registro.comando,
          carpeta: registro.carpeta,
          host: registro.host,
          fecha: new Date(registro.inicio).toISOString(),
          codigo: registro.codigo,
          duracion_ms: registro.duracion,
          fragmento: registro.fragmento,
          salida: recortar(registro.texto, maximo),
        })),
      };
    }

    case "listar_tareas": {
      const carpeta = texto(args.carpeta) ?? api.activa()?.activo.carpeta ?? null;
      if (!carpeta) throw new Error("No hay una carpeta activa");
      return listarTareas(carpeta);
    }

    case "nueva_tarea": {
      const nombre = texto(args.nombre);
      if (!nombre) throw new Error("Falta el nombre de la tarea");
      const { pestana, tarea } = await api.crearTarea(
        {
          nombre,
          instrucciones: typeof args.instrucciones === "string" ? args.instrucciones : "",
          agente: texto(args.agente) ?? "claude",
        },
        texto(args.carpeta),
      );
      return { panel: pestana.activo.id, ...tarea };
    }

    case "unir_tarea":
    case "descartar_tarea": {
      const carpeta = texto(args.carpeta);
      if (!carpeta) throw new Error("Falta la carpeta de la tarea (está en listar_tareas)");
      return api.terminarTarea(carpeta, accion === "unir_tarea" ? "unir" : "descartar");
    }

    case "abrir_archivo": {
      const ruta = texto(args.ruta);
      if (!ruta) throw new Error("Falta la ruta");
      api.abrirArchivo(ruta);
      return { abierto: ruta };
    }

    default:
      throw new Error(`Acción desconocida: ${accion}`);
  }
}

// Solo la ventana principal atiende los pedidos de la IA.
export function iniciarControl(api: ApiControl): void {
  void listen<Pedido>("mahzz:control", async ({ payload }) => {
    let resultado: unknown;
    try {
      resultado = { ok: true, datos: await atender(api, payload.accion, payload.args ?? {}) };
    } catch (error) {
      resultado = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    await invoke("responder_control", { id: payload.id, resultado });
  });
}
