import { t } from "./i18n";
import { invoke } from "@tauri-apps/api/core";
import { abrirMenu, avisar } from "./dialogos";
import type { Panel } from "./panel";

interface EntradaArchivo {
  nombre: string;
  ruta: string;
  directorio: boolean;
}

const CLAVE_VISIBLE = "mahzz-archivos-visible";
const CLAVE_ANCHO = "mahzz-archivos-ancho";
const ANCHO_MINIMO = 180;
const ANCHO_MAXIMO = 520;
const RETRASO_REFRESCO = 350;

const ICONO_CARPETA =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4.5a1 1 0 0 1 1-1h3.2l1.5 1.6h6.3a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" /></svg>';
const ICONO_ARCHIVO =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.2L12.5 5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5zM9 1.5V5h3.5" /></svg>';

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
    // Sin almacenamiento, la preferencia dura solo mientras la ventana esté abierta.
  }
}

// Ruta corta desde la carpeta de la terminal, o completa si el archivo está afuera.
function rutaRelativa(ruta: string, base: string | null): string {
  if (!base) return ruta;
  const prefijo = base.endsWith("\\") ? base : `${base}\\`;
  return ruta.toLowerCase().startsWith(prefijo.toLowerCase()) ? ruta.slice(prefijo.length) : ruta;
}

// Árbol de carpetas de la terminal activa. Un clic le pasa la ruta al programa o al editor.
export class PanelArchivos {
  private readonly titulo = document.createElement("span");
  private readonly arbol = document.createElement("div");
  private readonly expandidas = new Set<string>();
  private raiz: string | null = null;
  private temporizador = 0;
  private consulta = 0;

  constructor(
    private readonly elemento: HTMLElement,
    private readonly botonAlternar: HTMLElement,
    private readonly obtenerPanel: () => Panel | null,
  ) {
    this.titulo.className = "archivos__titulo";
    this.arbol.className = "archivos__arbol";
    this.arbol.setAttribute("role", "tree");

    const refrescar = document.createElement("button");
    refrescar.type = "button";
    refrescar.className = "archivos__boton";
    refrescar.title = t("Actualizar");
    refrescar.setAttribute("aria-label", t("Actualizar archivos"));
    refrescar.innerHTML =
      '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M10.5 6a4.5 4.5 0 1 1-1.4-3.3M10.5 1v2.5H8" /></svg>';
    refrescar.addEventListener("click", () => void this.dibujar());

    const encabezado = document.createElement("div");
    encabezado.className = "archivos__encabezado";
    encabezado.append(this.titulo, refrescar);

    const asa = document.createElement("div");
    asa.className = "archivos__asa";
    asa.setAttribute("role", "separator");
    asa.setAttribute("aria-orientation", "vertical");
    asa.addEventListener("pointerdown", (evento) => this.iniciarAjusteAncho(asa, evento));

    this.elemento.append(encabezado, this.arbol, asa);

    const ancho = Number(leerPreferencia(CLAVE_ANCHO));
    if (ancho >= ANCHO_MINIMO && ancho <= ANCHO_MAXIMO) this.elemento.style.width = `${ancho}px`;
    this.definirVisible(leerPreferencia(CLAVE_VISIBLE) === "si");
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

  // Sigue a la terminal activa y refleja los archivos que crean los comandos.
  sincronizar(): void {
    if (!this.visible) return;
    clearTimeout(this.temporizador);
    this.temporizador = window.setTimeout(() => void this.dibujar(), RETRASO_REFRESCO);
  }

  private async dibujar(): Promise<void> {
    const host = this.obtenerPanel()?.hostRemoto ?? null;
    if (host) {
      this.consulta++;
      this.titulo.textContent = host;
      this.titulo.title = host;
      const aviso = document.createElement("div");
      aviso.className = "archivos__vacio archivos__vacio--remoto";
      aviso.textContent = t("Este panel muestra archivos de tu PC. Salí de SSH para volver a verlos.");
      this.arbol.replaceChildren(aviso);
      return;
    }

    const carpeta = this.obtenerPanel()?.carpeta ?? null;
    if (carpeta !== this.raiz) {
      this.raiz = carpeta;
      this.expandidas.clear();
    }
    const nombre = carpeta?.split("\\").filter(Boolean).at(-1) ?? t("Archivos");
    this.titulo.textContent = nombre;
    this.titulo.title = carpeta ?? "";

    const consulta = ++this.consulta;
    const contenido = document.createDocumentFragment();
    if (carpeta) await this.dibujarNivel(carpeta, 0, contenido);
    if (consulta !== this.consulta) return;

    const desplazamiento = this.arbol.scrollTop;
    this.arbol.replaceChildren(contenido);
    this.arbol.scrollTop = desplazamiento;
  }

  private async dibujarNivel(carpeta: string, nivel: number, destino: Node): Promise<void> {
    let entradas: EntradaArchivo[];
    try {
      entradas = await invoke<EntradaArchivo[]>("listar_carpeta", { ruta: carpeta });
    } catch {
      const aviso = document.createElement("div");
      aviso.className = "archivos__vacio";
      aviso.style.paddingLeft = `${12 + nivel * 14}px`;
      aviso.textContent = t("Sin acceso a esta carpeta");
      destino.appendChild(aviso);
      return;
    }

    if (entradas.length === 0) {
      const vacia = document.createElement("div");
      vacia.className = "archivos__vacio";
      vacia.style.paddingLeft = `${12 + nivel * 14}px`;
      vacia.textContent = t("Carpeta vacía");
      destino.appendChild(vacia);
    }
    for (const entrada of entradas) {
      destino.appendChild(this.crearFila(entrada, nivel));
      if (entrada.directorio && this.expandidas.has(entrada.ruta)) {
        await this.dibujarNivel(entrada.ruta, nivel + 1, destino);
      }
    }
  }

  private crearFila(entrada: EntradaArchivo, nivel: number): HTMLElement {
    const fila = document.createElement("button");
    fila.type = "button";
    fila.className = `archivos__fila${entrada.directorio ? " archivos__fila--carpeta" : ""}`;
    fila.style.paddingLeft = `${6 + nivel * 14}px`;
    fila.title = entrada.directorio ? entrada.ruta : `${entrada.ruta}\n${t("Clic para enviar la ruta a la terminal")}`;
    fila.setAttribute("role", "treeitem");
    if (entrada.directorio) fila.setAttribute("aria-expanded", String(this.expandidas.has(entrada.ruta)));

    const flecha = document.createElement("span");
    flecha.className = "archivos__flecha";
    if (entrada.directorio) {
      flecha.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" /></svg>';
      flecha.classList.toggle("archivos__flecha--abierta", this.expandidas.has(entrada.ruta));
    }
    const icono = document.createElement("span");
    icono.className = "archivos__icono";
    icono.innerHTML = entrada.directorio ? ICONO_CARPETA : ICONO_ARCHIVO;
    const nombre = document.createElement("span");
    nombre.className = "archivos__nombre";
    nombre.textContent = entrada.nombre;
    fila.append(flecha, icono, nombre);

    fila.addEventListener("click", () => {
      if (entrada.directorio) this.alternarCarpeta(entrada.ruta);
      else void this.enviar(entrada);
    });
    fila.addEventListener("contextmenu", (evento) => {
      evento.preventDefault();
      evento.stopPropagation();
      this.abrirAcciones(entrada, evento.clientX, evento.clientY);
    });
    return fila;
  }

  private alternarCarpeta(ruta: string): void {
    if (this.expandidas.has(ruta)) this.expandidas.delete(ruta);
    else this.expandidas.add(ruta);
    void this.dibujar();
  }

  // La ruta se copia y además se escribe donde esté trabajando la terminal.
  private async enviar(entrada: EntradaArchivo): Promise<void> {
    const panel = this.obtenerPanel();
    if (!panel) return;
    const ruta = rutaRelativa(entrada.ruta, panel.carpeta);
    await navigator.clipboard.writeText(ruta).catch(() => undefined);
    panel.enviarRuta(ruta);
    avisar(t("Ruta enviada: {0}", ruta));
  }

  private async copiar(texto: string): Promise<void> {
    await navigator.clipboard.writeText(texto);
    avisar(t("Copiado: {0}", texto));
    this.obtenerPanel()?.enfocar();
  }

  private abrirAcciones(entrada: EntradaArchivo, x: number, y: number): void {
    const relativa = rutaRelativa(entrada.ruta, this.obtenerPanel()?.carpeta ?? null);
    abrirMenu(
      x,
      y,
      {
        opciones: [
          { texto: t("Enviar ruta a la terminal"), accion: () => void this.enviar(entrada) },
          { texto: t("Copiar ruta relativa"), accion: () => void this.copiar(relativa) },
          { texto: t("Copiar ruta completa"), accion: () => void this.copiar(entrada.ruta) },
          { texto: t("Copiar nombre"), accion: () => void this.copiar(entrada.nombre) },
        ],
      },
      () => this.obtenerPanel()?.enfocar(),
    );
  }

  private iniciarAjusteAncho(asa: HTMLElement, inicio: PointerEvent): void {
    inicio.preventDefault();
    asa.setPointerCapture(inicio.pointerId);
    const izquierda = this.elemento.getBoundingClientRect().left;

    const mover = (evento: PointerEvent) => {
      const ancho = Math.min(ANCHO_MAXIMO, Math.max(ANCHO_MINIMO, evento.clientX - izquierda));
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
