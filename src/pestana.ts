import {
  dibujarNodo,
  dividirPanel,
  listarPaneles,
  quitarPanel,
  type Direccion,
  type Nodo,
} from "./disposicion";
import { Buscador } from "./buscador";
import { Panel, type DatosPanel, type EventosPanel } from "./panel";

export type DatosNodo =
  | { tipo: "panel"; datos: DatosPanel; activo: boolean }
  | { tipo: "division"; direccion: Direccion; proporcion: number; a: DatosNodo; b: DatosNodo };

export interface DatosPestana {
  tituloManual: string | null;
  color: string | null;
  nodo: DatosNodo;
  titulo?: string;
}

const BLOQUES_GUARDADOS = 30;
const LINEAS_POR_BLOQUE = 400;
const TEXTO_POR_BLOQUE = 50_000;

function bloquesParaGuardar(panel: Panel) {
  return panel.lista
    .exportar()
    .slice(-BLOQUES_GUARDADOS)
    .map((bloque) => ({
      ...bloque,
      lineasHtml: bloque.lineasHtml.slice(-LINEAS_POR_BLOQUE),
      texto: bloque.texto.length > TEXTO_POR_BLOQUE ? bloque.texto.slice(-TEXTO_POR_BLOQUE) : bloque.texto,
    }));
}

export type Sentido = "izquierda" | "derecha" | "arriba" | "abajo";

export interface EventosPestana {
  alCambiar(pestana: Pestana): void;
}

export class Pestana {
  readonly contenido = document.createElement("section");
  readonly elemento = document.createElement("div");
  tituloManual: string | null = null;
  color: string | null = null;
  activo: Panel;

  private raiz: Nodo;
  private readonly eventosPanel: EventosPanel;
  private readonly buscador: Buscador;

  constructor(
    private readonly eventos: EventosPestana,
    datos?: DatosPestana,
  ) {
    this.contenido.className = "contenido-pestana";
    this.contenido.setAttribute("role", "tabpanel");

    this.eventosPanel = {
      alEnfocar: (panel) => this.marcarActivo(panel),
      alCambiarEstado: () => this.eventos.alCambiar(this),
      alBuscarBloque: (panel, id) => this.buscador.abrir({ lista: panel.lista, id }),
    };
    this.buscador = new Buscador(
      () => this.paneles.map((panel) => panel.lista),
      () => this.activo.enfocar(),
    );

    if (datos) {
      this.tituloManual = datos.tituloManual;
      this.color = datos.color;
      this.raiz = this.construir(datos.nodo);
      this.activo = this.panelMarcado ?? listarPaneles(this.raiz)[0];
    } else {
      const panel = new Panel(this.eventosPanel);
      this.raiz = { tipo: "panel", panel };
      this.activo = panel;
    }
    this.redibujar();
  }

  private panelMarcado: Panel | null = null;

  private construir(datos: DatosNodo): Nodo {
    if (datos.tipo === "panel") {
      const panel = new Panel(this.eventosPanel, datos.datos);
      if (datos.activo) this.panelMarcado = panel;
      return { tipo: "panel", panel };
    }
    return {
      tipo: "division",
      direccion: datos.direccion,
      proporcion: datos.proporcion,
      a: this.construir(datos.a),
      b: this.construir(datos.b),
    };
  }

  get paneles(): Panel[] {
    return listarPaneles(this.raiz);
  }

  get titulo(): string {
    if (this.tituloManual) return this.tituloManual;
    return this.activo.programa ?? "PowerShell";
  }

  async iniciar(): Promise<void> {
    await Promise.all(this.paneles.map((panel) => panel.iniciar()));
    this.activo.enfocar();
  }

  private redibujar(): void {
    const nodo = dibujarNodo(this.raiz);
    nodo.style.flex = "";
    this.contenido.replaceChildren(nodo, this.buscador.elemento);
    this.contenido.classList.toggle("contenido-pestana--dividida", this.raiz.tipo === "division");
    this.pintarActivo();
  }

  private pintarActivo(): void {
    for (const panel of this.paneles) {
      panel.elemento.classList.toggle("panel--activo", panel === this.activo);
    }
  }

  activarPanel(panel: Panel): void {
    this.marcarActivo(panel);
  }

  private marcarActivo(panel: Panel): void {
    if (panel === this.activo) return;
    this.activo = panel;
    this.pintarActivo();
    this.eventos.alCambiar(this);
  }

  mostrar(): void {
    this.contenido.classList.remove("contenido-pestana--oculta");
    for (const panel of this.paneles) panel.activarDibujo(true);
    requestAnimationFrame(() => {
      for (const panel of this.paneles) panel.ajustar();
      if (!(document.activeElement instanceof HTMLInputElement)) this.activo.enfocar();
    });
  }

  ocultar(): void {
    this.contenido.classList.add("contenido-pestana--oculta");
    for (const panel of this.paneles) panel.activarDibujo(false);
  }

  async dividir(direccion: Direccion): Promise<void> {
    const nuevo = new Panel(this.eventosPanel, {
      sesion: null,
      carpeta: this.activo.carpeta,
      contenido: null,
    });
    this.raiz = dividirPanel(this.raiz, this.activo, nuevo, direccion);
    this.activo = nuevo;
    this.redibujar();
    await nuevo.iniciar();
    nuevo.enfocar();
    this.eventos.alCambiar(this);
  }

  cerrarPanel(panel: Panel): boolean {
    const raiz = quitarPanel(this.raiz, panel);
    panel.cerrar();
    if (!raiz) return false;
    this.raiz = raiz;
    if (this.activo === panel) this.activo = this.paneles[0];
    this.redibujar();
    requestAnimationFrame(() => {
      for (const restante of this.paneles) restante.ajustar();
      this.activo.enfocar();
    });
    this.eventos.alCambiar(this);
    return true;
  }

  abrirBusqueda(): void {
    this.buscador.abrir();
  }

  enfocarVecino(sentido: Sentido): void {
    const origen = this.activo.elemento.getBoundingClientRect();
    let mejor: Panel | null = null;
    let menorDistancia = Number.POSITIVE_INFINITY;

    for (const panel of this.paneles) {
      if (panel === this.activo) continue;
      const caja = panel.elemento.getBoundingClientRect();
      const horizontal = sentido === "izquierda" || sentido === "derecha";
      const seSuperpone = horizontal
        ? caja.top < origen.bottom && caja.bottom > origen.top
        : caja.left < origen.right && caja.right > origen.left;
      const distancia = {
        izquierda: origen.left - caja.right,
        derecha: caja.left - origen.right,
        arriba: origen.top - caja.bottom,
        abajo: caja.top - origen.bottom,
      }[sentido];
      if (seSuperpone && distancia >= -2 && distancia < menorDistancia) {
        mejor = panel;
        menorDistancia = distancia;
      }
    }
    mejor?.enfocar();
  }

  private async exportarNodo(nodo: Nodo): Promise<DatosNodo> {
    if (nodo.tipo === "panel") {
      return {
        tipo: "panel",
        datos: await nodo.panel.exportar(),
        activo: nodo.panel === this.activo,
      };
    }
    return {
      tipo: "division",
      direccion: nodo.direccion,
      proporcion: nodo.proporcion,
      a: await this.exportarNodo(nodo.a),
      b: await this.exportarNodo(nodo.b),
    };
  }

  async exportar(): Promise<DatosPestana> {
    return {
      tituloManual: this.tituloManual,
      color: this.color,
      nodo: await this.exportarNodo(this.raiz),
    };
  }

  private planoDe(nodo: Nodo): DatosNodo {
    if (nodo.tipo === "panel") {
      return {
        tipo: "panel",
        activo: nodo.panel === this.activo,
        datos: {
          sesion: null,
          carpeta: nodo.panel.carpeta,
          contenido: null,
          programa: nodo.panel.programa,
          bloques: bloquesParaGuardar(nodo.panel),
        },
      };
    }
    return {
      tipo: "division",
      direccion: nodo.direccion,
      proporcion: nodo.proporcion,
      a: this.planoDe(nodo.a),
      b: this.planoDe(nodo.b),
    };
  }

  plano(): DatosPestana {
    return { tituloManual: this.tituloManual, color: this.color, titulo: this.titulo, nodo: this.planoDe(this.raiz) };
  }

  async reanudar(): Promise<void> {
    await Promise.all(this.paneles.map((panel) => panel.reanudar()));
  }

  soltar(): void {
    for (const panel of this.paneles) panel.soltar();
    this.contenido.remove();
    this.elemento.remove();
  }

  cerrar(): void {
    for (const panel of this.paneles) panel.cerrar();
    this.contenido.remove();
    this.elemento.remove();
  }
}
