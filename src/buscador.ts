import { t } from "./i18n";
import type { ListaBloques } from "./bloques";

const RESALTADO = "mahzz-busqueda";
const RESALTADO_ACTUAL = "mahzz-busqueda-actual";
const MAXIMO_COINCIDENCIAS = 5000;

interface Coincidencia {
  rango: Range;
  lista: ListaBloques;
}

function crearExpresion(texto: string, comoRegex: boolean): RegExp | null {
  try {
    const patron = comoRegex ? texto : texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // La bandera m hace que ^ y $ funcionen en cada línea de la salida.
    return new RegExp(patron, "gimu");
  } catch {
    return null;
  }
}

function nodosDeTexto(raiz: HTMLElement): Text[] {
  const recorrido = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  const nodos: Text[] = [];
  while (recorrido.nextNode()) nodos.push(recorrido.currentNode as Text);
  return nodos;
}

// Busca dentro de los bloques sin modificar su contenido, usando resaltados nativos.
export class Buscador {
  readonly elemento = document.createElement("div");
  private readonly entrada = document.createElement("input");
  private readonly contador = document.createElement("span");
  private readonly botonRegex = document.createElement("button");
  private coincidencias: Coincidencia[] = [];
  private indice = -1;
  private comoRegex = false;
  private alcance: { lista: ListaBloques; id: number } | null = null;

  constructor(
    private readonly obtenerListas: () => ListaBloques[],
    private readonly alCerrar: () => void,
  ) {
    this.elemento.className = "buscador";
    this.elemento.hidden = true;
    this.elemento.setAttribute("role", "search");

    this.entrada.className = "buscador__entrada";
    this.entrada.placeholder = t("Buscar en los bloques");
    this.entrada.setAttribute("aria-label", t("Buscar en los bloques"));
    this.entrada.spellcheck = false;

    this.contador.className = "buscador__contador";
    this.contador.setAttribute("aria-live", "polite");

    this.botonRegex.type = "button";
    this.botonRegex.className = "buscador__boton";
    this.botonRegex.textContent = ".*";
    this.botonRegex.title = t("Usar expresión regular");
    this.botonRegex.setAttribute("aria-label", t("Usar expresión regular"));
    this.botonRegex.setAttribute("aria-pressed", "false");
    this.botonRegex.addEventListener("click", () => {
      this.comoRegex = !this.comoRegex;
      this.botonRegex.setAttribute("aria-pressed", String(this.comoRegex));
      this.entrada.focus();
      this.buscar();
    });

    this.elemento.append(
      this.entrada,
      this.contador,
      this.botonRegex,
      this.crearBoton("↑", t("Coincidencia anterior"), () => this.mover(-1)),
      this.crearBoton("↓", t("Coincidencia siguiente"), () => this.mover(1)),
      this.crearBoton("×", t("Cerrar búsqueda"), () => this.cerrar()),
    );

    this.entrada.addEventListener("input", () => this.buscar());
    this.elemento.addEventListener("keydown", (evento) => {
      evento.stopPropagation();
      if (evento.key === "Escape") this.cerrar();
      if (evento.key === "Enter") {
        evento.preventDefault();
        this.mover(evento.shiftKey ? -1 : 1);
      }
    });
  }

  private crearBoton(texto: string, descripcion: string, accion: () => void): HTMLButtonElement {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "buscador__boton";
    boton.textContent = texto;
    boton.title = descripcion;
    boton.setAttribute("aria-label", descripcion);
    boton.addEventListener("click", accion);
    return boton;
  }

  abrir(alcance: { lista: ListaBloques; id: number } | null = null): void {
    this.alcance = alcance;
    this.entrada.placeholder = alcance ? t("Buscar en este bloque") : t("Buscar en los bloques");
    this.elemento.hidden = false;
    this.entrada.focus();
    this.entrada.select();
    this.buscar();
  }

  cerrar(): void {
    if (this.elemento.hidden) return;
    this.elemento.hidden = true;
    this.coincidencias = [];
    this.indice = -1;
    CSS.highlights.delete(RESALTADO);
    CSS.highlights.delete(RESALTADO_ACTUAL);
    this.alCerrar();
  }

  private buscar(): void {
    this.coincidencias = [];
    this.indice = -1;
    const texto = this.entrada.value;
    const expresion = texto ? crearExpresion(texto, this.comoRegex) : null;
    this.entrada.classList.toggle("buscador__entrada--error", Boolean(texto) && !expresion);

    if (expresion) {
      const listas = this.alcance ? [this.alcance.lista] : this.obtenerListas();
      for (const lista of listas) {
        for (const zona of lista.zonasDeBusqueda(this.alcance?.id ?? null)) {
          this.buscarEnZona(zona, expresion, lista);
        }
      }
    }

    CSS.highlights.set(RESALTADO, new Highlight(...this.coincidencias.map(({ rango }) => rango)));
    if (this.coincidencias.length > 0) this.mover(1);
    else this.pintarActual();

    if (texto && !expresion) this.contador.textContent = t("Regex inválida");
  }

  private buscarEnZona(zona: HTMLElement, expresion: RegExp, lista: ListaBloques): void {
    const nodos = nodosDeTexto(zona);
    const contenido = nodos.map((nodo) => nodo.data).join("");

    const ubicar = (posicion: number): [Text, number] | null => {
      let acumulado = 0;
      for (const nodo of nodos) {
        if (posicion <= acumulado + nodo.length) return [nodo, posicion - acumulado];
        acumulado += nodo.length;
      }
      return null;
    };

    for (const resultado of contenido.matchAll(expresion)) {
      if (resultado[0].length === 0 || this.coincidencias.length >= MAXIMO_COINCIDENCIAS) continue;
      const inicio = ubicar(resultado.index);
      const fin = ubicar(resultado.index + resultado[0].length);
      if (!inicio || !fin) continue;
      const rango = new Range();
      rango.setStart(inicio[0], inicio[1]);
      rango.setEnd(fin[0], fin[1]);
      this.coincidencias.push({ rango, lista });
    }
  }

  private mover(paso: number): void {
    const total = this.coincidencias.length;
    if (total === 0) return;
    this.indice = this.indice < 0 ? 0 : (this.indice + paso + total) % total;
    this.pintarActual();
  }

  private pintarActual(): void {
    const total = this.coincidencias.length;
    this.contador.textContent = this.entrada.value ? `${total ? this.indice + 1 : 0}/${total}` : "";

    const actual = this.coincidencias[this.indice];
    if (!actual) {
      CSS.highlights.delete(RESALTADO_ACTUAL);
      return;
    }
    CSS.highlights.set(RESALTADO_ACTUAL, new Highlight(actual.rango));
    actual.lista.expandirQueContiene(actual.rango.startContainer);

    const caja = actual.rango.getBoundingClientRect();
    const visible = actual.lista.elemento.getBoundingClientRect();
    if (caja.top < visible.top + 8 || caja.bottom > visible.bottom - 8) {
      actual.lista.desplazar(caja.top - visible.top - visible.height / 2);
    }
  }
}
