import { t } from "./i18n";
import { invoke } from "@tauri-apps/api/core";
import { abrirMenu, avisar, confirmar, pedirDatos, type OpcionMenu } from "./dialogos";
import type { Panel } from "./panel";

interface EntradaArchivo {
  nombre: string;
  ruta: string;
  directorio: boolean;
}

export interface ApiArchivos {
  panel(): Panel | null;
  abrirArchivo(ruta: string): void;
  alMoverRuta(vieja: string, nueva: string): void;
  alBorrarRuta(ruta: string): void;
}

const CLAVE_VISIBLE = "mahzz-archivos-visible";
const CLAVE_ANCHO = "mahzz-archivos-ancho";
const ANCHO_MINIMO = 180;
const ANCHO_MAXIMO = 520;
const RETRASO_REFRESCO = 350;
// Tipo propio para reconocer, al soltar, que lo arrastrado sale de este árbol.
const TIPO_ARRASTRE = "application/x-mahzz-ruta";

const ICONO_CARPETA =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4.5a1 1 0 0 1 1-1h3.2l1.5 1.6h6.3a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" /></svg>';
const ICONO_ARCHIVO =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.2L12.5 5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5zM9 1.5V5h3.5" /></svg>';
const ICONO_NUEVO_ARCHIVO =
  '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1h4l2.5 2.5V11H3zM7 1v2.5h2.5M6 5.5v3M4.5 7h3" /></svg>';
const ICONO_NUEVA_CARPETA =
  '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 3h3l1 1h6v6H1zM6 5.5v3M4.5 7h3" /></svg>';
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
    // Sin almacenamiento, la preferencia dura solo mientras la ventana esté abierta.
  }
}

// Ruta corta desde la carpeta de la terminal, o completa si el archivo está afuera.
function rutaRelativa(ruta: string, base: string | null): string {
  if (!base) return ruta;
  const prefijo = base.endsWith("\\") ? base : `${base}\\`;
  return ruta.toLowerCase().startsWith(prefijo.toLowerCase()) ? ruta.slice(prefijo.length) : ruta;
}

function carpetaPadre(ruta: string): string {
  const corte = ruta.lastIndexOf("\\");
  return corte > 2 ? ruta.slice(0, corte) : ruta.slice(0, corte + 1);
}

// Árbol de carpetas de la terminal activa, con las acciones de un explorador de archivos.
export class PanelArchivos {
  private readonly titulo = document.createElement("span");
  private readonly arbol = document.createElement("div");
  private readonly expandidas = new Set<string>();
  private readonly entradas = new Map<string, EntradaArchivo>();
  private raiz: string | null = null;
  private seleccion: string | null = null;
  private portapapeles: { rutas: string[]; cortar: boolean } | null = null;
  private temporizador = 0;
  private consulta = 0;

  constructor(
    private readonly elemento: HTMLElement,
    private readonly botonAlternar: HTMLElement,
    private readonly api: ApiArchivos,
  ) {
    this.titulo.className = "archivos__titulo";
    this.arbol.className = "archivos__arbol";
    this.arbol.setAttribute("role", "tree");

    const encabezado = document.createElement("div");
    encabezado.className = "archivos__encabezado";
    encabezado.append(
      this.titulo,
      this.botonEncabezado(ICONO_NUEVO_ARCHIVO, t("Nuevo archivo"), () => void this.crear(false)),
      this.botonEncabezado(ICONO_NUEVA_CARPETA, t("Nueva carpeta"), () => void this.crear(true)),
      this.botonEncabezado(ICONO_REFRESCAR, t("Actualizar"), () => void this.dibujar()),
    );

    const asa = document.createElement("div");
    asa.className = "archivos__asa";
    asa.setAttribute("role", "separator");
    asa.setAttribute("aria-orientation", "vertical");
    asa.addEventListener("pointerdown", (evento) => this.iniciarAjusteAncho(asa, evento));

    this.elemento.append(encabezado, this.arbol, asa);
    this.prepararTeclado();
    this.prepararSoltar();

    const ancho = Number(leerPreferencia(CLAVE_ANCHO));
    if (ancho >= ANCHO_MINIMO && ancho <= ANCHO_MAXIMO) this.elemento.style.width = `${ancho}px`;
    this.definirVisible(leerPreferencia(CLAVE_VISIBLE) === "si");
  }

  private botonEncabezado(icono: string, titulo: string, accion: () => void): HTMLElement {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "archivos__boton";
    boton.title = titulo;
    boton.setAttribute("aria-label", titulo);
    boton.innerHTML = icono;
    boton.addEventListener("click", accion);
    return boton;
  }

  private get visible(): boolean {
    return !this.elemento.hidden;
  }

  alternar(): void {
    this.definirVisible(!this.visible);
    this.api.panel()?.enfocar();
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
    const host = this.api.panel()?.hostRemoto ?? null;
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

    const carpeta = this.api.panel()?.carpeta ?? null;
    if (carpeta !== this.raiz) {
      this.raiz = carpeta;
      this.expandidas.clear();
      this.seleccion = null;
    }
    const nombre = carpeta?.split("\\").filter(Boolean).at(-1) ?? t("Archivos");
    this.titulo.textContent = nombre;
    this.titulo.title = carpeta ?? "";

    const consulta = ++this.consulta;
    const contenido = document.createDocumentFragment();
    const entradas = new Map<string, EntradaArchivo>();
    if (carpeta) await this.dibujarNivel(carpeta, 0, contenido, entradas);
    if (consulta !== this.consulta) return;

    const enfocada = this.arbol.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.ruta
      : undefined;
    const desplazamiento = this.arbol.scrollTop;
    this.entradas.clear();
    for (const [ruta, entrada] of entradas) this.entradas.set(ruta, entrada);
    this.arbol.replaceChildren(contenido);
    this.arbol.scrollTop = desplazamiento;
    if (enfocada) this.filaDe(enfocada)?.focus();
  }

  private async dibujarNivel(
    carpeta: string,
    nivel: number,
    destino: Node,
    entradas: Map<string, EntradaArchivo>,
  ): Promise<void> {
    let lista: EntradaArchivo[];
    try {
      lista = await invoke<EntradaArchivo[]>("listar_carpeta", { ruta: carpeta });
    } catch {
      destino.appendChild(this.vacio(t("Sin acceso a esta carpeta"), nivel));
      return;
    }
    if (lista.length === 0) destino.appendChild(this.vacio(t("Carpeta vacía"), nivel));
    for (const entrada of lista) {
      entradas.set(entrada.ruta, entrada);
      destino.appendChild(this.crearFila(entrada, nivel));
      if (entrada.directorio && this.expandidas.has(entrada.ruta)) {
        await this.dibujarNivel(entrada.ruta, nivel + 1, destino, entradas);
      }
    }
  }

  private vacio(texto: string, nivel: number): HTMLElement {
    const aviso = document.createElement("div");
    aviso.className = "archivos__vacio";
    aviso.style.paddingLeft = `${12 + nivel * 14}px`;
    aviso.textContent = texto;
    return aviso;
  }

  private filaDe(ruta: string): HTMLElement | null {
    return [...this.arbol.querySelectorAll<HTMLElement>(".archivos__fila")].find((fila) => fila.dataset.ruta === ruta) ?? null;
  }

  private crearFila(entrada: EntradaArchivo, nivel: number): HTMLElement {
    const fila = document.createElement("button");
    fila.type = "button";
    fila.className = `archivos__fila${entrada.directorio ? " archivos__fila--carpeta" : ""}`;
    fila.classList.toggle("archivos__fila--seleccionada", entrada.ruta === this.seleccion);
    fila.classList.toggle(
      "archivos__fila--cortada",
      Boolean(this.portapapeles?.cortar && this.portapapeles.rutas.includes(entrada.ruta)),
    );
    fila.style.paddingLeft = `${6 + nivel * 14}px`;
    fila.dataset.ruta = entrada.ruta;
    fila.title = entrada.ruta;
    fila.draggable = true;
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
      this.seleccionar(entrada.ruta);
      if (entrada.directorio) this.alternarCarpeta(entrada.ruta);
      else this.api.abrirArchivo(entrada.ruta);
    });
    fila.addEventListener("contextmenu", (evento) => {
      evento.preventDefault();
      evento.stopPropagation();
      this.seleccionar(entrada.ruta);
      this.abrirAcciones(entrada, evento.clientX, evento.clientY);
    });
    fila.addEventListener("dragstart", (evento) => {
      if (!evento.dataTransfer) return;
      evento.dataTransfer.setData(TIPO_ARRASTRE, entrada.ruta);
      evento.dataTransfer.setData("text/plain", entrada.ruta);
      evento.dataTransfer.effectAllowed = "copyMove";
    });
    return fila;
  }

  private seleccionar(ruta: string | null): void {
    this.seleccion = ruta;
    for (const fila of this.arbol.querySelectorAll<HTMLElement>(".archivos__fila")) {
      fila.classList.toggle("archivos__fila--seleccionada", fila.dataset.ruta === ruta);
    }
  }

  private alternarCarpeta(ruta: string): void {
    if (this.expandidas.has(ruta)) this.expandidas.delete(ruta);
    else this.expandidas.add(ruta);
    void this.dibujar();
  }

  // Carpeta donde se crea o pega: la seleccionada, la del archivo seleccionado o la raíz.
  private carpetaDestino(): string | null {
    const elegida = this.seleccion ? this.entradas.get(this.seleccion) : undefined;
    if (elegida) return elegida.directorio ? elegida.ruta : carpetaPadre(elegida.ruta);
    return this.raiz;
  }

  private async crear(esCarpeta: boolean): Promise<void> {
    const carpeta = this.carpetaDestino();
    if (!carpeta) return;
    const datos = await pedirDatos(
      esCarpeta ? t("Nueva carpeta") : t("Nuevo archivo"),
      [{ clave: "nombre", etiqueta: t("Nombre"), obligatorio: true }],
      t("Crear"),
    );
    if (!datos?.nombre.trim()) return;
    try {
      const ruta = await invoke<string>(esCarpeta ? "crear_carpeta" : "crear_archivo", { carpeta, nombre: datos.nombre });
      if (carpeta !== this.raiz) this.expandidas.add(carpeta);
      this.seleccion = ruta;
      await this.dibujar();
      if (!esCarpeta) this.api.abrirArchivo(ruta);
    } catch (error) {
      avisar(t("No se pudo crear: {0}", String(error)));
    }
  }

  // Cambia el nombre ahí mismo en el árbol, como en VS Code.
  private renombrar(ruta: string): void {
    const fila = this.filaDe(ruta);
    const nombre = fila?.querySelector<HTMLElement>(".archivos__nombre");
    const entrada = this.entradas.get(ruta);
    if (!fila || !nombre || !entrada) return;

    const campo = document.createElement("input");
    campo.className = "archivos__renombre";
    campo.value = entrada.nombre;
    campo.spellcheck = false;
    nombre.replaceWith(campo);
    fila.draggable = false;
    campo.focus();
    const punto = entrada.directorio ? -1 : entrada.nombre.lastIndexOf(".");
    campo.setSelectionRange(0, punto > 0 ? punto : entrada.nombre.length);

    let terminado = false;
    const terminar = async (aplicar: boolean) => {
      if (terminado) return;
      terminado = true;
      const nuevo = campo.value.trim();
      if (aplicar && nuevo && nuevo !== entrada.nombre) {
        try {
          const nueva = await invoke<string>("renombrar_ruta", { ruta, nombre: nuevo });
          this.renombrarEnEstado(ruta, nueva);
          this.seleccion = nueva;
        } catch (error) {
          avisar(t("No se pudo renombrar: {0}", String(error)));
        }
      }
      await this.dibujar();
      this.filaDe(this.seleccion ?? ruta)?.focus();
    };
    campo.addEventListener("click", (evento) => evento.stopPropagation());
    campo.addEventListener("keydown", (evento) => {
      evento.stopPropagation();
      if (evento.key === "Enter") void terminar(true);
      if (evento.key === "Escape") void terminar(false);
    });
    campo.addEventListener("blur", () => void terminar(true));
  }

  // Mantiene abiertas las carpetas expandidas y avisa al visor cuando cambia una ruta.
  private renombrarEnEstado(vieja: string, nueva: string): void {
    const prefijo = vieja.toLowerCase() + "\\";
    for (const ruta of [...this.expandidas]) {
      if (ruta.toLowerCase() === vieja.toLowerCase()) {
        this.expandidas.delete(ruta);
        this.expandidas.add(nueva);
      } else if (ruta.toLowerCase().startsWith(prefijo)) {
        this.expandidas.delete(ruta);
        this.expandidas.add(nueva + ruta.slice(vieja.length));
      }
    }
    this.api.alMoverRuta(vieja, nueva);
  }

  private async borrar(ruta: string): Promise<void> {
    const entrada = this.entradas.get(ruta);
    if (!entrada) return;
    const seguir = await confirmar(
      t("¿Mandar {0} a la papelera?", entrada.nombre),
      t("Lo podés recuperar desde la papelera de reciclaje de Windows."),
      t("Mandar a la papelera"),
    );
    if (!seguir) return;
    try {
      await invoke("enviar_papelera", { rutas: [ruta] });
      this.api.alBorrarRuta(ruta);
      if (this.seleccion === ruta) this.seleccion = null;
      await this.dibujar();
    } catch (error) {
      avisar(String(error));
    }
  }

  private copiarAlPortapapeles(ruta: string, cortar: boolean): void {
    this.portapapeles = { rutas: [ruta], cortar };
    const nombre = this.entradas.get(ruta)?.nombre ?? ruta;
    avisar(cortar ? t("Cortado: {0}", nombre) : t("Copiado: {0}", nombre));
    void this.dibujar();
  }

  private async pegar(): Promise<void> {
    const destino = this.carpetaDestino();
    if (!this.portapapeles || !destino) return;
    const { rutas, cortar } = this.portapapeles;
    await this.mover(rutas, destino, !cortar);
    if (cortar) this.portapapeles = null;
  }

  private async mover(rutas: string[], destino: string, copiar: boolean): Promise<void> {
    try {
      const hechos = await invoke<[string, string][]>("mover_rutas", { rutas, destino, copiar });
      if (!copiar) for (const [vieja, nueva] of hechos) this.renombrarEnEstado(vieja, nueva);
      if (destino !== this.raiz) this.expandidas.add(destino);
      if (hechos.length) this.seleccion = hechos[0][1];
      await this.dibujar();
    } catch (error) {
      avisar(t("No se pudo: {0}", String(error)));
    }
  }

  private async enviarRuta(ruta: string): Promise<void> {
    const panel = this.api.panel();
    if (!panel) return;
    const relativa = rutaRelativa(ruta, panel.carpeta);
    panel.enviarRuta(relativa);
    avisar(t("Ruta enviada: {0}", relativa));
  }

  private async copiarTexto(texto: string): Promise<void> {
    await navigator.clipboard.writeText(texto);
    avisar(t("Copiado: {0}", texto));
  }

  private abrirAcciones(entrada: EntradaArchivo, x: number, y: number): void {
    const relativa = rutaRelativa(entrada.ruta, this.api.panel()?.carpeta ?? null);
    const opciones: OpcionMenu[] = [];
    if (!entrada.directorio) opciones.push({ texto: t("Abrir en el visor"), accion: () => this.api.abrirArchivo(entrada.ruta) });
    opciones.push(
      { texto: t("Abrir con Windows"), accion: () => void invoke("abrir_externo", { destino: entrada.ruta }).catch((error) => avisar(String(error))) },
      { texto: t("Enviar ruta a la terminal"), accion: () => void this.enviarRuta(entrada.ruta) },
      { texto: t("Nuevo archivo"), accion: () => void this.crear(false) },
      { texto: t("Nueva carpeta"), accion: () => void this.crear(true) },
      { texto: t("Cortar (Ctrl+X)"), accion: () => this.copiarAlPortapapeles(entrada.ruta, true) },
      { texto: t("Copiar (Ctrl+C)"), accion: () => this.copiarAlPortapapeles(entrada.ruta, false) },
      { texto: t("Pegar (Ctrl+V)"), accion: () => void this.pegar(), desactivada: !this.portapapeles },
      { texto: t("Renombrar (F2)"), accion: () => this.renombrar(entrada.ruta) },
      { texto: t("Copiar ruta relativa"), accion: () => void this.copiarTexto(relativa) },
      { texto: t("Copiar ruta completa"), accion: () => void this.copiarTexto(entrada.ruta) },
      { texto: t("Mandar a la papelera (Supr)"), accion: () => void this.borrar(entrada.ruta), peligro: true },
    );
    abrirMenu(x, y, { opciones }, () => this.filaDe(entrada.ruta)?.focus());
  }

  private prepararTeclado(): void {
    this.arbol.addEventListener("contextmenu", (evento) => {
      // Clic derecho en el espacio vacío: crear o pegar en la raíz.
      evento.preventDefault();
      this.seleccionar(null);
      abrirMenu(evento.clientX, evento.clientY, {
        opciones: [
          { texto: t("Nuevo archivo"), accion: () => void this.crear(false) },
          { texto: t("Nueva carpeta"), accion: () => void this.crear(true) },
          { texto: t("Pegar (Ctrl+V)"), accion: () => void this.pegar(), desactivada: !this.portapapeles },
        ],
      }, () => undefined);
    });
    this.arbol.addEventListener("keydown", (evento) => {
      if (evento.target instanceof HTMLInputElement) return;
      const ruta = (document.activeElement as HTMLElement | null)?.dataset.ruta ?? this.seleccion;
      const tecla = evento.key.toLowerCase();
      const conCtrl = evento.ctrlKey || evento.metaKey;
      let usada = true;
      if (evento.key === "F2" && ruta) this.renombrar(ruta);
      else if (evento.key === "Delete" && ruta) void this.borrar(ruta);
      else if (conCtrl && tecla === "c" && ruta) this.copiarAlPortapapeles(ruta, false);
      else if (conCtrl && tecla === "x" && ruta) this.copiarAlPortapapeles(ruta, true);
      else if (conCtrl && tecla === "v") void this.pegar();
      else if (evento.key === "ArrowDown" || evento.key === "ArrowUp") this.moverFoco(evento.key === "ArrowDown" ? 1 : -1);
      else usada = false;
      if (usada) {
        evento.preventDefault();
        evento.stopPropagation();
      }
    });
  }

  private moverFoco(paso: number): void {
    const filas = [...this.arbol.querySelectorAll<HTMLElement>(".archivos__fila")];
    const actual = filas.indexOf(document.activeElement as HTMLElement);
    const siguiente = filas[Math.max(0, Math.min(filas.length - 1, actual + paso))];
    if (!siguiente) return;
    siguiente.focus();
    this.seleccionar(siguiente.dataset.ruta ?? null);
  }

  // Soltar en una carpeta mueve (con Ctrl, copia). Soltar sobre la terminal escribe la ruta.
  private prepararSoltar(): void {
    const esNuestro = (evento: DragEvent) => Boolean(evento.dataTransfer?.types.includes(TIPO_ARRASTRE));
    const destinoDe = (evento: DragEvent): { carpeta: string; fila: HTMLElement | null } | null => {
      const fila = (evento.target as HTMLElement).closest<HTMLElement>(".archivos__fila");
      const ruta = fila?.dataset.ruta;
      if (!ruta) return this.raiz ? { carpeta: this.raiz, fila: null } : null;
      const entrada = this.entradas.get(ruta);
      return { carpeta: entrada?.directorio ? ruta : carpetaPadre(ruta), fila: entrada?.directorio ? fila : null };
    };
    const limpiar = () => {
      for (const fila of this.arbol.querySelectorAll(".archivos__fila--destino")) fila.classList.remove("archivos__fila--destino");
      this.arbol.classList.remove("archivos__arbol--destino");
    };

    this.arbol.addEventListener("dragover", (evento) => {
      if (!esNuestro(evento)) return;
      evento.preventDefault();
      if (evento.dataTransfer) evento.dataTransfer.dropEffect = evento.ctrlKey ? "copy" : "move";
      const destino = destinoDe(evento);
      limpiar();
      if (destino?.fila) destino.fila.classList.add("archivos__fila--destino");
      else this.arbol.classList.add("archivos__arbol--destino");
    });
    this.arbol.addEventListener("dragleave", (evento) => {
      if (!this.arbol.contains(evento.relatedTarget as Node)) limpiar();
    });
    this.arbol.addEventListener("drop", (evento) => {
      limpiar();
      const ruta = evento.dataTransfer?.getData(TIPO_ARRASTRE);
      const destino = destinoDe(evento);
      if (!ruta || !destino) return;
      evento.preventDefault();
      void this.mover([ruta], destino.carpeta, evento.ctrlKey);
    });
    this.arbol.addEventListener("dragend", limpiar);

    const terminal = document.getElementById("contenido");
    terminal?.addEventListener("dragover", (evento) => {
      if (!esNuestro(evento)) return;
      evento.preventDefault();
      if (evento.dataTransfer) evento.dataTransfer.dropEffect = "copy";
    });
    terminal?.addEventListener("drop", (evento) => {
      const ruta = evento.dataTransfer?.getData(TIPO_ARRASTRE);
      if (!ruta) return;
      evento.preventDefault();
      void this.enviarRuta(ruta);
    });
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
