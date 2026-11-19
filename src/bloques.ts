import { t } from "./i18n";
import { invoke } from "@tauri-apps/api/core";
import { abrirMenu, avisar, type OpcionMenu } from "./dialogos";
import { abrirEnlace, decorarEnlaces } from "./enlaces";

export interface DatosBloque {
  id: number;
  tipo: "comando" | "inicio";
  comando: string;
  carpeta: string | null;
  rama: string | null;
  inicio: number;
  duracion: number;
  codigo: number;
  lineasHtml: string[];
  texto: string;
  colapsado: boolean;
}

export interface EventosBloques {
  alEjecutar(comando: string): void;
  alBuscarEn(id: number): void;
  alEnfocarTerminal(): void;
  puedeEjecutar(): boolean;
}

interface BloqueVisible {
  datos: DatosBloque;
  elemento: HTMLElement;
  salida: HTMLElement | null;
  mostrandoTodo: boolean;
}

const MAXIMO_BLOQUES = 500;
const LINEAS_VISIBLES = 1000;

const ICONOS = {
  flecha: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" /></svg>',
  copiar:
    '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1" /><path d="M8 2V2a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1" /></svg>',
  repetir:
    '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M10.5 6a4.5 4.5 0 1 1-1.4-3.3M10.5 1v2.5H8" /></svg>',
  mas: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="2" cy="6" r=".6" /><circle cx="6" cy="6" r=".6" /><circle cx="10" cy="6" r=".6" /></svg>',
};

function nombreCarpeta(ruta: string): string {
  return ruta.split(/[\\/]/).filter(Boolean).at(-1) ?? ruta;
}

export function formatoDuracion(milisegundos: number): string {
  if (milisegundos < 1000) return `${Math.round(milisegundos)} ms`;
  const segundos = milisegundos / 1000;
  if (segundos < 60) return `${segundos.toLocaleString("es", { maximumFractionDigits: 1 })} s`;
  const minutos = Math.floor(segundos / 60);
  return `${minutos} min ${Math.round(segundos - minutos * 60)} s`;
}

function formatoHora(fecha: number): string {
  return new Date(fecha).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function crearBoton(icono: string, texto: string, accion: (evento: MouseEvent) => void): HTMLButtonElement {
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "bloque__boton";
  boton.title = texto;
  boton.setAttribute("aria-label", texto);
  boton.innerHTML = icono;
  boton.addEventListener("click", (evento) => {
    evento.stopPropagation();
    accion(evento);
  });
  return boton;
}

export class ListaBloques {
  readonly elemento = document.createElement("div");
  private readonly interior = document.createElement("div");
  private bloques: BloqueVisible[] = [];
  private seleccionado: BloqueVisible | null = null;
  private ultimoId = 0;

  constructor(private readonly eventos: EventosBloques) {
    this.elemento.className = "bloques";
    this.elemento.tabIndex = -1;
    this.interior.className = "bloques__interior";
    this.elemento.append(this.interior);

    this.elemento.addEventListener("keydown", (evento) => this.alPresionarTecla(evento));
    this.elemento.addEventListener("mouseup", () => {
      if (!this.haySeleccionDeTexto()) this.eventos.alEnfocarTerminal();
    });
  }

  get cantidad(): number {
    return this.bloques.length;
  }

  get hayBloqueSeleccionado(): boolean {
    return this.seleccionado !== null;
  }

  private haySeleccionDeTexto(): boolean {
    const seleccion = window.getSelection();
    return Boolean(seleccion && !seleccion.isCollapsed && this.elemento.contains(seleccion.anchorNode));
  }

  // Con texto marcado, Ctrl+C copia. Cualquier otra tecla vuelve a la terminal.
  private alPresionarTecla(evento: KeyboardEvent): void {
    const copiar = evento.ctrlKey && !evento.shiftKey && evento.key.toLowerCase() === "c";
    if (copiar && this.haySeleccionDeTexto()) {
      evento.preventDefault();
      void navigator.clipboard.writeText(window.getSelection()?.toString() ?? "");
      window.getSelection()?.removeAllRanges();
      this.eventos.alEnfocarTerminal();
      return;
    }
    if (!["Control", "Shift", "Alt", "Meta"].includes(evento.key)) this.eventos.alEnfocarTerminal();
  }

  agregar(datos: Omit<DatosBloque, "id" | "colapsado"> & { id?: number; colapsado?: boolean }): void {
    const completo: DatosBloque = {
      ...datos,
      id: datos.id ?? ++this.ultimoId,
      colapsado: datos.colapsado ?? false,
    };
    this.ultimoId = Math.max(this.ultimoId, completo.id);

    const bloque = this.dibujar(completo);
    this.bloques.push(bloque);
    this.interior.append(bloque.elemento);

    if (this.bloques.length > MAXIMO_BLOQUES) {
      const viejo = this.bloques.shift();
      if (viejo === this.seleccionado) this.seleccionado = null;
      viejo?.elemento.remove();
    }
    this.irAlFinal();
  }

  vaciar(): void {
    this.bloques = [];
    this.seleccionado = null;
    this.interior.replaceChildren();
  }

  exportar(): DatosBloque[] {
    return this.bloques.map((bloque) => bloque.datos);
  }

  irAlFinal(): void {
    this.elemento.scrollTop = this.elemento.scrollHeight;
  }

  desplazar(distancia: number): void {
    this.elemento.scrollTop += distancia;
  }

  private dibujar(datos: DatosBloque): BloqueVisible {
    const elemento = document.createElement("article");
    elemento.className = "bloque";
    elemento.dataset.id = String(datos.id);
    elemento.classList.toggle("bloque--error", datos.codigo !== 0);
    elemento.classList.toggle("bloque--inicio", datos.tipo === "inicio");
    elemento.classList.toggle("bloque--colapsado", datos.colapsado);

    const bloque: BloqueVisible = { datos, elemento, salida: null, mostrandoTodo: false };

    if (datos.tipo === "comando") elemento.append(this.dibujarEncabezado(bloque));

    if (datos.lineasHtml.length > 0) {
      const salida = document.createElement("pre");
      salida.className = "bloque__salida";
      bloque.salida = salida;
      elemento.append(salida);
      this.pintarSalida(bloque);
    }

    elemento.addEventListener("click", (evento) => {
      const enlace = (evento.target as HTMLElement).closest(".enlace");
      if (enlace && evento.ctrlKey) {
        void abrirEnlace(enlace.textContent ?? "", datos.carpeta, (comando) => {
          window.dispatchEvent(new CustomEvent("mahzz:poner-comando", { detail: comando }));
        });
        return;
      }
      if (!this.haySeleccionDeTexto()) this.seleccionar(bloque);
    });
    elemento.addEventListener("contextmenu", (evento) => {
      evento.preventDefault();
      evento.stopPropagation();
      if (datos.tipo !== "comando") return;
      this.seleccionar(bloque);
      this.abrirAcciones(bloque, evento.clientX, evento.clientY);
    });
    return bloque;
  }

  private dibujarEncabezado(bloque: BloqueVisible): HTMLElement {
    const { datos } = bloque;
    const encabezado = document.createElement("header");
    encabezado.className = "bloque__encabezado";

    const colapsar = crearBoton(ICONOS.flecha, t("Colapsar o expandir"), () => this.alternarColapso(bloque));
    colapsar.classList.add("bloque__colapsar");
    colapsar.disabled = datos.lineasHtml.length === 0;

    const textos = document.createElement("div");
    textos.className = "bloque__textos";

    const meta = document.createElement("div");
    meta.className = "bloque__meta";
    const partes: { texto: string; clase?: string; titulo?: string }[] = [];
    if (datos.carpeta) partes.push({ texto: nombreCarpeta(datos.carpeta), titulo: datos.carpeta });
    if (datos.rama) partes.push({ texto: datos.rama, clase: "bloque__rama" });
    partes.push({ texto: formatoHora(datos.inicio) });
    partes.push({ texto: formatoDuracion(datos.duracion), clase: "bloque__duracion" });
    if (datos.codigo !== 0) partes.push({ texto: t("código {0}", datos.codigo), clase: "bloque__codigo" });
    for (const parte of partes) {
      const pieza = document.createElement("span");
      pieza.textContent = parte.texto;
      if (parte.clase) pieza.className = parte.clase;
      if (parte.titulo) pieza.title = parte.titulo;
      meta.append(pieza);
    }

    const comando = document.createElement("div");
    comando.className = "bloque__comando";
    comando.textContent = datos.comando;
    textos.append(meta, comando);

    const acciones = document.createElement("div");
    acciones.className = "bloque__acciones";
    acciones.append(
      crearBoton(ICONOS.copiar, t("Copiar salida"), () => void this.copiar(datos.texto, t("Salida copiada"))),
      crearBoton(ICONOS.repetir, t("Volver a ejecutar"), () => this.reejecutar(bloque)),
      crearBoton(ICONOS.mas, t("Más acciones"), (evento) => {
        this.seleccionar(bloque);
        this.abrirAcciones(bloque, evento.clientX, evento.clientY);
      }),
    );

    encabezado.append(colapsar, textos, acciones);
    return encabezado;
  }

  private pintarSalida(bloque: BloqueVisible): void {
    const { salida, datos } = bloque;
    if (!salida) return;
    const total = datos.lineasHtml.length;
    const ocultas = bloque.mostrandoTodo ? 0 : Math.max(0, total - LINEAS_VISIBLES);

    salida.innerHTML = datos.lineasHtml.slice(ocultas).join("\n");
    decorarEnlaces(salida, datos.carpeta?.startsWith("/") ?? false);
    if (ocultas > 0) {
      const mostrar = document.createElement("button");
      mostrar.type = "button";
      mostrar.className = "bloque__mostrar";
      mostrar.textContent = t("Mostrar {0} líneas anteriores", ocultas.toLocaleString("es"));
      mostrar.addEventListener("click", (evento) => {
        evento.stopPropagation();
        this.mostrarCompleto(bloque);
      });
      salida.before(mostrar);
    }
  }

  private mostrarCompleto(bloque: BloqueVisible): void {
    if (bloque.mostrandoTodo) return;
    bloque.mostrandoTodo = true;
    bloque.elemento.querySelector(".bloque__mostrar")?.remove();
    this.pintarSalida(bloque);
  }

  private alternarColapso(bloque: BloqueVisible): void {
    this.definirColapso(bloque, !bloque.datos.colapsado);
  }

  private definirColapso(bloque: BloqueVisible, colapsado: boolean): void {
    bloque.datos.colapsado = colapsado;
    bloque.elemento.classList.toggle("bloque--colapsado", colapsado);
  }

  private reejecutar(bloque: BloqueVisible): void {
    if (this.eventos.puedeEjecutar()) this.eventos.alEjecutar(bloque.datos.comando);
    else avisar(t("Esperá a que termine el comando actual"));
  }

  private async copiar(texto: string, aviso: string): Promise<void> {
    await navigator.clipboard.writeText(texto);
    avisar(aviso);
    this.eventos.alEnfocarTerminal();
  }

  private async guardar(bloque: BloqueVisible): Promise<void> {
    const base = bloque.datos.comando.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40);
    try {
      const ruta = await invoke<string | null>("guardar_salida", {
        nombre: `${base || "salida"}.txt`,
        contenido: bloque.datos.texto,
      });
      if (ruta) avisar(t("Guardado en {0}", ruta));
    } catch (error) {
      avisar(t("No se pudo guardar: {0}", String(error)));
    }
    this.eventos.alEnfocarTerminal();
  }

  private abrirAcciones(bloque: BloqueVisible, x: number, y: number): void {
    const { datos } = bloque;
    const sinSalida = datos.lineasHtml.length === 0;
    const opciones: OpcionMenu[] = [
      { texto: t("Copiar comando"), accion: () => void this.copiar(datos.comando, t("Comando copiado")) },
      { texto: t("Copiar salida"), accion: () => void this.copiar(datos.texto, t("Salida copiada")), desactivada: sinSalida },
      {
        texto: t("Copiar comando y salida"),
        accion: () => void this.copiar(`${datos.comando}\n${datos.texto}`, t("Bloque copiado")),
      },
      {
        texto: datos.colapsado ? t("Expandir") : t("Colapsar"),
        accion: () => this.alternarColapso(bloque),
        desactivada: sinSalida,
      },
      { texto: t("Volver a ejecutar"), accion: () => this.reejecutar(bloque) },
      {
        texto: t("Guardar comando"),
        accion: () => window.dispatchEvent(new CustomEvent("mahzz:guardar-comando", { detail: datos.comando })),
      },
      { texto: t("Buscar en este bloque"), accion: () => this.eventos.alBuscarEn(datos.id), desactivada: sinSalida },
      { texto: t("Guardar salida en archivo"), accion: () => void this.guardar(bloque), desactivada: sinSalida },
    ];
    abrirMenu(x, y, { opciones }, () => this.eventos.alEnfocarTerminal());
  }

  private seleccionar(bloque: BloqueVisible | null): void {
    this.seleccionado?.elemento.classList.remove("bloque--seleccionado");
    this.seleccionado = bloque;
    bloque?.elemento.classList.add("bloque--seleccionado");
    bloque?.elemento.scrollIntoView({ block: "nearest" });
  }

  deseleccionar(): void {
    this.seleccionar(null);
  }

  // Sin selección, la flecha hacia arriba empieza por el último bloque.
  moverSeleccion(paso: number): void {
    const conComando = this.bloques.filter((bloque) => bloque.datos.tipo === "comando");
    if (conComando.length === 0) return;
    const actual = this.seleccionado ? conComando.indexOf(this.seleccionado) : conComando.length;
    const destino = Math.max(0, Math.min(conComando.length - 1, actual + paso));
    this.seleccionar(conComando[destino]);
  }

  // Devuelve los textos donde se puede buscar, con todas sus líneas ya dibujadas.
  zonasDeBusqueda(id: number | null): HTMLElement[] {
    const zonas: HTMLElement[] = [];
    for (const bloque of this.bloques) {
      if (id !== null && bloque.datos.id !== id) continue;
      this.mostrarCompleto(bloque);
      const comando = bloque.elemento.querySelector<HTMLElement>(".bloque__comando");
      if (comando) zonas.push(comando);
      if (bloque.salida) zonas.push(bloque.salida);
    }
    return zonas;
  }

  expandirQueContiene(nodo: Node): void {
    const bloque = this.bloques.find((actual) => actual.elemento.contains(nodo));
    if (bloque?.datos.colapsado) this.definirColapso(bloque, false);
  }
}
