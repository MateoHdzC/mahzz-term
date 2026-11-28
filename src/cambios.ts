import { invoke } from "@tauri-apps/api/core";
import { avisar, confirmar } from "./dialogos";
import { t } from "./i18n";
import type { Panel } from "./panel";

interface ArchivoCambiado {
  ruta: string;
  origen: string | null;
  indice: string;
  trabajo: string;
}

interface EstadoCambios {
  raiz: string;
  archivos: ArchivoCambiado[];
}

interface Diff {
  texto: string;
  binario: boolean;
  grande: boolean;
}

type Tipo = "nuevo" | "modificado" | "borrado" | "renombrado";

const CLAVE_VISIBLE = "mahzz-cambios-visible";
const CLAVE_ANCHO = "mahzz-cambios-ancho";
const ANCHO_MINIMO = 280;
const ANCHO_MAXIMO = 900;
const INTERVALO = 3000;
const RETRASO_REFRESCO = 250;

const ICONO_ACEPTAR = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" /></svg>';
const ICONO_REVERTIR =
  '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 5h5a2.5 2.5 0 0 1 0 5H5M4.5 2.5L2 5l2.5 2.5" /></svg>';
const ICONO_REFRESCAR =
  '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M10.5 6a4.5 4.5 0 1 1-1.4-3.3M10.5 1v2.5H8" /></svg>';

function leerPreferencia(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function guardarPreferencia(clave: string, valor: string): void {
  try {
    localStorage.setItem(clave, valor);
  } catch {
  }
}

function tipoDe(archivo: ArchivoCambiado): Tipo {
  const { indice, trabajo } = archivo;
  if (indice === "?" || indice === "A") return "nuevo";
  if (indice === "R" || indice === "C") return "renombrado";
  if (indice === "D" || trabajo === "D") return "borrado";
  return "modificado";
}

function estaAceptado(archivo: ArchivoCambiado): boolean {
  return archivo.indice !== " " && archivo.indice !== "?" && archivo.trabajo === " ";
}

const LETRA: Record<Tipo, string> = { nuevo: "N", modificado: "M", borrado: "B", renombrado: "R" };
const TITULO_TIPO: Record<Tipo, string> = {
  nuevo: t("Archivo nuevo"),
  modificado: t("Modificado"),
  borrado: t("Borrado"),
  renombrado: t("Renombrado"),
};

export class PanelCambios {
  private readonly titulo = document.createElement("span");
  private readonly resumen = document.createElement("span");
  private readonly lista = document.createElement("div");
  private readonly aceptarTodo = document.createElement("button");
  private readonly insignia = document.createElement("span");
  private readonly abiertos = new Set<string>();
  private readonly diffs = new Map<string, string>();
  private estado: EstadoCambios | null = null;
  private firma = "";
  private temporizador = 0;
  private consulta = 0;
  private ocupado = false;

  constructor(
    private readonly elemento: HTMLElement,
    private readonly botonAlternar: HTMLElement,
    private readonly obtenerPanel: () => Panel | null,
  ) {
    this.titulo.className = "cambios__titulo";
    this.resumen.className = "cambios__resumen";
    this.lista.className = "cambios__lista";

    this.aceptarTodo.type = "button";
    this.aceptarTodo.className = "cambios__accion-general";
    this.aceptarTodo.innerHTML = ICONO_ACEPTAR;
    this.aceptarTodo.append(t("Aceptar todo"));
    this.aceptarTodo.title = t("Pasa todos los cambios al índice de git (git add)");
    this.aceptarTodo.addEventListener("click", () => void this.aceptarTodos());

    const refrescar = document.createElement("button");
    refrescar.type = "button";
    refrescar.className = "archivos__boton";
    refrescar.title = t("Actualizar");
    refrescar.setAttribute("aria-label", t("Actualizar cambios"));
    refrescar.innerHTML = ICONO_REFRESCAR;
    refrescar.addEventListener("click", () => void this.dibujar(true));

    const textos = document.createElement("div");
    textos.className = "cambios__textos";
    textos.append(this.titulo, this.resumen);

    const encabezado = document.createElement("div");
    encabezado.className = "cambios__encabezado";
    encabezado.append(textos, this.aceptarTodo, refrescar);

    const asa = document.createElement("div");
    asa.className = "cambios__asa";
    asa.setAttribute("role", "separator");
    asa.setAttribute("aria-orientation", "vertical");
    asa.addEventListener("pointerdown", (evento) => this.iniciarAjusteAncho(asa, evento));

    this.elemento.append(asa, encabezado, this.lista);

    this.insignia.className = "barra__insignia";
    this.insignia.hidden = true;
    this.botonAlternar.append(this.insignia);

    const ancho = Number(leerPreferencia(CLAVE_ANCHO));
    if (ancho >= ANCHO_MINIMO && ancho <= ANCHO_MAXIMO) this.elemento.style.width = `${ancho}px`;
    this.definirVisible(leerPreferencia(CLAVE_VISIBLE) === "si");

    setInterval(() => {
      if (this.visible && document.visibilityState === "visible") void this.dibujar(false);
    }, INTERVALO);
  }

  private get visible(): boolean {
    return !this.elemento.hidden;
  }

  alternar(): void {
    this.definirVisible(!this.visible);
    this.obtenerPanel()?.enfocar();
  }

  private definirVisible(visible: boolean): void {
    this.elemento.hidden = !visible;
    this.botonAlternar.setAttribute("aria-pressed", String(visible));
    guardarPreferencia(CLAVE_VISIBLE, visible ? "si" : "no");
    if (visible) this.sincronizar();
  }

  sincronizar(): void {
    clearTimeout(this.temporizador);
    this.temporizador = window.setTimeout(() => void this.dibujar(false), RETRASO_REFRESCO);
  }

  private pintarInsignia(pendientes: number): void {
    this.insignia.hidden = pendientes === 0;
    this.insignia.textContent = pendientes > 99 ? "99+" : String(pendientes);
    this.botonAlternar.title =
      pendientes === 0 ? t("Revisar cambios (Ctrl+Shift+G)") : t("Revisar cambios: {0} sin aceptar", pendientes);
  }

  private mostrarVacio(texto: string): void {
    const aviso = document.createElement("div");
    aviso.className = "cambios__vacio";
    aviso.textContent = texto;
    this.lista.replaceChildren(aviso);
    this.aceptarTodo.hidden = true;
    this.resumen.textContent = "";
    this.firma = "";
  }

  private async dibujar(forzar: boolean): Promise<void> {
    if (this.ocupado) return;
    const panel = this.obtenerPanel();
    const consulta = ++this.consulta;

    if (panel?.hostRemoto) {
      this.estado = null;
      this.titulo.textContent = panel.hostRemoto;
      this.pintarInsignia(0);
      this.mostrarVacio(t("La revisión de cambios funciona con carpetas de tu PC. Salí de SSH para usarla."));
      return;
    }
    const carpeta = panel?.carpeta ?? null;
    let estado: EstadoCambios | null = null;
    try {
      estado = carpeta ? await invoke<EstadoCambios | null>("listar_cambios", { carpeta }) : null;
    } catch (error) {
      if (consulta !== this.consulta) return;
      this.mostrarVacio(t("No se pudo leer git: {0}", String(error)));
      return;
    }
    if (consulta !== this.consulta) return;

    if (!estado) {
      this.estado = null;
      this.titulo.textContent = t("Cambios");
      this.pintarInsignia(0);
      this.mostrarVacio(t("Esta carpeta no es un repositorio de git."));
      return;
    }

    if (this.estado?.raiz !== estado.raiz) {
      this.abiertos.clear();
      this.diffs.clear();
    }
    this.estado = estado;
    const pendientes = estado.archivos.filter((archivo) => !estaAceptado(archivo)).length;
    this.pintarInsignia(pendientes);
    if (!this.visible) return;

    this.titulo.textContent = estado.raiz.split("\\").filter(Boolean).at(-1) ?? estado.raiz;
    this.titulo.title = estado.raiz;
    if (estado.archivos.length === 0) {
      this.mostrarVacio(t("No hay cambios sin commitear."));
      return;
    }

    const rutas = new Set(estado.archivos.map((archivo) => archivo.ruta));
    for (const ruta of [...this.abiertos]) if (!rutas.has(ruta)) this.abiertos.delete(ruta);
    const diffs = await Promise.all(
      estado.archivos
        .filter((archivo) => this.abiertos.has(archivo.ruta))
        .map(async (archivo) => [archivo.ruta, await this.pedirDiff(estado, archivo)] as const),
    );
    if (consulta !== this.consulta) return;

    const firma = JSON.stringify([estado, diffs, [...this.abiertos]]);
    if (!forzar && firma === this.firma) return;
    this.firma = firma;
    for (const [ruta, html] of diffs) this.diffs.set(ruta, html);

    this.resumen.textContent =
      pendientes === estado.archivos.length
        ? t("{0} archivos cambiados", estado.archivos.length)
        : t("{0} de {1} sin aceptar", pendientes, estado.archivos.length);
    this.aceptarTodo.hidden = pendientes === 0;

    const contenido = document.createDocumentFragment();
    for (const archivo of estado.archivos) contenido.append(this.crearArchivo(estado, archivo));
    const desplazamiento = this.lista.scrollTop;
    this.lista.replaceChildren(contenido);
    this.lista.scrollTop = desplazamiento;
  }

  private async pedirDiff(estado: EstadoCambios, archivo: ArchivoCambiado): Promise<string> {
    try {
      const diff = await invoke<Diff>("diff_cambio", {
        raiz: estado.raiz,
        ruta: archivo.ruta,
        origen: archivo.origen,
        nuevo: archivo.indice === "?",
      });
      if (diff.binario) return `<div class="cambios__nota">${t("Archivo binario: no se puede mostrar.")}</div>`;
      if (!diff.texto.trim()) {
        return `<div class="cambios__nota">${diff.grande ? t("Archivo demasiado grande para mostrarlo.") : t("Sin diferencias de texto.")}</div>`;
      }
      return this.htmlDiff(diff);
    } catch (error) {
      const nota = document.createElement("div");
      nota.className = "cambios__nota";
      nota.textContent = t("No se pudo leer el diff: {0}", String(error));
      return nota.outerHTML;
    }
  }

  private htmlDiff(diff: Diff): string {
    const escapar = (texto: string) =>
      texto.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const filas: string[] = [];
    let vieja = 0;
    let nueva = 0;
    for (const linea of diff.texto.split("\n")) {
      if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(linea)) continue;
      if (linea.startsWith("\\")) continue;
      const tramo = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(linea);
      if (tramo) {
        vieja = Number(tramo[1]);
        nueva = Number(tramo[2]);
        filas.push(`<div class="diff__tramo"><span></span><span></span><code>${escapar(tramo[3].trim() || "···")}</code></div>`);
        continue;
      }
      if (linea === "" && filas.length > 0) continue;
      const signo = linea[0];
      const texto = escapar(linea.slice(1)) || " ";
      if (signo === "+") {
        filas.push(`<div class="diff__linea diff__linea--mas"><span></span><span>${nueva++}</span><code>${texto}</code></div>`);
      } else if (signo === "-") {
        filas.push(`<div class="diff__linea diff__linea--menos"><span>${vieja++}</span><span></span><code>${texto}</code></div>`);
      } else {
        filas.push(`<div class="diff__linea"><span>${vieja++}</span><span>${nueva++}</span><code>${texto}</code></div>`);
      }
    }
    if (diff.grande) filas.push(`<div class="cambios__nota">${t("El diff es muy largo: se muestra solo el principio.")}</div>`);
    return `<div class="diff">${filas.join("")}</div>`;
  }

  private crearArchivo(estado: EstadoCambios, archivo: ArchivoCambiado): HTMLElement {
    const tipo = tipoDe(archivo);
    const aceptado = estaAceptado(archivo);
    const abierto = this.abiertos.has(archivo.ruta);

    const bloque = document.createElement("div");
    bloque.className = `cambio cambio--${tipo}`;
    bloque.classList.toggle("cambio--aceptado", aceptado);

    const fila = document.createElement("div");
    fila.className = "cambio__fila";

    const abrir = document.createElement("button");
    abrir.type = "button";
    abrir.className = "cambio__abrir";
    abrir.setAttribute("aria-expanded", String(abierto));
    abrir.title = archivo.origen ? `${archivo.origen} → ${archivo.ruta}` : archivo.ruta;

    const flecha = document.createElement("span");
    flecha.className = `archivos__flecha${abierto ? " archivos__flecha--abierta" : ""}`;
    flecha.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" /></svg>';
    const letra = document.createElement("span");
    letra.className = "cambio__letra";
    letra.textContent = aceptado ? "✓" : LETRA[tipo];
    letra.title = aceptado ? t("Aceptado") : TITULO_TIPO[tipo];

    const partes = archivo.ruta.split("/");
    const nombre = document.createElement("span");
    nombre.className = "cambio__nombre";
    nombre.textContent = partes.at(-1) ?? archivo.ruta;
    const carpeta = document.createElement("span");
    carpeta.className = "cambio__carpeta";
    carpeta.textContent = partes.slice(0, -1).join("/");
    abrir.append(flecha, letra, nombre, carpeta);
    abrir.addEventListener("click", () => {
      if (this.abiertos.has(archivo.ruta)) this.abiertos.delete(archivo.ruta);
      else this.abiertos.add(archivo.ruta);
      void this.dibujar(true);
    });

    const acciones = document.createElement("span");
    acciones.className = "cambio__acciones";
    if (!aceptado) {
      acciones.append(
        this.botonAccion(ICONO_ACEPTAR, t("Aceptar (git add)"), "cambio__boton--aceptar", () =>
          this.aceptar(estado, archivo),
        ),
      );
    }
    acciones.append(
      this.botonAccion(ICONO_REVERTIR, t("Revertir"), "cambio__boton--revertir", () => this.revertir(estado, archivo)),
    );
    fila.append(abrir, acciones);
    bloque.append(fila);

    if (abierto) {
      const contenedor = document.createElement("div");
      contenedor.className = "cambio__diff";
      contenedor.innerHTML = this.diffs.get(archivo.ruta) ?? `<div class="cambios__nota">${t("Cargando…")}</div>`;
      bloque.append(contenedor);
    }
    return bloque;
  }

  private botonAccion(icono: string, titulo: string, clase: string, accion: () => Promise<void>): HTMLElement {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = `cambio__boton ${clase}`;
    boton.title = titulo;
    boton.setAttribute("aria-label", titulo);
    boton.innerHTML = icono;
    boton.addEventListener("click", (evento) => {
      evento.stopPropagation();
      void accion();
    });
    return boton;
  }

  private async conBloqueo(tarea: () => Promise<void>): Promise<void> {
    this.ocupado = true;
    try {
      await tarea();
    } catch (error) {
      avisar(t("No se pudo: {0}", String(error)));
    } finally {
      this.ocupado = false;
      await this.dibujar(true);
    }
  }

  private async aceptar(estado: EstadoCambios, archivo: ArchivoCambiado): Promise<void> {
    await this.conBloqueo(() =>
      invoke("aceptar_cambio", { raiz: estado.raiz, ruta: archivo.ruta, origen: archivo.origen }),
    );
  }

  private async aceptarTodos(): Promise<void> {
    const estado = this.estado;
    if (!estado) return;
    await this.conBloqueo(async () => {
      for (const archivo of estado.archivos.filter((actual) => !estaAceptado(actual))) {
        await invoke("aceptar_cambio", { raiz: estado.raiz, ruta: archivo.ruta, origen: archivo.origen });
      }
    });
  }

  private async revertir(estado: EstadoCambios, archivo: ArchivoCambiado): Promise<void> {
    const nuevo = archivo.indice === "?" || archivo.indice === "A";
    const nombre = archivo.ruta.split("/").at(-1) ?? archivo.ruta;
    const seguir = await confirmar(
      t("¿Revertir {0}?", nombre),
      nuevo
        ? t("Es un archivo nuevo: revertirlo lo borra del disco. No se puede deshacer.")
        : t("Vuelve a como estaba en el último commit. Se pierden los cambios de este archivo y no se puede deshacer."),
      nuevo ? t("Borrar archivo") : t("Revertir"),
    );
    if (!seguir) return;
    await this.conBloqueo(() =>
      invoke("revertir_cambio", {
        raiz: estado.raiz,
        ruta: archivo.ruta,
        origen: archivo.origen,
        indice: archivo.indice,
      }),
    );
  }

  private iniciarAjusteAncho(asa: HTMLElement, inicio: PointerEvent): void {
    inicio.preventDefault();
    asa.setPointerCapture(inicio.pointerId);
    const derecha = this.elemento.getBoundingClientRect().right;

    const mover = (evento: PointerEvent) => {
      const ancho = Math.min(ANCHO_MAXIMO, Math.max(ANCHO_MINIMO, derecha - evento.clientX));
      this.elemento.style.width = `${ancho}px`;
    };
    const soltar = () => {
      asa.removeEventListener("pointermove", mover);
      asa.removeEventListener("pointerup", soltar);
      asa.removeEventListener("pointercancel", soltar);
      guardarPreferencia(CLAVE_ANCHO, String(Math.round(this.elemento.getBoundingClientRect().width)));
    };
    asa.addEventListener("pointermove", mover);
    asa.addEventListener("pointerup", soltar);
    asa.addEventListener("pointercancel", soltar);
  }
}
