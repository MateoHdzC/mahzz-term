import { invoke } from "@tauri-apps/api/core";
import { ajustes } from "./ajustes";
import { t } from "./i18n";
import type { Panel } from "./panel";
import type { Pestana } from "./pestana";
import { listarTareas, type ListaTareas, type Tarea } from "./tareas";

interface InfoAgente {
  nombre: string;
  // Comando que retoma la última conversación al reabrir una sesión guardada.
  reanudar?: string;
}

// Programas que se consideran agentes, por el nombre de su ejecutable.
const AGENTES: Record<string, InfoAgente> = {
  claude: { nombre: "Claude Code", reanudar: "claude --continue" },
  codex: { nombre: "Codex" },
  gemini: { nombre: "Gemini CLI" },
  aider: { nombre: "Aider" },
  opencode: { nombre: "opencode" },
  "cursor-agent": { nombre: "Cursor Agent" },
  copilot: { nombre: "Copilot CLI" },
  goose: { nombre: "Goose" },
  crush: { nombre: "Crush" },
  qwen: { nombre: "Qwen Code" },
  amp: { nombre: "Amp" },
  ollama: { nombre: "Ollama" },
};

// Sin salida durante este tiempo, el agente ya no está trabajando.
const QUIETO = 3000;
// Solo se avisa si el agente trabajó al menos esto: evita avisos por respuestas cortas.
const TRABAJO_PARA_AVISAR = 10_000;

export function infoAgente(programa: string | null | undefined): InfoAgente | null {
  if (!programa) return null;
  return AGENTES[programa.toLowerCase()] ?? null;
}

type Estado = "trabajando" | "esperando" | "atencion";

interface Seguimiento {
  estado: Estado;
  trabajandoDesde: number;
  // El agente terminó mientras no lo mirabas.
  pendiente: boolean;
}

interface FilaAgente {
  pestana: Pestana;
  panel: Panel;
  info: InfoAgente;
  seguimiento: Seguimiento;
}

export interface ApiAgentes {
  pestanas(): Pestana[];
  activa(): Pestana | null;
  irA(pestana: Pestana, panel: Panel): void;
  nuevoAgente(comando: string): void;
  carpetaActiva(): string | null;
  nuevaTarea(): void;
  abrirTarea(tarea: Tarea): void;
  unirTarea(tarea: Tarea): void;
  descartarTarea(tarea: Tarea): void;
  alCerrar(): void;
}

const INTERVALO_TAREAS = 4000;

function tiempoDesde(momento: number): string {
  const segundos = Math.max(0, Math.round((Date.now() - momento) / 1000));
  if (segundos < 60) return t("{0} s", segundos);
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return t("{0} min", minutos);
  return t("{0} h {1} min", Math.floor(minutos / 60), minutos % 60);
}

function nombreCarpeta(carpeta: string | null): string {
  return carpeta?.split("\\").filter(Boolean).at(-1) ?? "";
}

const TEXTO_ESTADO: Record<Estado, string> = {
  trabajando: t("Trabajando"),
  esperando: t("Esperando"),
  atencion: t("Te necesita"),
};

// Botón de la barra que despliega los agentes que corren en esta ventana.
export class PanelAgentes {
  private readonly desplegable = document.createElement("div");
  private readonly insignia = document.createElement("span");
  private readonly seguimientos = new WeakMap<Panel, Seguimiento>();
  private filas: FilaAgente[] = [];
  private tareas: ListaTareas = { repo: null, tareas: [] };
  private ultimaRevisionTareas = 0;
  private revisandoTareas = false;

  constructor(
    private readonly boton: HTMLElement,
    private readonly api: ApiAgentes,
  ) {
    this.desplegable.className = "agentes";
    this.desplegable.hidden = true;
    this.desplegable.setAttribute("role", "dialog");
    this.desplegable.setAttribute("aria-label", t("Agentes activos"));
    document.body.append(this.desplegable);

    this.insignia.className = "barra__insignia";
    this.insignia.hidden = true;
    this.boton.append(this.insignia);

    this.boton.addEventListener("click", () => this.alternar());
    document.addEventListener(
      "pointerdown",
      (evento) => {
        if (!this.abierto) return;
        const destino = evento.target as Node;
        if (!this.desplegable.contains(destino) && !this.boton.contains(destino)) this.cerrar();
      },
      true,
    );
    this.desplegable.addEventListener("keydown", (evento) => {
      if (evento.key === "Escape") {
        evento.stopPropagation();
        this.cerrar();
      }
    });
  }

  private get abierto(): boolean {
    return !this.desplegable.hidden;
  }

  alternar(): void {
    if (this.abierto) this.cerrar();
    else this.abrir();
  }

  private abrir(): void {
    const caja = this.boton.getBoundingClientRect();
    this.desplegable.style.top = `${caja.bottom + 6}px`;
    this.desplegable.style.right = `${Math.max(8, innerWidth - caja.right - 4)}px`;
    this.desplegable.hidden = false;
    this.boton.setAttribute("aria-pressed", "true");
    this.dibujar();
    this.desplegable.querySelector<HTMLElement>("button")?.focus();
    void this.refrescarTareas();
  }

  // Las tareas salen de git (worktrees con rama mahzz/…) del repo de la pestaña activa.
  async refrescarTareas(): Promise<void> {
    const carpeta = this.api.carpetaActiva();
    if (this.revisandoTareas) return;
    this.revisandoTareas = true;
    this.ultimaRevisionTareas = Date.now();
    try {
      this.tareas = carpeta ? await listarTareas(carpeta) : { repo: null, tareas: [] };
    } catch {
      this.tareas = { repo: null, tareas: [] };
    } finally {
      this.revisandoTareas = false;
    }
    if (this.abierto) this.dibujar();
  }

  private cerrar(): void {
    if (!this.abierto) return;
    this.desplegable.hidden = true;
    this.boton.setAttribute("aria-pressed", "false");
    this.api.alCerrar();
  }

  // Lo que ve la IA con estado_agentes.
  listar() {
    return this.filas.map((fila) => ({
      panel: fila.panel.id,
      agente: fila.info.nombre,
      estado: fila.seguimiento.estado,
      sin_ver: fila.seguimiento.pendiente,
      pestana: fila.pestana.titulo,
      carpeta: fila.panel.carpeta,
      abierto_hace_s: Math.round((Date.now() - fila.panel.programaDesde) / 1000),
    }));
  }

  // Se llama una vez por segundo, después de actualizar qué programa corre en cada panel.
  actualizar(): void {
    const ahora = Date.now();
    const activa = this.api.activa();
    const filas: FilaAgente[] = [];

    for (const pestana of this.api.pestanas()) {
      let pendienteEnPestana = false;
      let trabajandoEnPestana = false;
      for (const panel of pestana.paneles) {
        const info = infoAgente(panel.programa);
        if (!info) {
          this.seguimientos.delete(panel);
          continue;
        }
        const seguimiento = this.seguir(panel, ahora, pestana, activa);
        filas.push({ pestana, panel, info, seguimiento });
        pendienteEnPestana ||= seguimiento.pendiente;
        trabajandoEnPestana ||= seguimiento.estado === "trabajando";
      }
      pestana.elemento.classList.toggle("pestana--agente-espera", pendienteEnPestana);
      pestana.elemento.classList.toggle("pestana--agente-trabajando", trabajandoEnPestana && !pendienteEnPestana);
    }

    this.filas = filas;
    const pendientes = filas.filter((fila) => fila.seguimiento.pendiente).length;
    this.insignia.hidden = filas.length === 0;
    this.insignia.textContent = String(filas.length);
    this.insignia.classList.toggle("barra__insignia--aviso", pendientes > 0);
    this.boton.title =
      filas.length === 0 ? t("Agentes (ninguno activo)") : t("Agentes: {0} activos", filas.length);
    if (this.abierto) {
      this.dibujar();
      if (Date.now() - this.ultimaRevisionTareas > INTERVALO_TAREAS) void this.refrescarTareas();
    }
  }

  private seguir(panel: Panel, ahora: number, pestana: Pestana, activa: Pestana | null): Seguimiento {
    const anterior = this.seguimientos.get(panel);
    const trabajando = ahora - panel.ultimaSalida < QUIETO;
    const estado: Estado = trabajando ? "trabajando" : panel.pideAtencion ? "atencion" : "esperando";
    const seguimiento: Seguimiento = anterior ?? { estado, trabajandoDesde: ahora, pendiente: false };

    const mirando = document.hasFocus() && pestana === activa;
    if (estado === "trabajando" && seguimiento.estado !== "trabajando") seguimiento.trabajandoDesde = ahora;
    if (estado !== "trabajando" && seguimiento.estado === "trabajando") {
      const trabajo = ahora - seguimiento.trabajandoDesde;
      if (!mirando && trabajo >= TRABAJO_PARA_AVISAR) {
        seguimiento.pendiente = true;
        this.avisar(panel, pestana);
      }
    }
    if (estado === "atencion" && seguimiento.estado !== "atencion" && !mirando) seguimiento.pendiente = true;
    if (mirando || estado === "trabajando") seguimiento.pendiente = false;

    seguimiento.estado = estado;
    this.seguimientos.set(panel, seguimiento);
    return seguimiento;
  }

  private avisar(panel: Panel, pestana: Pestana): void {
    if (!ajustes().avisarComandos) return;
    const info = infoAgente(panel.programa);
    void invoke("avisar_comando", {
      titulo: t("{0} te está esperando", info?.nombre ?? panel.programa ?? ""),
      cuerpo: `${pestana.titulo} · ${nombreCarpeta(panel.carpeta)}`,
    }).catch(() => undefined);
  }

  private dibujar(): void {
    const encabezado = document.createElement("div");
    encabezado.className = "agentes__encabezado";
    const titulo = document.createElement("span");
    titulo.textContent = t("Agentes activos");
    const cantidad = document.createElement("span");
    cantidad.className = "agentes__cantidad";
    cantidad.textContent = String(this.filas.length);
    encabezado.append(titulo, cantidad);

    const lista = document.createElement("div");
    lista.className = "agentes__lista";
    if (this.filas.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "agentes__vacio";
      vacio.textContent = t("No hay agentes corriendo en esta ventana.");
      lista.append(vacio);
    }
    for (const fila of this.filas) lista.append(this.crearFila(fila));

    const nuevo = document.createElement("button");
    nuevo.type = "button";
    nuevo.className = "agentes__nuevo";
    nuevo.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1v8M1 5h8" /></svg>';
    nuevo.append(t("Claude Code en pestaña nueva"));
    nuevo.addEventListener("click", () => {
      this.cerrar();
      this.api.nuevoAgente("claude");
    });

    const nuevaTarea = document.createElement("button");
    nuevaTarea.type = "button";
    nuevaTarea.className = "agentes__nuevo";
    nuevaTarea.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1v8M1 5h8" /></svg>';
    nuevaTarea.append(t("Nueva tarea en paralelo (worktree)"));
    nuevaTarea.title = t("Crea una copia de trabajo de git aparte y abre un agente ahí, para que no se pise con los demás");
    nuevaTarea.addEventListener("click", () => {
      this.cerrar();
      this.api.nuevaTarea();
    });

    // Se conserva el foco del teclado al redibujar cada segundo.
    const enfocada = this.desplegable.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.clave
      : undefined;
    this.desplegable.replaceChildren(encabezado, lista, ...this.dibujarTareas(), nuevaTarea, nuevo);
    if (enfocada) this.desplegable.querySelector<HTMLElement>(`[data-clave="${enfocada}"]`)?.focus();
  }

  private dibujarTareas(): HTMLElement[] {
    if (this.tareas.tareas.length === 0) return [];
    const titulo = document.createElement("div");
    titulo.className = "agentes__encabezado agentes__encabezado--tareas";
    titulo.textContent = t("Tareas en paralelo");
    const base = document.createElement("span");
    base.className = "agentes__cantidad";
    base.textContent = this.tareas.base ? t("se unen a {0}", this.tareas.base) : "";
    titulo.append(base);
    const lista = document.createElement("div");
    lista.className = "agentes__lista";
    for (const tarea of this.tareas.tareas) {
      const fila = document.createElement("div");
      fila.className = "agentes__tarea";
      const textos = document.createElement("button");
      textos.type = "button";
      textos.className = "agentes__tarea-abrir";
      textos.dataset.clave = `tarea:${tarea.rama}`;
      textos.title = tarea.carpeta;
      const nombre = document.createElement("span");
      nombre.className = "agentes__nombre";
      nombre.textContent = tarea.nombre;
      const detalle = document.createElement("span");
      detalle.className = "agentes__detalle";
      detalle.textContent = t("{0} cambios sin guardar · {1} commits", tarea.cambios, tarea.commits);
      textos.append(nombre, detalle);
      textos.addEventListener("click", () => {
        this.cerrar();
        this.api.abrirTarea(tarea);
      });
      const accion = (texto: string, clase: string, alHacer: () => void) => {
        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = `agentes__accion ${clase}`;
        boton.textContent = texto;
        boton.addEventListener("click", () => {
          this.cerrar();
          alHacer();
        });
        return boton;
      };
      fila.append(
        textos,
        accion(t("Unir"), "agentes__accion--unir", () => this.api.unirTarea(tarea)),
        accion(t("Descartar"), "agentes__accion--descartar", () => this.api.descartarTarea(tarea)),
      );
      lista.append(fila);
    }
    return [titulo, lista];
  }

  private crearFila({ pestana, panel, info, seguimiento }: FilaAgente): HTMLElement {
    const fila = document.createElement("button");
    fila.type = "button";
    fila.className = `agentes__fila agentes__fila--${seguimiento.estado}`;
    fila.classList.toggle("agentes__fila--pendiente", seguimiento.pendiente);
    fila.dataset.clave = String(this.api.pestanas().indexOf(pestana)) + ":" + String(pestana.paneles.indexOf(panel));
    fila.title = panel.carpeta ?? "";

    const punto = document.createElement("span");
    punto.className = "agentes__punto";

    const textos = document.createElement("span");
    textos.className = "agentes__textos";
    const nombre = document.createElement("span");
    nombre.className = "agentes__nombre";
    nombre.textContent = info.nombre;
    const detalle = document.createElement("span");
    detalle.className = "agentes__detalle";
    const carpeta = nombreCarpeta(panel.carpeta);
    detalle.textContent = carpeta && carpeta !== pestana.titulo ? `${pestana.titulo} · ${carpeta}` : pestana.titulo;
    textos.append(nombre, detalle);

    const estado = document.createElement("span");
    estado.className = "agentes__estado";
    const textoEstado = document.createElement("span");
    textoEstado.textContent = TEXTO_ESTADO[seguimiento.estado];
    const tiempo = document.createElement("span");
    tiempo.className = "agentes__tiempo";
    tiempo.textContent = tiempoDesde(panel.programaDesde);
    estado.append(textoEstado, tiempo);

    fila.append(punto, textos, estado);
    fila.addEventListener("click", () => {
      this.desplegable.hidden = true;
      this.boton.setAttribute("aria-pressed", "false");
      this.api.irA(pestana, panel);
    });
    return fila;
  }
}
