import { t } from "./i18n";
import type { Completion, CompletionResult } from "@codemirror/autocomplete";
import { invoke } from "@tauri-apps/api/core";
import type { VerificadorComandos } from "./comandos";
import { entradasHistorial } from "./historial";

type Generador = "ramas" | "remotos" | "scripts" | "rutas" | "hosts";

interface OpcionSpec {
  nombre: string;
  descripcion?: string;
}

interface NodoSpec extends OpcionSpec {
  alias?: string[];
  argumentos?: Generador[];
  opciones?: OpcionSpec[];
  subcomandos?: NodoSpec[];
}

interface DatosProyecto {
  ramas: string[];
  remotos: string[];
  scripts: string[];
}

export interface Sugerencias extends CompletionResult {
  parcial: string;
}

interface LineaAnalizada {
  argumentos: string[];
  parcial: string;
  desde: number;
}

const VIGENCIA_PROYECTO = 4000;
const MAXIMO_OPCIONES = 300;
const NOMBRE_SIMPLE = /^[\w.-]*$/;

const specsIncluidos = import.meta.glob<NodoSpec>("./specs/*.json", { eager: true, import: "default" });
const specs = new Map<string, NodoSpec>(
  Object.values(specsIncluidos).map((spec) => [spec.nombre.toLowerCase(), spec]),
);
let specsUsuario: Promise<void> | null = null;

function cargarSpecsUsuario(): Promise<void> {
  specsUsuario ??= invoke<NodoSpec[]>("leer_specs_usuario").then((lista) => {
    for (const spec of lista) {
      if (typeof spec?.nombre === "string") specs.set(spec.nombre.toLowerCase(), spec);
    }
  });
  return specsUsuario;
}

export function analizarLinea(texto: string, posicion: number): LineaAnalizada {
  let argumentos: string[] = [];
  let actual = "";
  let inicio = 0;
  let comilla = "";

  for (let i = 0; i < posicion; i++) {
    const caracter = texto[i];
    if (comilla) {
      if (caracter === comilla) comilla = "";
      else actual += caracter;
    } else if (caracter === "'" || caracter === '"') {
      if (!actual) inicio = i;
      comilla = caracter;
    } else if (/[|;(){}\n]/.test(caracter) || (caracter === "&" && texto[i + 1] === "&")) {
      argumentos = [];
      actual = "";
      inicio = i + 1;
    } else if (/\s/.test(caracter)) {
      if (actual) argumentos.push(actual);
      actual = "";
      inicio = i + 1;
    } else {
      if (!actual) inicio = i;
      actual += caracter;
    }
  }
  return { argumentos, parcial: actual, desde: inicio };
}

function opcion(nombre: string, detalle: string | undefined, tipo: string, boost = 0): Completion {
  return { label: nombre, detail: detalle, type: tipo, boost, apply: `${nombre} ` };
}

export class MotorAutocompletado {
  private ejecutables: { ruta: string | null; nombres: string[] } | null = null;
  private proyecto: { carpeta: string; fecha: number; datos: DatosProyecto } | null = null;

  constructor(
    private readonly obtenerCarpeta: () => string | null,
    private readonly verificador: VerificadorComandos,
  ) {}

  async sugerir(texto: string, posicion: number): Promise<Sugerencias | null> {
    if (this.verificador.enRemoto) return null;
    await cargarSpecsUsuario();
    const linea = analizarLinea(texto, posicion);
    const { argumentos, parcial } = linea;
    const pareceRuta = /[\\/]/.test(parcial) || parcial.startsWith(".") || parcial.startsWith("~");

    if (argumentos.length === 0) {
      if (pareceRuta) return this.rutas(linea);
      return this.resultado(await this.comandos(parcial), linea);
    }

    const comando = argumentos[0].toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
    const spec = specs.get(comando);
    if (spec && !pareceRuta) {
      const opciones = await this.desdeSpec(spec, argumentos.slice(1), parcial);
      const resultado = opciones && this.resultado(opciones, linea);
      if (resultado) return resultado;
    }
    if (parcial.startsWith("-") && !spec) {
      const parametros = await invoke<string[]>("parametros_cmdlet", { nombre: argumentos[0] });
      return this.resultado(parametros.map((nombre) => opcion(`-${nombre}`, t("Parámetro"), "property")), linea);
    }
    return this.rutas(linea);
  }

  private resultado(opciones: Completion[], linea: LineaAnalizada): Sugerencias | null {
    const parcial = linea.parcial.toLowerCase();
    const filtradas = opciones.filter((actual) => actual.label.toLowerCase().includes(parcial));
    if (filtradas.length === 0) return null;
    return {
      from: linea.desde,
      options: filtradas.slice(0, MAXIMO_OPCIONES),
      validFor: NOMBRE_SIMPLE,
      parcial,
    };
  }

  private async comandos(parcial: string): Promise<Completion[]> {
    const ruta = this.verificador.rutaActual;
    if (!this.ejecutables || this.ejecutables.ruta !== ruta) {
      this.ejecutables = { ruta, nombres: await invoke<string[]>("listar_ejecutables", { ruta }) };
    }

    const usados = new Set<string>();
    for (const { comando } of entradasHistorial()) {
      const primera = comando.trim().split(/\s+/)[0];
      if (primera) usados.add(primera.toLowerCase());
    }

    const opciones = new Map<string, Completion>();
    const agregar = (nombre: string, detalle: string, tipo: string) => {
      const clave = nombre.toLowerCase();
      if (opciones.has(clave) || (parcial && !clave.includes(parcial.toLowerCase()))) return;
      opciones.set(clave, opcion(nombre, detalle, tipo, usados.has(clave) ? 20 : 0));
    };
    for (const spec of specs.values()) agregar(spec.nombre, spec.descripcion ?? t("Programa"), "class");
    for (const nombre of this.verificador.nombresConocidos()) agregar(nombre, "PowerShell", "function");
    for (const nombre of this.ejecutables.nombres) agregar(nombre, t("Programa"), "class");
    return [...opciones.values()];
  }

  private async desdeSpec(raiz: NodoSpec, argumentos: string[], parcial: string): Promise<Completion[] | null> {
    let nodo = raiz;
    const opcionesAcumuladas = [...(raiz.opciones ?? [])];
    for (const argumento of argumentos) {
      if (argumento.startsWith("-")) continue;
      const clave = argumento.toLowerCase();
      const siguiente = nodo.subcomandos?.find(
        (sub) => sub.nombre === clave || sub.alias?.includes(clave),
      );
      if (!siguiente) continue;
      nodo = siguiente;
      opcionesAcumuladas.push(...(siguiente.opciones ?? []));
    }

    if (parcial.startsWith("-")) {
      return opcionesAcumuladas.map((actual) => opcion(actual.nombre, actual.descripcion, "property"));
    }

    const lista = (nodo.subcomandos ?? []).map((sub) => opcion(sub.nombre, sub.descripcion, "method", 10));
    if (nodo.argumentos?.includes("hosts")) {
      for (const host of await invoke<string[]>("hosts_ssh")) lista.push(opcion(host, t("Servidor"), "variable", 15));
    }
    const detalles = { ramas: t("Rama"), remotos: t("Remoto"), scripts: t("Script") } as const;
    const generadores = (nodo.argumentos ?? []).filter(
      (generador): generador is keyof DatosProyecto => generador in detalles,
    );
    if (generadores.length > 0) {
      const datos = await this.datosProyecto();
      for (const generador of generadores) {
        for (const nombre of datos[generador]) lista.push(opcion(nombre, detalles[generador], "variable", 15));
      }
    }
    const coincide = lista.some((actual) => actual.label.toLowerCase().startsWith(parcial.toLowerCase()));
    return coincide || !nodo.argumentos?.includes("rutas") ? lista : null;
  }

  private async datosProyecto(): Promise<DatosProyecto> {
    const carpeta = this.obtenerCarpeta();
    if (!carpeta) return { ramas: [], remotos: [], scripts: [] };
    if (this.proyecto?.carpeta === carpeta && Date.now() - this.proyecto.fecha < VIGENCIA_PROYECTO) {
      return this.proyecto.datos;
    }
    const datos = await invoke<DatosProyecto>("datos_proyecto", { carpeta });
    this.proyecto = { carpeta, fecha: Date.now(), datos };
    return datos;
  }

  private async rutas(linea: LineaAnalizada): Promise<Sugerencias | null> {
    const { parcial, desde } = linea;
    const lista = await invoke<{ nombre: string; directorio: boolean }[]>("listar_rutas", {
      parcial,
      carpeta: this.obtenerCarpeta(),
    });
    if (lista.length === 0) return null;

    const corte = Math.max(parcial.lastIndexOf("\\"), parcial.lastIndexOf("/")) + 1;
    const base = parcial.slice(0, corte);
    const options: Completion[] = lista.map(({ nombre, directorio }) => {
      const completa = `${base}${nombre}`;
      const conEspacios = /\s/.test(completa);
      const escapada = completa.replaceAll("'", "''");
      const aplicar = directorio
        ? `${conEspacios ? "'" : ""}${conEspacios ? escapada : completa}\\`
        : conEspacios
          ? `'${escapada}' `
          : `${completa} `;
      return {
        label: completa,
        displayLabel: directorio ? `${nombre}\\` : nombre,
        detail: directorio ? t("Carpeta") : t("Archivo"),
        type: directorio ? "namespace" : "text",
        apply: aplicar,
      };
    });
    return { from: desde, options, filter: false, parcial: parcial.toLowerCase() };
  }
}
