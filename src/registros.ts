import { invoke } from "@tauri-apps/api/core";
import { avisar } from "./dialogos";
import { pareceSecreto } from "./historial";
import { t } from "./i18n";

export interface Registro {
  comando: string;
  carpeta: string | null;
  codigo: number;
  duracion: number;
  inicio: number;
  texto: string;
  host: string | null;
  fragmento?: string;
}

function dia(momento: number): string {
  const fecha = new Date(momento);
  const dos = (numero: number) => String(numero).padStart(2, "0");
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

const PATRONES_SECRETOS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g,
];

const ASIGNACION_SECRETA = /\b([A-Za-z0-9_.-]*(?:key|token|secret|password|passwd|pwd|credential)[A-Za-z0-9_.-]*["']?\s*[=:]\s*["']?)([^\s"',;]{6,})/gi;

export function ocultarSecretos(texto: string): string {
  let limpio = texto;
  for (const patron of PATRONES_SECRETOS) {
    limpio = limpio.replace(patron, (_coincidencia, prefijo?: string) =>
      prefijo && /^(Bearer|Basic)$/.test(prefijo) ? `${prefijo} [oculto]` : "[oculto]",
    );
  }
  return limpio.replace(ASIGNACION_SECRETA, (_, nombre: string) => `${nombre}[oculto]`);
}

export function iniciarRegistro(): void {
  window.addEventListener("mahzz:bloque-terminado", (evento) => {
    const registro = (evento as CustomEvent<Registro>).detail;
    if (!registro.comando.trim() || pareceSecreto(registro.comando)) return;
    const entrada: Registro = {
      ...registro,
      texto: ocultarSecretos(registro.texto),
      fragmento: registro.fragmento === undefined ? undefined : ocultarSecretos(registro.fragmento),
    };
    void invoke("guardar_registro", { entrada, dia: dia(registro.inicio) }).catch(() => undefined);
  });
}

export function buscarRegistros(consulta: string, limite = 50, soloErrores = false): Promise<Registro[]> {
  return invoke<Registro[]>("buscar_registros", { consulta, limite, soloErrores });
}

function fechaLegible(momento: number): string {
  return new Date(momento).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function abrirBuscadorRegistros(alUsarComando: (comando: string) => void, alCerrar: () => void): void {
  const dialogo = document.createElement("dialog");
  dialogo.className = "registros";

  const cabecera = document.createElement("div");
  cabecera.className = "registros__cabecera";
  const entrada = document.createElement("input");
  entrada.className = "registros__entrada";
  entrada.placeholder = t("Buscar en todos los logs (comandos y salidas)…");
  entrada.spellcheck = false;
  const errores = document.createElement("label");
  errores.className = "registros__filtro";
  const casilla = document.createElement("input");
  casilla.type = "checkbox";
  errores.append(casilla, t("Solo errores"));
  cabecera.append(entrada, errores);

  const lista = document.createElement("div");
  lista.className = "registros__lista";
  const ayuda = document.createElement("div");
  ayuda.className = "registros__ayuda";
  ayuda.textContent = t("Clic para ver la salida completa · Esc cierra");
  dialogo.append(cabecera, lista, ayuda);

  let consulta = 0;
  let temporizador = 0;
  const buscar = async () => {
    const propia = ++consulta;
    const resultados = await buscarRegistros(entrada.value, 80, casilla.checked).catch((error) => {
      avisar(String(error));
      return [] as Registro[];
    });
    if (propia !== consulta) return;
    lista.replaceChildren(...resultados.map((registro) => crearResultado(registro)));
    if (resultados.length === 0) {
      const vacio = document.createElement("div");
      vacio.className = "registros__vacio";
      vacio.textContent = entrada.value.trim() ? t("No encontré nada con eso.") : t("Todavía no hay logs guardados.");
      lista.append(vacio);
    }
  };

  const crearResultado = (registro: Registro): HTMLElement => {
    const fila = document.createElement("div");
    fila.className = `registro${registro.codigo !== 0 ? " registro--error" : ""}`;
    const encabezado = document.createElement("button");
    encabezado.type = "button";
    encabezado.className = "registro__encabezado";
    const comando = document.createElement("code");
    comando.className = "registro__comando";
    comando.textContent = registro.comando;
    const datos = document.createElement("span");
    datos.className = "registro__datos";
    const lugar = registro.host ? `${registro.host}:${registro.carpeta ?? ""}` : (registro.carpeta ?? "");
    datos.textContent = `${fechaLegible(registro.inicio)} · ${lugar} · ${t("código {0}", registro.codigo)}`;
    encabezado.append(comando, datos);
    if (registro.fragmento) {
      const fragmento = document.createElement("span");
      fragmento.className = "registro__fragmento";
      fragmento.textContent = registro.fragmento;
      encabezado.append(fragmento);
    }
    fila.append(encabezado);

    encabezado.addEventListener("click", () => {
      const abierto = fila.querySelector(".registro__detalle");
      if (abierto) {
        abierto.remove();
        return;
      }
      const detalle = document.createElement("div");
      detalle.className = "registro__detalle";
      const salida = document.createElement("pre");
      salida.textContent = registro.texto || t("(sin salida)");
      const acciones = document.createElement("div");
      acciones.className = "registro__acciones";
      const boton = (texto: string, accion: () => void) => {
        const elemento = document.createElement("button");
        elemento.type = "button";
        elemento.className = "boton";
        elemento.textContent = texto;
        elemento.addEventListener("click", accion);
        return elemento;
      };
      acciones.append(
        boton(t("Copiar salida"), () => void navigator.clipboard.writeText(registro.texto).then(() => avisar(t("Salida copiada")))),
        boton(t("Usar el comando"), () => {
          dialogo.close();
          alUsarComando(registro.comando);
        }),
      );
      detalle.append(salida, acciones);
      fila.append(detalle);
    });
    return fila;
  };

  entrada.addEventListener("input", () => {
    clearTimeout(temporizador);
    temporizador = window.setTimeout(() => void buscar(), 220);
  });
  casilla.addEventListener("change", () => void buscar());
  dialogo.addEventListener("keydown", (evento) => evento.stopPropagation());
  dialogo.addEventListener("click", (evento) => {
    if (evento.target === dialogo) dialogo.close();
  });
  dialogo.addEventListener("close", () => {
    dialogo.remove();
    alCerrar();
  });
  document.body.append(dialogo);
  dialogo.showModal();
  entrada.focus();
  void buscar();
}
