import { t } from "./i18n";
export interface ItemSelector {
  id: string;
  titulo: string;
  detalle?: string;
  seccion?: string;
  atajo?: string;
  estado?: "ok" | "error";
  prioridad?: number;
  alElegir: () => void;
}

export interface OpcionesSelector {
  etiqueta: string;
  ayuda: string;
  items: ItemSelector[];
  alCerrar: () => void;
  // Permite teclas extra. Devuelve true si la tecla ya se usó.
  alTecla?: (evento: KeyboardEvent, item: ItemSelector | null, cerrar: () => void) => boolean;
}

interface Coincidencia {
  puntaje: number;
  posiciones: number[];
}

const MAXIMO_VISIBLES = 80;

// Búsqueda aproximada: las letras deben aparecer en orden y premia las que van seguidas.
export function puntuar(consulta: string, texto: string): Coincidencia | null {
  const buscado = consulta.toLowerCase();
  const destino = texto.toLowerCase();
  const posiciones: number[] = [];
  let puntaje = 0;
  let desde = 0;

  for (const letra of buscado) {
    if (letra === " ") continue;
    const indice = destino.indexOf(letra, desde);
    if (indice < 0) return null;
    const anterior = posiciones.at(-1);
    puntaje += anterior === indice - 1 ? 8 : 1;
    if (indice === 0 || /[\s\\/\-_.]/.test(texto[indice - 1])) puntaje += 5;
    posiciones.push(indice);
    desde = indice + 1;
  }
  if (destino.includes(buscado)) puntaje += 30;
  return { puntaje: puntaje - texto.length / 200, posiciones };
}

function tituloResaltado(titulo: string, posiciones: number[]): DocumentFragment {
  const fragmento = document.createDocumentFragment();
  const marcadas = new Set(posiciones);
  let tramo = "";
  let resaltando = false;

  const cerrar = () => {
    if (!tramo) return;
    if (resaltando) {
      const marca = document.createElement("mark");
      marca.textContent = tramo;
      fragmento.append(marca);
    } else {
      fragmento.append(tramo);
    }
    tramo = "";
  };
  [...titulo].forEach((letra, indice) => {
    const marcada = marcadas.has(indice);
    if (marcada !== resaltando) {
      cerrar();
      resaltando = marcada;
    }
    tramo += letra;
  });
  cerrar();
  return fragmento;
}

export function abrirSelector(opciones: OpcionesSelector): void {
  const dialogo = document.createElement("dialog");
  dialogo.className = "selector";

  const entrada = document.createElement("input");
  entrada.className = "selector__entrada";
  entrada.placeholder = opciones.etiqueta;
  entrada.setAttribute("aria-label", opciones.etiqueta);
  entrada.spellcheck = false;

  const lista = document.createElement("div");
  lista.className = "selector__lista";
  lista.setAttribute("role", "listbox");
  lista.setAttribute("aria-label", opciones.etiqueta);

  const ayuda = document.createElement("div");
  ayuda.className = "selector__ayuda";
  ayuda.textContent = opciones.ayuda;

  dialogo.append(entrada, lista, ayuda);

  let visibles: ItemSelector[] = [];
  let indice = 0;
  let elegido: ItemSelector | null = null;

  const cerrar = () => dialogo.close();
  const elegir = (item: ItemSelector | undefined) => {
    if (!item) return;
    elegido = item;
    cerrar();
  };

  const pintarActivo = () => {
    lista.querySelectorAll<HTMLElement>(".selector__item").forEach((fila, posicion) => {
      const activa = posicion === indice;
      fila.classList.toggle("selector__item--activo", activa);
      fila.setAttribute("aria-selected", String(activa));
      if (activa) fila.scrollIntoView({ block: "nearest" });
    });
  };

  const dibujar = () => {
    const consulta = entrada.value.trim();
    const resultados = opciones.items
      .map((item) => ({
        item,
        coincidencia: consulta ? puntuar(consulta, item.titulo) : { puntaje: 0, posiciones: [] },
      }))
      .filter((actual): actual is { item: ItemSelector; coincidencia: Coincidencia } => actual.coincidencia !== null);
    if (consulta) {
      resultados.sort(
        (a, b) =>
          b.coincidencia.puntaje + (b.item.prioridad ?? 0) - (a.coincidencia.puntaje + (a.item.prioridad ?? 0)),
      );
    }

    const recortados = resultados.slice(0, MAXIMO_VISIBLES);
    visibles = recortados.map(({ item }) => item);
    indice = 0;
    lista.replaceChildren();

    let seccionActual: string | undefined;
    for (const { item, coincidencia } of recortados) {
      if (!consulta && item.seccion && item.seccion !== seccionActual) {
        seccionActual = item.seccion;
        const titulo = document.createElement("div");
        titulo.className = "selector__seccion";
        titulo.textContent = item.seccion;
        lista.append(titulo);
      }

      const fila = document.createElement("div");
      fila.className = "selector__item";
      fila.setAttribute("role", "option");

      if (item.estado) {
        const estado = document.createElement("span");
        estado.className = `selector__estado selector__estado--${item.estado}`;
        estado.setAttribute("aria-label", item.estado === "ok" ? t("Terminó bien") : t("Terminó con error"));
        fila.append(estado);
      }

      const textos = document.createElement("div");
      textos.className = "selector__textos";
      const titulo = document.createElement("div");
      titulo.className = "selector__titulo";
      titulo.append(tituloResaltado(item.titulo, coincidencia.posiciones));
      textos.append(titulo);
      if (item.detalle) {
        const detalle = document.createElement("div");
        detalle.className = "selector__detalle";
        detalle.textContent = item.detalle;
        textos.append(detalle);
      }
      fila.append(textos);

      if (item.atajo) {
        const atajo = document.createElement("kbd");
        atajo.className = "selector__atajo";
        atajo.textContent = item.atajo;
        fila.append(atajo);
      }
      fila.addEventListener("click", () => elegir(item));
      lista.append(fila);
    }

    if (visibles.length === 0) {
      const vacio = document.createElement("div");
      vacio.className = "selector__vacio";
      vacio.textContent = consulta ? t("Sin resultados") : t("Todavía no hay nada para mostrar");
      lista.append(vacio);
    }
    pintarActivo();
  };

  entrada.addEventListener("input", dibujar);
  entrada.addEventListener("keydown", (evento) => {
    evento.stopPropagation();
    if (opciones.alTecla?.(evento, visibles[indice] ?? null, cerrar)) {
      evento.preventDefault();
      return;
    }
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      if (visibles.length === 0) return;
      const paso = evento.key === "ArrowDown" ? 1 : -1;
      indice = (indice + paso + visibles.length) % visibles.length;
      pintarActivo();
    } else if (evento.key === "Enter") {
      evento.preventDefault();
      elegir(visibles[indice]);
    }
  });
  dialogo.addEventListener("click", (evento) => {
    if (evento.target === dialogo) cerrar();
  });
  dialogo.addEventListener("close", () => {
    dialogo.remove();
    opciones.alCerrar();
    elegido?.alElegir();
  });

  document.body.append(dialogo);
  dialogo.showModal();
  entrada.focus();
  dibujar();
}
