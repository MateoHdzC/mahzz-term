import type { Panel } from "./panel";

export type Direccion = "fila" | "columna";

export interface NodoPanel {
  tipo: "panel";
  panel: Panel;
}

export interface NodoDivision {
  tipo: "division";
  direccion: Direccion;
  proporcion: number;
  a: Nodo;
  b: Nodo;
}

export type Nodo = NodoPanel | NodoDivision;

const TAMANO_MINIMO = 120;

export function listarPaneles(nodo: Nodo): Panel[] {
  return nodo.tipo === "panel"
    ? [nodo.panel]
    : [...listarPaneles(nodo.a), ...listarPaneles(nodo.b)];
}

export function dividirPanel(
  nodo: Nodo,
  objetivo: Panel,
  nuevo: Panel,
  direccion: Direccion,
): Nodo {
  if (nodo.tipo === "panel") {
    if (nodo.panel !== objetivo) return nodo;
    return {
      tipo: "division",
      direccion,
      proporcion: 0.5,
      a: nodo,
      b: { tipo: "panel", panel: nuevo },
    };
  }
  nodo.a = dividirPanel(nodo.a, objetivo, nuevo, direccion);
  nodo.b = dividirPanel(nodo.b, objetivo, nuevo, direccion);
  return nodo;
}

export function quitarPanel(nodo: Nodo, objetivo: Panel): Nodo | null {
  if (nodo.tipo === "panel") return nodo.panel === objetivo ? null : nodo;
  const a = quitarPanel(nodo.a, objetivo);
  const b = quitarPanel(nodo.b, objetivo);
  if (!a) return b;
  if (!b) return a;
  nodo.a = a;
  nodo.b = b;
  return nodo;
}

function aplicarProporcion(a: HTMLElement, b: HTMLElement, proporcion: number): void {
  a.style.flex = `${proporcion} 1 0`;
  b.style.flex = `${1 - proporcion} 1 0`;
}

function crearSeparador(
  nodo: NodoDivision,
  contenedor: HTMLElement,
  a: HTMLElement,
  b: HTMLElement,
): HTMLElement {
  const separador = document.createElement("div");
  separador.className = "separador";
  separador.setAttribute("role", "separator");
  separador.setAttribute("aria-orientation", nodo.direccion === "fila" ? "vertical" : "horizontal");

  separador.addEventListener("pointerdown", (inicio) => {
    inicio.preventDefault();
    separador.setPointerCapture(inicio.pointerId);
    separador.classList.add("separador--activo");

    const mover = (evento: PointerEvent) => {
      const caja = contenedor.getBoundingClientRect();
      const total = nodo.direccion === "fila" ? caja.width : caja.height;
      const posicion =
        nodo.direccion === "fila" ? evento.clientX - caja.left : evento.clientY - caja.top;
      const minimo = Math.min(TAMANO_MINIMO / total, 0.5);
      nodo.proporcion = Math.min(1 - minimo, Math.max(minimo, posicion / total));
      aplicarProporcion(a, b, nodo.proporcion);
    };
    const soltar = () => {
      separador.classList.remove("separador--activo");
      separador.removeEventListener("pointermove", mover);
      separador.removeEventListener("pointerup", soltar);
      separador.removeEventListener("pointercancel", soltar);
    };
    separador.addEventListener("pointermove", mover);
    separador.addEventListener("pointerup", soltar);
    separador.addEventListener("pointercancel", soltar);
  });
  return separador;
}

export function dibujarNodo(nodo: Nodo): HTMLElement {
  if (nodo.tipo === "panel") return nodo.panel.elemento;

  const contenedor = document.createElement("div");
  contenedor.className = `division division--${nodo.direccion}`;
  const a = dibujarNodo(nodo.a);
  const b = dibujarNodo(nodo.b);
  aplicarProporcion(a, b, nodo.proporcion);
  contenedor.append(a, crearSeparador(nodo, contenedor, a, b), b);
  return contenedor;
}
