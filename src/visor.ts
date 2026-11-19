import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Text } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { avisar, confirmar } from "./dialogos";
import { t } from "./i18n";

type Tipo = "codigo" | "markdown" | "html" | "imagen" | "video" | "audio" | "pdf" | "hoja" | "word" | "binario";

interface Documento {
  ruta: string;
  tipo: Tipo;
  pestana: HTMLElement;
  contenido: HTMLElement;
  vista: EditorView | null;
  guardado: Text | null;
  sucio: boolean;
  crlf: boolean;
  bom: boolean;
  fecha: number;
  modo: "vista" | "codigo";
  url: string | null;
  cambioAfuera: boolean;
}

interface DatosTexto {
  texto?: string;
  crlf?: boolean;
  bom?: boolean;
  fecha?: number;
  binario?: boolean;
  grande?: boolean;
  tamano: number;
}

const EXTENSIONES: Record<string, Tipo> = {
  md: "markdown", markdown: "markdown", mdx: "markdown",
  html: "html", htm: "html", xhtml: "html",
  png: "imagen", jpg: "imagen", jpeg: "imagen", gif: "imagen", webp: "imagen", bmp: "imagen", ico: "imagen", svg: "imagen", avif: "imagen",
  mp4: "video", webm: "video", mov: "video", m4v: "video",
  mp3: "audio", wav: "audio", ogg: "audio", flac: "audio", m4a: "audio", opus: "audio",
  pdf: "pdf",
  xlsx: "hoja", xlsm: "hoja", xls: "hoja", ods: "hoja", csv: "hoja", tsv: "hoja",
  docx: "word",
  exe: "binario", dll: "binario", zip: "binario", "7z": "binario", rar: "binario", iso: "binario", msi: "binario",
  pptx: "binario", ppt: "binario", doc: "binario", uasset: "binario", umap: "binario", blend: "binario", fbx: "binario",
};

const TIPOS_MIME: Record<string, string> = {
  svg: "image/svg+xml", pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  m4v: "video/mp4", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4", opus: "audio/ogg",
};

const ICONO_CERRAR = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1L1 9" /></svg>';

const ESTILO_SINTAXIS = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword], color: "#c9a6ff" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "#6fdc9c" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "#f4c96b" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#6b6880", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#74a7ff" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#62d6e8" },
  { tag: [tags.tagName], color: "#ff6b81" },
  { tag: [tags.attributeName], color: "#f4c96b" },
  { tag: [tags.heading], color: "#c9a6ff", fontWeight: "700" },
  { tag: [tags.link, tags.url], color: "#74a7ff", textDecoration: "underline" },
  { tag: [tags.emphasis], fontStyle: "italic" },
  { tag: [tags.strong], fontWeight: "700" },
  { tag: [tags.meta, tags.processingInstruction], color: "#9a98a8" },
  { tag: [tags.invalid], color: "#e5484d" },
]);

const TEMA_EDITOR = EditorView.theme(
  {
    "&": { height: "100%", color: "var(--texto)", backgroundColor: "var(--fondo)", fontSize: "13px" },
    ".cm-scroller": { fontFamily: "var(--fuente-mono)", lineHeight: "1.55" },
    ".cm-content": { caretColor: "var(--acento-claro)" },
    ".cm-cursor": { borderLeftColor: "var(--acento-claro)" },
    ".cm-gutters": { backgroundColor: "var(--fondo)", color: "#5d5a6e", border: "none" },
    ".cm-activeLine": { backgroundColor: "#ffffff08" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--texto-suave)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in srgb, var(--acento) 35%, transparent) !important",
    },
    ".cm-selectionMatch": { backgroundColor: "#ffffff14" },
    ".cm-panels": { backgroundColor: "var(--fondo-elevado)", color: "var(--texto)" },
  },
  { dark: true },
);

function extension(ruta: string): string {
  const nombre = nombreDe(ruta);
  const punto = nombre.lastIndexOf(".");
  return punto > 0 ? nombre.slice(punto + 1).toLowerCase() : "";
}

function nombreDe(ruta: string): string {
  return ruta.split(/[\\/]/).filter(Boolean).at(-1) ?? ruta;
}

function mismaRuta(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function nota(texto: string): HTMLElement {
  const elemento = document.createElement("div");
  elemento.className = "visor__nota";
  elemento.textContent = texto;
  return elemento;
}

async function limpiarHtml(html: string): Promise<string> {
  const { default: DOMPurify } = await import("dompurify");
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

// Pregunta qué hacer con los cambios de un archivo antes de cerrarlo.
function preguntarGuardar(nombre: string): Promise<"guardar" | "descartar" | "cancelar"> {
  return new Promise((resolver) => {
    const dialogo = document.createElement("dialog");
    dialogo.className = "dialogo";
    const titulo = document.createElement("h2");
    titulo.className = "dialogo__titulo";
    titulo.textContent = t("¿Guardar los cambios de {0}?", nombre);
    const mensaje = document.createElement("p");
    mensaje.className = "dialogo__mensaje";
    mensaje.textContent = t("Si no los guardás, se pierden.");
    const acciones = document.createElement("div");
    acciones.className = "dialogo__acciones";
    let respuesta: "guardar" | "descartar" | "cancelar" = "cancelar";
    const boton = (texto: string, clase: string, valor: typeof respuesta) => {
      const elemento = document.createElement("button");
      elemento.type = "button";
      elemento.className = clase;
      elemento.textContent = texto;
      elemento.addEventListener("click", () => {
        respuesta = valor;
        dialogo.close();
      });
      return elemento;
    };
    const guardar = boton(t("Guardar"), "boton boton--principal", "guardar");
    acciones.append(boton(t("Cancelar"), "boton", "cancelar"), boton(t("No guardar"), "boton boton--peligro", "descartar"), guardar);
    dialogo.append(titulo, mensaje, acciones);
    dialogo.addEventListener("keydown", (evento) => evento.stopPropagation());
    dialogo.addEventListener("close", () => {
      dialogo.remove();
      resolver(respuesta);
    });
    document.body.append(dialogo);
    dialogo.showModal();
    guardar.focus();
  });
}

export interface ApiVisor {
  alCerrar(): void;
}

const CLAVE_ANCHO = "mahzz-visor-ancho";
const ANCHO_MINIMO = 280;
const INTERVALO_REVISION = 2500;

// Panel lateral que muestra y edita archivos. Cada archivo abierto es una pestaña.
export class PanelVisor {
  private readonly pestanas = document.createElement("div");
  private readonly ruta = document.createElement("span");
  private readonly aviso = document.createElement("span");
  private readonly botonModo = document.createElement("button");
  private readonly botonGuardar = document.createElement("button");
  private readonly cuerpo = document.createElement("div");
  private documentos: Documento[] = [];
  private activo: Documento | null = null;
  private revisando = false;

  constructor(
    private readonly elemento: HTMLElement,
    private readonly api: ApiVisor,
  ) {
    const asa = document.createElement("div");
    asa.className = "visor__asa";
    asa.addEventListener("pointerdown", (evento) => this.iniciarAjusteAncho(asa, evento));

    const cabecera = document.createElement("div");
    cabecera.className = "visor__cabecera";
    this.pestanas.className = "visor__pestanas";
    const cerrarPanel = this.crearBoton(ICONO_CERRAR, t("Ocultar el visor"), () => this.ocultar());
    cabecera.append(this.pestanas, cerrarPanel);

    const barra = document.createElement("div");
    barra.className = "visor__barra";
    this.ruta.className = "visor__ruta";
    this.aviso.className = "visor__aviso";
    this.botonModo.type = "button";
    this.botonModo.className = "visor__accion";
    this.botonModo.addEventListener("click", () => void this.alternarModo());
    this.botonGuardar.type = "button";
    this.botonGuardar.className = "visor__accion visor__accion--guardar";
    this.botonGuardar.textContent = t("Guardar");
    this.botonGuardar.title = t("Guardar (Ctrl+S)");
    this.botonGuardar.addEventListener("click", () => void this.guardar());
    const externo = document.createElement("button");
    externo.type = "button";
    externo.className = "visor__accion";
    externo.textContent = t("Abrir afuera");
    externo.title = t("Abrir con el programa de Windows");
    externo.addEventListener("click", () => {
      if (this.activo) void invoke("abrir_externo", { destino: this.activo.ruta }).catch((error) => avisar(String(error)));
    });
    barra.append(this.ruta, this.aviso, this.botonModo, this.botonGuardar, externo);

    this.cuerpo.className = "visor__cuerpo";
    this.elemento.append(asa, cabecera, barra, this.cuerpo);

    try {
      const ancho = Number(localStorage.getItem(CLAVE_ANCHO));
      if (ancho >= ANCHO_MINIMO) this.elemento.style.width = `${ancho}px`;
    } catch {
      // Sin almacenamiento se usa el ancho de fábrica.
    }

    this.elemento.addEventListener("keydown", (evento) => {
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "s") {
        evento.preventDefault();
        void this.guardar();
      }
    });
    // Los agentes cambian archivos mientras están abiertos: se revisa cada tanto.
    setInterval(() => void this.revisarCambiosAfuera(), INTERVALO_REVISION);
    window.addEventListener("focus", () => void this.revisarCambiosAfuera());
  }

  private crearBoton(icono: string, titulo: string, accion: () => void): HTMLButtonElement {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "visor__icono";
    boton.title = titulo;
    boton.setAttribute("aria-label", titulo);
    boton.innerHTML = icono;
    boton.addEventListener("click", accion);
    return boton;
  }

  get visible(): boolean {
    return !this.elemento.hidden;
  }

  hayCambiosSinGuardar(): boolean {
    return this.documentos.some((documento) => documento.sucio);
  }

  private ocultar(): void {
    this.elemento.hidden = true;
    this.api.alCerrar();
  }

  async abrir(ruta: string): Promise<void> {
    this.elemento.hidden = false;
    const abierto = this.documentos.find((documento) => mismaRuta(documento.ruta, ruta));
    if (abierto) {
      this.activar(abierto);
      return;
    }
    const tipo = EXTENSIONES[extension(ruta)] ?? "codigo";
    const documento: Documento = {
      ruta,
      tipo,
      pestana: document.createElement("div"),
      contenido: document.createElement("div"),
      vista: null,
      guardado: null,
      sucio: false,
      crlf: false,
      bom: false,
      fecha: 0,
      modo: tipo === "markdown" || tipo === "html" ? "vista" : "codigo",
      url: null,
      cambioAfuera: false,
    };
    documento.contenido.className = "visor__contenido";
    this.crearPestana(documento);
    this.documentos.push(documento);
    this.activar(documento);
    await this.cargar(documento);
  }

  private crearPestana(documento: Documento): void {
    const pestana = documento.pestana;
    pestana.className = "visor__pestana";
    pestana.title = documento.ruta;
    const nombre = document.createElement("span");
    nombre.className = "visor__pestana-nombre";
    nombre.textContent = nombreDe(documento.ruta);
    const cerrar = document.createElement("button");
    cerrar.type = "button";
    cerrar.className = "visor__pestana-cerrar";
    cerrar.setAttribute("aria-label", t("Cerrar"));
    cerrar.innerHTML = ICONO_CERRAR;
    cerrar.addEventListener("click", (evento) => {
      evento.stopPropagation();
      void this.cerrar(documento);
    });
    pestana.append(nombre, cerrar);
    pestana.addEventListener("click", () => this.activar(documento));
    pestana.addEventListener("auxclick", (evento) => {
      if (evento.button === 1) void this.cerrar(documento);
    });
    this.pestanas.append(pestana);
  }

  private activar(documento: Documento): void {
    this.activo = documento;
    for (const actual of this.documentos) actual.pestana.classList.toggle("visor__pestana--activa", actual === documento);
    this.cuerpo.replaceChildren(documento.contenido);
    documento.pestana.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.pintarBarra();
    documento.vista?.focus();
  }

  private pintarBarra(): void {
    const documento = this.activo;
    if (!documento) return;
    this.ruta.textContent = documento.ruta;
    this.ruta.title = documento.ruta;
    documento.pestana.classList.toggle("visor__pestana--sucia", documento.sucio);
    const conVista = documento.tipo === "markdown" || documento.tipo === "html";
    this.botonGuardar.hidden = !documento.sucio;
    this.botonModo.hidden = !conVista;
    if (documento.tipo === "html") this.botonModo.textContent = documento.modo === "vista" ? t("Código") : t("Web");
    else this.botonModo.textContent = documento.modo === "vista" ? t("Editar") : t("Vista");
    // La vista web carga el archivo del disco: con cambios sin guardar muestra la última versión guardada.
    const webDesactualizada = documento.tipo === "html" && documento.modo === "vista" && documento.sucio;
    this.aviso.textContent = documento.cambioAfuera
      ? t("Cambió afuera")
      : webDesactualizada
        ? t("Web de lo guardado")
        : documento.sucio
          ? t("Cambios sin guardar")
          : "";
    this.aviso.classList.toggle("visor__aviso--afuera", documento.cambioAfuera);
  }

  private async cargar(documento: Documento, recargando = false): Promise<void> {
    try {
      if (documento.tipo === "codigo" || documento.tipo === "markdown" || documento.tipo === "html") {
        await this.cargarTexto(documento, recargando);
      }
      else await this.cargarBinario(documento);
    } catch (error) {
      documento.contenido.replaceChildren(nota(t("No se pudo abrir: {0}", String(error))));
    }
    if (documento === this.activo) this.pintarBarra();
  }

  private async cargarTexto(documento: Documento, recargando: boolean): Promise<void> {
    const datos = await invoke<DatosTexto>("leer_texto", { ruta: documento.ruta });
    if (datos.binario || datos.grande || datos.texto === undefined) {
      documento.tipo = "binario";
      const mensaje = datos.grande
        ? t("Archivo demasiado grande para abrirlo acá ({0}).", tamanoLegible(datos.tamano))
        : t("Archivo binario: no se puede mostrar como texto.");
      documento.contenido.replaceChildren(nota(mensaje));
      return;
    }
    documento.crlf = Boolean(datos.crlf);
    documento.bom = Boolean(datos.bom);
    documento.fecha = datos.fecha ?? 0;
    documento.cambioAfuera = false;

    if (documento.vista && recargando) {
      // Se reemplaza el texto en el mismo editor para no perder el desplazamiento.
      const vista = documento.vista;
      vista.dispatch({ changes: { from: 0, to: vista.state.doc.length, insert: datos.texto } });
      documento.guardado = vista.state.doc;
      documento.sucio = false;
    } else {
      const lenguaje = new Compartment();
      const estado = EditorState.create({
        doc: datos.texto,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          syntaxHighlighting(ESTILO_SINTAXIS),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
          lenguaje.of([]),
          TEMA_EDITOR,
          EditorView.updateListener.of((cambio) => {
            if (!cambio.docChanged || !documento.guardado) return;
            const sucio = !cambio.state.doc.eq(documento.guardado);
            if (sucio !== documento.sucio) {
              documento.sucio = sucio;
              if (documento === this.activo) this.pintarBarra();
              else documento.pestana.classList.toggle("visor__pestana--sucia", sucio);
            }
          }),
        ],
      });
      documento.vista = new EditorView({ state: estado });
      documento.guardado = estado.doc;
      void this.ponerLenguaje(documento, lenguaje);
    }
    this.mostrarTexto(documento);
  }

  // El resaltado de cada lenguaje se descarga recién cuando se abre un archivo de ese tipo.
  private async ponerLenguaje(documento: Documento, lenguaje: Compartment): Promise<void> {
    const { languages } = await import("@codemirror/language-data");
    const descripcion = LanguageDescription.matchFilename(languages, nombreDe(documento.ruta));
    if (!descripcion || !documento.vista) return;
    const soporte = await descripcion.load();
    documento.vista.dispatch({ effects: lenguaje.reconfigure(soporte) });
  }

  private async mostrarTexto(documento: Documento): Promise<void> {
    if (!documento.vista) return;
    if (documento.tipo === "html" && documento.modo === "vista") {
      await this.mostrarWeb(documento);
    } else if (documento.tipo === "markdown" && documento.modo === "vista") {
      const [{ marked }] = await Promise.all([import("marked")]);
      const html = await limpiarHtml(await marked.parse(documento.vista.state.doc.toString()));
      const lectura = document.createElement("article");
      lectura.className = "visor__md";
      lectura.innerHTML = html;
      lectura.addEventListener("click", (evento) => {
        const enlace = (evento.target as HTMLElement).closest("a");
        if (!enlace) return;
        evento.preventDefault();
        const destino = enlace.getAttribute("href") ?? "";
        if (/^https?:\/\//i.test(destino)) void invoke("abrir_externo", { destino });
      });
      documento.contenido.replaceChildren(lectura);
    } else {
      documento.contenido.replaceChildren(documento.vista.dom);
      if (documento === this.activo) documento.vista.focus();
    }
  }

  // La página corre en un marco aislado: sus scripts funcionan, pero no pueden tocar la terminal.
  private async mostrarWeb(documento: Documento): Promise<void> {
    try {
      await invoke("permitir_vista_html", { ruta: documento.ruta });
    } catch (error) {
      documento.contenido.replaceChildren(nota(t("No se pudo abrir: {0}", String(error))));
      return;
    }
    const marco = document.createElement("iframe");
    marco.className = "visor__web";
    marco.title = nombreDe(documento.ruta);
    marco.setAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-popups");
    // La fecha en la dirección evita que se vea una versión vieja guardada en caché.
    marco.src = `${convertFileSrc(documento.ruta)}?v=${documento.fecha}`;
    documento.contenido.replaceChildren(marco);
  }

  private async alternarModo(): Promise<void> {
    const documento = this.activo;
    if (!documento || (documento.tipo !== "markdown" && documento.tipo !== "html")) return;
    documento.modo = documento.modo === "vista" ? "codigo" : "vista";
    await this.mostrarTexto(documento);
    this.pintarBarra();
  }

  private async cargarBinario(documento: Documento): Promise<void> {
    if (documento.tipo === "binario") {
      documento.contenido.replaceChildren(nota(t("Este tipo de archivo no se puede mostrar acá. Usá \"Abrir afuera\".")));
      return;
    }
    documento.fecha = await invoke<number>("fecha_archivo", { ruta: documento.ruta });
    documento.cambioAfuera = false;
    const bytes = await invoke<ArrayBuffer>("leer_binario", { ruta: documento.ruta });
    const ext = extension(documento.ruta);
    if (documento.url) URL.revokeObjectURL(documento.url);
    documento.url = null;

    if (documento.tipo === "hoja") {
      await this.mostrarHoja(documento, bytes);
      return;
    }
    if (documento.tipo === "word") {
      const mammoth = await import("mammoth");
      const resultado = await mammoth.convertToHtml({ arrayBuffer: bytes });
      const lectura = document.createElement("article");
      lectura.className = "visor__md visor__word";
      lectura.innerHTML = await limpiarHtml(resultado.value);
      documento.contenido.replaceChildren(lectura);
      return;
    }

    const url = URL.createObjectURL(new Blob([bytes], { type: TIPOS_MIME[ext] ?? "" }));
    documento.url = url;
    let medio: HTMLElement;
    if (documento.tipo === "imagen") {
      const imagen = document.createElement("img");
      imagen.src = url;
      imagen.alt = nombreDe(documento.ruta);
      imagen.addEventListener("click", () => imagen.classList.toggle("visor__imagen--real"));
      medio = imagen;
    } else if (documento.tipo === "pdf") {
      const marco = document.createElement("iframe");
      marco.src = url;
      marco.title = nombreDe(documento.ruta);
      medio = marco;
    } else {
      const reproductor = document.createElement(documento.tipo === "video" ? "video" : "audio");
      reproductor.src = url;
      reproductor.controls = true;
      medio = reproductor;
    }
    const marco = document.createElement("div");
    marco.className = `visor__medio visor__medio--${documento.tipo}`;
    marco.append(medio);
    documento.contenido.replaceChildren(marco);
  }

  private async mostrarHoja(documento: Documento, bytes: ArrayBuffer): Promise<void> {
    const XLSX = await import("xlsx");
    // Con planillas enormes se muestran las primeras filas para no llenar la memoria.
    const libro = XLSX.read(new Uint8Array(bytes), { type: "array", sheetRows: 3000, dense: true });
    const contenedor = document.createElement("div");
    contenedor.className = "visor__hoja";
    const hojas = document.createElement("div");
    hojas.className = "visor__hojas";
    const tabla = document.createElement("div");
    tabla.className = "visor__tabla";
    const mostrar = async (nombre: string) => {
      for (const boton of hojas.children) boton.classList.toggle("visor__hoja-activa", (boton as HTMLElement).dataset.hoja === nombre);
      const html = XLSX.utils.sheet_to_html(libro.Sheets[nombre], { header: "", footer: "" });
      tabla.innerHTML = await limpiarHtml(html);
    };
    for (const nombre of libro.SheetNames) {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.dataset.hoja = nombre;
      boton.textContent = nombre;
      boton.addEventListener("click", () => void mostrar(nombre));
      hojas.append(boton);
    }
    contenedor.append(tabla);
    if (libro.SheetNames.length > 1) contenedor.append(hojas);
    documento.contenido.replaceChildren(contenedor);
    if (libro.SheetNames[0]) await mostrar(libro.SheetNames[0]);
  }

  async guardar(forzar = false): Promise<boolean> {
    const documento = this.activo;
    if (!documento?.vista || !documento.sucio) return true;
    return this.guardarDocumento(documento, forzar);
  }

  private async guardarDocumento(documento: Documento, forzar = false): Promise<boolean> {
    if (!documento.vista) return true;
    const texto = documento.vista.state.doc;
    try {
      documento.fecha = await invoke<number>("guardar_texto", {
        ruta: documento.ruta,
        texto: texto.toString(),
        crlf: documento.crlf,
        bom: documento.bom,
        fecha: documento.fecha,
        forzar,
      });
    } catch (error) {
      if (String(error).includes("CAMBIADO_AFUERA")) {
        const reemplazar = await confirmar(
          t("{0} cambió afuera", nombreDe(documento.ruta)),
          t("Alguien (o un agente) lo modificó después de que lo abriste. ¿Lo reemplazás con tu versión?"),
          t("Reemplazar"),
        );
        return reemplazar ? this.guardarDocumento(documento, true) : false;
      }
      avisar(t("No se pudo guardar: {0}", String(error)));
      return false;
    }
    documento.guardado = texto;
    documento.sucio = false;
    documento.cambioAfuera = false;
    if (documento.modo === "vista") await this.mostrarTexto(documento);
    if (documento === this.activo) this.pintarBarra();
    else documento.pestana.classList.remove("visor__pestana--sucia");
    avisar(t("Guardado: {0}", nombreDe(documento.ruta)));
    return true;
  }

  private async cerrar(documento: Documento): Promise<void> {
    if (documento.sucio) {
      this.activar(documento);
      const respuesta = await preguntarGuardar(nombreDe(documento.ruta));
      if (respuesta === "cancelar") return;
      if (respuesta === "guardar" && !(await this.guardarDocumento(documento))) return;
    }
    const indice = this.documentos.indexOf(documento);
    this.documentos.splice(indice, 1);
    documento.pestana.remove();
    documento.vista?.destroy();
    if (documento.url) URL.revokeObjectURL(documento.url);
    if (this.activo === documento) {
      this.activo = null;
      const siguiente = this.documentos[Math.min(indice, this.documentos.length - 1)];
      if (siguiente) this.activar(siguiente);
      else this.ocultar();
    }
  }

  // Si el archivo cambió en el disco: sin cambios propios se recarga solo; con cambios, se avisa.
  private async revisarCambiosAfuera(): Promise<void> {
    const documento = this.activo;
    if (!documento || !this.visible || this.revisando || documento.fecha === 0) return;
    if (document.visibilityState !== "visible") return;
    this.revisando = true;
    try {
      const fecha = await invoke<number>("fecha_archivo", { ruta: documento.ruta });
      if (fecha === 0 || fecha === documento.fecha) return;
      if (documento.sucio) {
        documento.cambioAfuera = true;
        this.pintarBarra();
      } else {
        await this.cargar(documento, true);
      }
    } finally {
      this.revisando = false;
    }
  }

  // Avisos del panel de archivos: renombres, movidas y borrados.
  alMoverRuta(vieja: string, nueva: string): void {
    const prefijo = vieja.toLowerCase() + "\\";
    for (const documento of this.documentos) {
      const ruta = documento.ruta;
      if (mismaRuta(ruta, vieja)) documento.ruta = nueva;
      else if (ruta.toLowerCase().startsWith(prefijo)) documento.ruta = nueva + ruta.slice(vieja.length);
      else continue;
      documento.pestana.title = documento.ruta;
      const nombre = documento.pestana.querySelector(".visor__pestana-nombre");
      if (nombre) nombre.textContent = nombreDe(documento.ruta);
    }
    this.pintarBarra();
  }

  alBorrarRuta(ruta: string): void {
    const prefijo = ruta.toLowerCase() + "\\";
    for (const documento of [...this.documentos]) {
      const afectado = mismaRuta(documento.ruta, ruta) || documento.ruta.toLowerCase().startsWith(prefijo);
      if (afectado && !documento.sucio) void this.cerrar(documento);
    }
  }

  private iniciarAjusteAncho(asa: HTMLElement, inicio: PointerEvent): void {
    inicio.preventDefault();
    asa.setPointerCapture(inicio.pointerId);
    const derecha = this.elemento.getBoundingClientRect().right;
    const mover = (evento: PointerEvent) => {
      const maximo = Math.max(ANCHO_MINIMO, innerWidth - 320);
      const ancho = Math.min(maximo, Math.max(ANCHO_MINIMO, derecha - evento.clientX));
      this.elemento.style.width = `${ancho}px`;
    };
    const soltar = () => {
      asa.removeEventListener("pointermove", mover);
      asa.removeEventListener("pointerup", soltar);
      try {
        localStorage.setItem(CLAVE_ANCHO, String(Math.round(this.elemento.getBoundingClientRect().width)));
      } catch {
        // Sin almacenamiento el ancho dura hasta cerrar la ventana.
      }
    };
    asa.addEventListener("pointermove", mover);
    asa.addEventListener("pointerup", soltar);
  }
}
