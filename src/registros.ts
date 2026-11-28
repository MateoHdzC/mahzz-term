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

export function iniciarRegistro(): void {
  window.addEventListener("mahzz:bloque-terminado", (evento) => {
    const registro = (evento as CustomEvent<Registro>).detail;
    if (!registro.comando.trim() || pareceSecreto(registro.comando)) return;
    void invoke("guardar_registro", { entrada: registro, dia: dia(registro.inicio) }).catch(() => undefined);
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
