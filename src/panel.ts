import { Channel, invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type IMarker } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { capturarRango } from "./ansi";
import { ListaBloques, type DatosBloque } from "./bloques";
import { VerificadorComandos } from "./comandos";
import { BarraContexto, type DatosGit, type DatosProyecto } from "./contexto";
import { MotorAutocompletado } from "./autocompletado";
import { EditorComandos } from "./editor";
import { registrarEnHistorial } from "./historial";
import { ajustes } from "./ajustes";
import { confirmar } from "./dialogos";
import { t } from "./i18n";
import { temaTerminal } from "./temas";

const LINEAS_ILIMITADAS = 1_000_000;
const MAXIMO_REINTENTOS = 5;
const ESPERA_REINTENTO = 400;
const VENTANA_REINTENTOS = 60_000;
const MARGEN_VIVO = 12;
const COMANDOS_LIMPIAR = /^\s*(cls|clear|clear-host)\s*$/i;
// Los comandos rápidos terminan antes de este tiempo y así el editor no parpadea.
const RETRASO_EJECUCION = 120;
const ESPERA_LECTURA = 80;
const LIMITE_ARRANQUE = 6000;
// La salida que llega justo después de una tecla es el eco de lo escrito, no trabajo del programa.
const MARGEN_ECO = 400;

interface ComandoEnCurso {
  comando: string;
  carpeta: string | null;
  rama: string | null;
  inicio: number;
  marcador: IMarker | null;
}

interface DatosEnCurso {
  comando: string;
  carpeta: string | null;
  rama: string | null;
  inicio: number;
  linea: number;
}

interface EstadoRemoto {
  host: string;
  carpeta: string | null;
  conexion: ComandoEnCurso | null;
}

interface DatosRemoto {
  host: string;
  carpeta: string | null;
  conexion: Omit<ComandoEnCurso, "marcador"> | null;
}

export interface DatosPanel {
  remoto?: DatosRemoto | null;
  sesion: number | null;
  carpeta: string | null;
  contenido: string | null;
  bloques?: DatosBloque[];
  rama?: string | null;
  enCurso?: DatosEnCurso | null;
  borrador?: string;
  // Solo se guarda en las sesiones, para saber si había un agente corriendo.
  programa?: string | null;
}

export interface EventosPanel {
  alEnfocar(panel: Panel): void;
  alCambiarEstado(panel: Panel): void;
  alBuscarBloque(panel: Panel, id: number): void;
}

// Convierte el aviso del shell (file:///C:/Users/...) en una ruta de Windows.
function rutaDesdeUri(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return null;
    const ruta = decodeURIComponent(url.pathname).replaceAll("/", "\\");
    return url.hostname ? `\\\\${url.hostname}${ruta}` : ruta.slice(1);
  } catch {
    return null;
  }
}

function decodificarBase64(valor: string): string {
  try {
    const bytes = Uint8Array.from(atob(valor), (caracter) => caracter.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function fuenteActual(): string {
  return `"${ajustes().fuente}", "JetBrains Mono", Consolas, monospace`;
}

function lineasHistorial(): number {
  return ajustes().scrollback === 0 ? LINEAS_ILIMITADAS : ajustes().scrollback;
}

function codificarBase64(texto: string): string {
  let binario = "";
  for (const byte of new TextEncoder().encode(texto)) binario += String.fromCharCode(byte);
  return btoa(binario);
}

export class Panel {
  readonly elemento = document.createElement("div");
  readonly terminal: Terminal;
  readonly lista: ListaBloques;
  sesion: number | null = null;
  carpeta: string | null;
  programa: string | null = null;
  // Datos que usa el panel de agentes para saber si un programa está trabajando.
  ultimaSalida = 0;
  programaDesde = 0;
  pideAtencion = false;
  private ultimaEntrada = 0;

  private readonly lienzo = document.createElement("div");
  private readonly entrada = document.createElement("div");
  private readonly editor: EditorComandos;
  private readonly contexto: BarraContexto;
  private readonly verificador: VerificadorComandos;
  private readonly proyectos = new Map<string, DatosProyecto | null>();
  private readonly ajuste = new FitAddon();
  private readonly serializador = new SerializeAddon();
  private readonly observador: ResizeObserver;
  private webgl: WebglAddon | null = null;
  private dibujoVisible = false;
  private reintentosDibujo = 0;
  private ultimaPerdida = 0;
  private abierto = false;
  private esperandoReinicio = false;
  private conectando = false;
  private entradaPendiente = "";
  private generacion = 0;
  private candidato: string | null = null;
  private cuadroPendiente = 0;
  private cuadroVivo = 0;
  private rama: string | null;
  private enCurso: ComandoEnCurso | null = null;
  private remoto: EstadoRemoto | null = null;
  private inicioDesde = 0;
  private inicioCapturado: boolean;
  private filasMaximas = 1;
  private listo = false;
  private enviando = false;
  private comandoPendiente: string | null = null;
  private temporizadorEjecucion = 0;
  private temporizadorListo = 0;
  private temporizadorArranque = 0;
  private consultaGit = 0;

  constructor(
    private readonly eventos: EventosPanel,
    private readonly datos: DatosPanel = { sesion: null, carpeta: null, contenido: null },
  ) {
    this.carpeta = datos.carpeta;
    this.rama = datos.rama ?? null;
    this.inicioCapturado = datos.sesion !== null;
    this.elemento.className = "panel";
    this.lienzo.className = "panel__lienzo";
    this.entrada.className = "entrada";

    this.lista = new ListaBloques({
      alEjecutar: (comando) => void this.enviar(comando),
      alBuscarEn: (id) => this.eventos.alBuscarBloque(this, id),
      alEnfocarTerminal: () => this.enfocar(),
      puedeEjecutar: () => this.sesion !== null && !this.ocupado && !this.enviando,
    });

    this.verificador = new VerificadorComandos(() => this.carpeta);
    this.editor = new EditorComandos(
      {
        alEjecutar: (comando) => this.enviar(comando),
        alEnfocar: () => this.eventos.alEnfocar(this),
      },
      this.verificador,
      new MotorAutocompletado(() => this.carpeta, this.verificador),
      () => this.carpetaActual,
      datos.borrador ?? "",
    );
    this.contexto = new BarraContexto(() => void this.elegirCarpeta());
    this.entrada.append(this.contexto.elemento, this.editor.elemento);
    this.elemento.append(this.lista.elemento, this.lienzo, this.entrada);

    this.terminal = new Terminal({
      fontFamily: fuenteActual(),
      fontSize: ajustes().tamanoFuente,
      lineHeight: 1.2,
      cursorStyle: ajustes().cursor,
      cursorInactiveStyle: "outline",
      cursorBlink: ajustes().parpadeo,
      scrollback: lineasHistorial(),
      allowProposedApi: true,
      theme: temaTerminal(),
    });
    this.terminal.loadAddon(this.ajuste);
    this.terminal.loadAddon(this.serializador);

    this.observador = new ResizeObserver(() => {
      cancelAnimationFrame(this.cuadroPendiente);
      this.cuadroPendiente = requestAnimationFrame(() => {
        this.ajustar();
        this.programarVivo();
      });
    });
  }

  get hostRemoto(): string | null {
    return this.remoto?.host ?? null;
  }

  private get carpetaActual(): string | null {
    return this.remoto ? this.remoto.carpeta : this.carpeta;
  }

  // Mientras corre un programa, las teclas y atajos de bloques le pertenecen a él.
  get ocupado(): boolean {
    return this.enCurso !== null || this.terminal.buffer.active.type === "alternate";
  }

  // La terminal recibe el teclado solo cuando un programa la necesita.
  private get usaTerminal(): boolean {
    return (
      this.elemento.classList.contains("panel--ejecutando") ||
      this.elemento.classList.contains("panel--sin-shell") ||
      this.terminal.buffer.active.type === "alternate"
    );
  }

  private get terminalTieneFoco(): boolean {
    return document.activeElement === this.terminal.textarea;
  }

  // Se llama con el panel ya agregado a la página, porque xterm necesita medirlo.
  async iniciar(): Promise<void> {
    this.terminal.open(this.lienzo);
    this.abierto = true;
    this.activarDibujo(true);
    this.ajustar();
    this.conectarEventos();
    this.observador.observe(this.elemento);
    this.observador.observe(this.entrada);

    for (const bloque of this.datos.bloques ?? []) this.lista.agregar(bloque);
    if (this.datos.remoto) {
      const { host, carpeta, conexion } = this.datos.remoto;
      this.remoto = { host, carpeta, conexion: conexion && { ...conexion, marcador: null } };
      this.verificador.definirRemoto(true);
      this.contexto.definirSsh(host);
    }
    this.actualizarContexto();

    if (this.datos.contenido) {
      await new Promise<void>((listo) => this.terminal.write(this.datos.contenido ?? "", listo));
    }
    this.restaurarEnCurso();
    this.programarVivo();

    if (this.datos.sesion !== null) {
      await this.adjuntar(this.datos.sesion);
      this.listo = this.enCurso === null;
    } else {
      await this.abrirSesion();
    }
  }

  private restaurarEnCurso(): void {
    const datos = this.datos.enCurso;
    if (!datos) return;
    const buffer = this.terminal.buffer.normal;
    this.enCurso = {
      comando: datos.comando,
      carpeta: datos.carpeta,
      rama: datos.rama,
      inicio: datos.inicio,
      marcador: this.terminal.registerMarker(datos.linea - (buffer.baseY + buffer.cursorY)),
    };
    this.entrarEnEjecucion();
  }

  private conectarEventos(): void {
    this.terminal.textarea?.addEventListener("focus", () => this.eventos.alEnfocar(this));
    this.lienzo.addEventListener("paste", (evento) => this.alPegar(evento), true);

    this.terminal.parser.registerOscHandler(7, (datos) => {
      const carpeta = rutaDesdeUri(datos);
      if (carpeta && carpeta !== this.carpeta) {
        this.carpeta = carpeta;
        this.eventos.alCambiarEstado(this);
      }
      return true;
    });
    this.terminal.parser.registerOscHandler(133, (datos) => this.alRecibirMarca(datos));

    this.terminal.onWriteParsed(() => this.programarVivo());
    this.terminal.buffer.onBufferChange(() => {
      const alternativa = this.terminal.buffer.active.type === "alternate";
      this.elemento.classList.toggle("panel--interactivo", alternativa);
      if (alternativa && this.editor.tieneFoco) this.terminal.focus();
      this.programarVivo();
    });

    // Sin programa corriendo, la rueda del mouse recorre los bloques.
    this.lienzo.addEventListener(
      "wheel",
      (evento) => {
        if (this.ocupado) return;
        evento.preventDefault();
        evento.stopPropagation();
        this.lista.desplazar(evento.deltaY);
      },
      { capture: true, passive: false },
    );

    // Los agentes como Claude Code tocan la campana cuando necesitan una respuesta.
    this.terminal.onBell(() => {
      this.pideAtencion = true;
    });

    this.terminal.onData((datos) => {
      this.ultimaEntrada = Date.now();
      this.pideAtencion = false;
      if (this.sesion !== null) {
        void invoke("escribir_sesion", { id: this.sesion, datos });
      } else if (this.conectando) {
        // Windows consulta el cursor al arrancar y no sigue hasta recibir esta respuesta.
        this.entradaPendiente += datos;
      } else if (this.esperandoReinicio && datos === "\r") {
        this.terminal.reset();
        void this.abrirSesion();
      }
    });

    this.terminal.onResize(({ rows, cols }) => {
      if (this.sesion !== null) {
        void invoke("redimensionar_sesion", { id: this.sesion, filas: rows, columnas: cols });
      }
    });

    // Ctrl+C copia si hay selección. Sin selección llega al shell y cancela.
    this.terminal.attachCustomKeyEventHandler((evento) => {
      if (evento.type !== "keydown" || !evento.ctrlKey || evento.shiftKey || evento.altKey) {
        return true;
      }
      const tecla = evento.key.toLowerCase();
      if (tecla === "c" && this.terminal.hasSelection()) {
        void navigator.clipboard.writeText(this.terminal.getSelection());
        this.terminal.clearSelection();
        return false;
      }
      // Ctrl+V lo resuelve el evento de pegado del navegador.
      return tecla !== "v";
    });
  }

  // Marcas del script: A prompt, C comando iniciado, D comando terminado,
  // L alias y funciones de la sesión, P valor actual del PATH.
  private alRecibirMarca(datos: string): boolean {
    const separador = datos.indexOf(";");
    const tipo = separador < 0 ? datos : datos.slice(0, separador);
    const valor = separador < 0 ? "" : datos.slice(separador + 1);

    if (tipo === "A") this.alMostrarPrompt(decodificarBase64(valor));
    else if (tipo === "C") this.iniciarComando(decodificarBase64(valor));
    else if (tipo === "D") this.alTerminarLocal(Number(valor) || 0);
    else if (tipo === "rh") this.entrarEnRemoto(decodificarBase64(valor));
    else if (tipo === "ra") this.alMostrarPrompt(decodificarBase64(valor));
    else if (tipo === "rc") this.iniciarComando(decodificarBase64(valor));
    else if (tipo === "rd") this.terminarComando(Number(valor) || 0);
    else if (tipo === "rw" && this.remoto) this.remoto.carpeta = decodificarBase64(valor);
    else if (tipo === "L") this.verificador.definirSesion(decodificarBase64(valor).split("\n"));
    else if (tipo === "P") this.verificador.definirRuta(decodificarBase64(valor));
    // X: órdenes del comando mahzz, como mahzz --resume.
    else if (tipo === "X") {
      window.dispatchEvent(new CustomEvent("mahzz:orden", { detail: decodificarBase64(valor) }));
    }
    return true;
  }

  // El comando ssh sigue abierto: mientras dure, los bloques son del servidor.
  private entrarEnRemoto(host: string): void {
    this.remoto = { host, carpeta: null, conexion: this.enCurso };
    this.inicioDesde = Math.max(0, this.enCurso?.marcador?.line ?? 0);
    this.inicioCapturado = false;
    this.enCurso = null;
    clearTimeout(this.temporizadorEjecucion);
    this.verificador.definirRemoto(true);
    this.contexto.definirSsh(host);
    this.eventos.alCambiarEstado(this);
  }

  private salirDeRemoto(): void {
    if (!this.remoto) return;
    this.enCurso = this.remoto.conexion;
    this.remoto = null;
    this.verificador.definirRemoto(false);
    this.contexto.definirSsh(null);
  }

  // Si PowerShell vuelve a responder, la conexión SSH ya terminó.
  private alTerminarLocal(codigo: number): void {
    const veniaDeRemoto = this.remoto !== null;
    this.salirDeRemoto();
    this.terminarComando(codigo, veniaDeRemoto);
  }

  private alMostrarPrompt(rama: string): void {
    this.rama = rama || null;
    this.terminal.clear();
    this.filasMaximas = 1;
    this.enviando = false;
    clearTimeout(this.temporizadorArranque);
    this.salirDeEjecucion();
    this.actualizarContexto();
    this.programarVivo();

    // PowerShell necesita un instante para empezar a leer después de dibujar el prompt.
    clearTimeout(this.temporizadorListo);
    this.temporizadorListo = window.setTimeout(() => {
      this.listo = true;
      const pendiente = this.comandoPendiente;
      this.comandoPendiente = null;
      if (pendiente) this.escribirComando(pendiente);
    }, ESPERA_LECTURA);
  }

  private iniciarComando(comando: string): void {
    this.enCurso = {
      comando,
      carpeta: this.carpetaActual,
      rama: this.rama,
      inicio: Date.now(),
      marcador: this.terminal.registerMarker(0),
    };
    this.lista.deseleccionar();
    clearTimeout(this.temporizadorEjecucion);
    this.temporizadorEjecucion = window.setTimeout(() => this.entrarEnEjecucion(), RETRASO_EJECUCION);
    this.eventos.alCambiarEstado(this);
  }

  private entrarEnEjecucion(): void {
    if (!this.abierto) return;
    const pasarFoco = this.editor.tieneFoco;
    this.elemento.classList.add("panel--ejecutando");
    if (pasarFoco) this.terminal.focus();
    this.programarVivo();
  }

  private salirDeEjecucion(): void {
    clearTimeout(this.temporizadorEjecucion);
    if (!this.elemento.classList.contains("panel--ejecutando")) return;
    const pasarFoco = this.terminalTieneFoco;
    this.elemento.classList.remove("panel--ejecutando");
    if (pasarFoco) this.editor.enfocar();
    this.programarVivo();
  }

  private lineaFinal(): number {
    const buffer = this.terminal.buffer.normal;
    const linea = buffer.baseY + buffer.cursorY;
    return buffer.cursorX > 0 ? linea + 1 : linea;
  }

  private terminarComando(codigo: number, sinSalida = false): void {
    const actual = this.enCurso;
    this.enCurso = null;
    clearTimeout(this.temporizadorEjecucion);
    this.verificador.invalidar();

    if (!actual) {
      // El primer prompt conserva lo que haya impreso el perfil de PowerShell.
      if (!this.inicioCapturado) {
        this.inicioCapturado = true;
        const captura = capturarRango(this.terminal, this.inicioDesde, this.lineaFinal());
        this.inicioDesde = 0;
        if (captura.lineasHtml.length > 0) {
          this.lista.agregar({
            tipo: "inicio",
            comando: "",
            carpeta: this.carpetaActual,
            rama: this.rama,
            inicio: Date.now(),
            duracion: 0,
            codigo: 0,
            ...captura,
          });
        }
      }
      return;
    }

    this.inicioCapturado = true;
    const desde = Math.max(0, actual.marcador?.line ?? 0);
    const captura = sinSalida
      ? { lineasHtml: [], texto: "" }
      : capturarRango(this.terminal, desde, this.lineaFinal());
    actual.marcador?.dispose();
    registrarEnHistorial({
      comando: actual.comando,
      carpeta: actual.carpeta,
      fecha: actual.inicio,
      codigo,
    });
    const { avisarComandos, segundosAviso } = ajustes();
    if (avisarComandos && !sinSalida && !document.hasFocus() && Date.now() - actual.inicio >= segundosAviso * 1000) {
      void invoke("avisar_comando", {
        titulo: t("Comando terminado"),
        cuerpo: t("Terminó con código {0}: {1}", codigo, actual.comando.slice(0, 80)),
      });
    }

    if (COMANDOS_LIMPIAR.test(actual.comando)) {
      this.lista.vaciar();
    } else {
      this.lista.agregar({
        tipo: "comando",
        comando: actual.comando,
        carpeta: actual.carpeta,
        rama: actual.rama,
        inicio: actual.inicio,
        duracion: Date.now() - actual.inicio,
        codigo,
        ...captura,
      });
    }
    this.eventos.alCambiarEstado(this);
  }

  get textoEditor(): string {
    return this.editor.texto;
  }

  ponerEnEditor(texto: string): void {
    this.editor.definirTexto(texto);
    this.enfocar();
  }

  ejecutarComando(comando: string): boolean {
    return this.enviar(comando);
  }

  // Escribe una ruta en el programa que esté corriendo o, si no hay ninguno, en el editor.
  enviarRuta(ruta: string): void {
    const conEspacios = /\s/.test(ruta);
    if (this.usaTerminal && this.sesion !== null) {
      const texto = `${conEspacios ? `"${ruta}"` : ruta} `;
      const datos = this.terminal.modes.bracketedPasteMode ? `\x1b[200~${texto}\x1b[201~` : texto;
      void invoke("escribir_sesion", { id: this.sesion, datos });
      this.terminal.focus();
      return;
    }
    this.editor.insertar(`${conEspacios ? `'${ruta.replaceAll("'", "''")}'` : ruta} `);
    this.editor.enfocar();
  }

  // Devuelve true si el comando fue aceptado y el editor se puede vaciar.
  private enviar(comando: string): boolean {
    if ((this.sesion === null && !this.conectando) || this.ocupado || this.enviando) return false;
    if (!this.listo) {
      if (this.comandoPendiente !== null) return false;
      this.comandoPendiente = comando;
      return true;
    }
    this.escribirComando(comando);
    return true;
  }

  private escribirComando(comando: string): void {
    if (this.sesion === null) return;
    this.listo = false;
    this.enviando = true;
    const codificado = codificarBase64(comando);
    const datos = this.remoto ? ` __mahzz_e ${codificado}\r` : `#mahzz:${codificado}\r`;
    void invoke("escribir_sesion", { id: this.sesion, datos });
  }

  private async elegirCarpeta(): Promise<void> {
    if (this.remoto) return;
    const ruta = await invoke<string | null>("elegir_carpeta", { inicial: this.carpeta });
    if (ruta) this.enviar(`Set-Location -LiteralPath '${ruta.replaceAll("'", "''")}'`);
    this.enfocar();
  }

  private actualizarContexto(): void {
    const carpeta = this.carpeta;
    void this.contexto.definirCarpeta(this.carpetaActual);
    this.contexto.definirGit(this.rama, null);
    if (this.remoto) {
      this.consultaGit++;
      this.contexto.definirProyecto(null);
      this.eventos.alCambiarEstado(this);
      return;
    }

    const consulta = ++this.consultaGit;
    if (carpeta && this.rama) {
      void invoke<DatosGit | null>("estado_git", { carpeta }).then((estado) => {
        if (consulta === this.consultaGit) this.contexto.definirGit(this.rama, estado);
      });
    }

    if (!carpeta) return;
    // Cada carpeta se analiza una sola vez hasta abrir otra pestaña o reiniciar el shell.
    if (this.proyectos.has(carpeta)) {
      this.contexto.definirProyecto(this.proyectos.get(carpeta) ?? null);
      return;
    }
    this.proyectos.set(carpeta, null);
    this.contexto.definirProyecto(null);
    void invoke<DatosProyecto | null>("detectar_proyecto", { carpeta }).then((proyecto) => {
      this.proyectos.set(carpeta, proyecto);
      if (carpeta === this.carpeta) this.contexto.definirProyecto(proyecto);
    });
  }

  private programarVivo(): void {
    if (this.cuadroVivo) return;
    this.cuadroVivo = requestAnimationFrame(() => {
      this.cuadroVivo = 0;
      this.actualizarVivo();
    });
  }

  private filasUsadas(): number {
    const buffer = this.terminal.buffer.active;
    if (buffer.type === "alternate") return this.terminal.rows;
    let ultima = buffer.cursorY;
    for (let y = this.terminal.rows - 1; y > ultima; y--) {
      if (buffer.getLine(buffer.baseY + y)?.translateToString(true).trim()) {
        ultima = y;
        break;
      }
    }
    return ultima + 1;
  }

  private definirFondoLista(alto: number): void {
    const nuevo = `${alto}px`;
    const lista = this.lista.elemento;
    if (lista.style.bottom === nuevo) return;
    const alFinal = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 24;
    lista.style.bottom = nuevo;
    if (alFinal) this.lista.irAlFinal();
  }

  // Sin programa corriendo se ve el editor. Si no, la salida se apoya abajo de los bloques.
  private actualizarVivo(): void {
    if (!this.abierto) return;
    if (!this.usaTerminal) {
      this.definirFondoLista(this.entrada.offsetHeight);
      return;
    }

    const pantalla = this.terminal.element?.querySelector(".xterm-screen");
    const altoTotal = this.elemento.clientHeight;
    if (!pantalla || altoTotal === 0) return;

    this.filasMaximas = Math.max(this.filasMaximas, this.filasUsadas());
    const altoFila = pantalla.getBoundingClientRect().height / this.terminal.rows;
    const buffer = this.terminal.buffer.active;
    const marcador = buffer.type === "normal" ? this.enCurso?.marcador : null;
    // El prompt y el comando ya se ven en el editor: se muestra solo lo que sale después.
    const inicio = marcador ? Math.max(0, Math.min(marcador.line - buffer.baseY, this.filasMaximas - 1)) : 0;
    const filasVisibles = Math.max(1, this.filasMaximas - inicio);
    const altoVivo = Math.min(altoTotal, Math.ceil(filasVisibles * altoFila) + MARGEN_VIVO);
    const recorte = Math.round(inicio * altoFila);

    this.lienzo.style.transform = `translateY(${altoTotal - altoVivo - recorte}px)`;
    this.lienzo.style.clipPath = `inset(${recorte}px 0 0 0)`;
    this.definirFondoLista(altoVivo);
  }

  private crearCanales(): { salida: Channel<ArrayBuffer>; fin: Channel<number> } {
    const generacion = ++this.generacion;
    const salida = new Channel<ArrayBuffer>();
    salida.onmessage = (datos) => {
      if (generacion !== this.generacion) return;
      const ahora = Date.now();
      if (ahora - this.ultimaEntrada > MARGEN_ECO) this.ultimaSalida = ahora;
      this.terminal.write(new Uint8Array(datos));
    };
    const fin = new Channel<number>();
    fin.onmessage = (codigo) => {
      if (generacion === this.generacion) this.marcarFin(codigo);
    };
    return { salida, fin };
  }

  private registrarSesion(id: number): void {
    this.sesion = id;
    this.conectando = false;
    if (this.entradaPendiente) {
      void invoke("escribir_sesion", { id, datos: this.entradaPendiente });
      this.entradaPendiente = "";
    }
  }

  private async abrirSesion(): Promise<void> {
    this.esperandoReinicio = false;
    this.conectando = true;
    this.inicioCapturado = false;
    this.listo = false;
    this.enviando = false;
    this.proyectos.clear();
    this.elemento.classList.remove("panel--sin-shell");
    this.enfocar();
    // Si el perfil pide datos al arrancar, la terminal tiene que quedar visible.
    this.temporizadorArranque = window.setTimeout(() => this.entrarEnEjecucion(), LIMITE_ARRANQUE);
    try {
      const id = await invoke<number>("crear_sesion", {
        filas: this.terminal.rows,
        columnas: this.terminal.cols,
        carpeta: this.carpeta,
        ...this.crearCanales(),
      });
      this.registrarSesion(id);
    } catch (error) {
      clearTimeout(this.temporizadorArranque);
      this.conectando = false;
      this.entradaPendiente = "";
      this.esperandoReinicio = true;
      this.mostrarSinShell();
      this.terminal.write(
        `\x1b[31m${t("No se pudo abrir PowerShell: {0}", String(error))}\x1b[0m\r\n\x1b[90m${t("[Presioná Enter para reintentar]")}\x1b[0m\r\n`,
      );
    }
  }

  private async adjuntar(id: number): Promise<void> {
    this.conectando = true;
    try {
      await invoke("adjuntar_sesion", { id, ...this.crearCanales() });
      this.registrarSesion(id);
      await invoke("redimensionar_sesion", {
        id,
        filas: this.terminal.rows,
        columnas: this.terminal.cols,
      });
    } catch {
      this.marcarFin(null);
    }
  }

  private mostrarSinShell(): void {
    const pasarFoco = this.editor.tieneFoco || this.terminalTieneFoco;
    clearTimeout(this.temporizadorEjecucion);
    this.elemento.classList.remove("panel--ejecutando");
    this.elemento.classList.add("panel--sin-shell");
    if (pasarFoco) this.terminal.focus();
    this.programarVivo();
  }

  private marcarFin(codigo: number | null): void {
    const veniaDeRemoto = this.remoto !== null;
    this.salirDeRemoto();
    if (this.enCurso) this.terminarComando(codigo ?? 1, veniaDeRemoto);
    clearTimeout(this.temporizadorArranque);
    clearTimeout(this.temporizadorListo);
    this.sesion = null;
    this.conectando = false;
    this.entradaPendiente = "";
    this.programa = null;
    this.listo = false;
    this.enviando = false;
    this.comandoPendiente = null;
    this.esperandoReinicio = true;
    this.filasMaximas = 1;
    this.mostrarSinShell();
    const detalle = codigo === null ? "" : t(" con código {0}", codigo);
    this.terminal.write(
      `\r\n\x1b[90m${t("[Proceso terminado{0}. Presioná Enter para reiniciar]", detalle)}\x1b[0m\r\n`,
    );
    this.eventos.alCambiarEstado(this);
  }

  // Un programa tiene que verse dos veces seguidas para evitar parpadeos en el título.
  registrarPrograma(nombre: string | null): void {
    const confirmado = nombre === null || nombre === this.candidato;
    this.candidato = nombre;
    if (confirmado && nombre !== this.programa) {
      this.programa = nombre;
      this.programaDesde = Date.now();
      this.pideAtencion = false;
      this.eventos.alCambiarEstado(this);
    }
  }

  aplicarAjustes(): void {
    const opciones = this.terminal.options;
    opciones.fontFamily = fuenteActual();
    opciones.fontSize = ajustes().tamanoFuente;
    opciones.cursorStyle = ajustes().cursor;
    opciones.cursorBlink = ajustes().parpadeo;
    opciones.scrollback = lineasHistorial();
    opciones.theme = temaTerminal();
    this.ajustar();
    this.programarVivo();
  }

  // Pegar varias líneas en un programa puede ejecutarlas: primero se confirma.
  private alPegar(evento: ClipboardEvent): void {
    const texto = evento.clipboardData?.getData("text") ?? "";
    const lineas = texto.split(/\r?\n/).filter((linea) => linea.trim()).length;
    if (!ajustes().avisarPegado || lineas < 2) return;
    evento.preventDefault();
    evento.stopPropagation();
    void confirmar(t("¿Pegar varias líneas?"), t("Vas a pegar {0} líneas en el programa que está corriendo.", lineas), t("Pegar")).then((aceptado) => {
      if (aceptado) this.terminal.paste(texto);
      this.terminal.focus();
    });
  }

  ajustar(): void {
    if (this.abierto && this.lienzo.clientWidth > 0 && this.lienzo.clientHeight > 0) {
      this.ajuste.fit();
    }
  }

  enfocar(): void {
    if (this.usaTerminal) this.terminal.focus();
    else this.editor.enfocar();
  }

  // Solo los paneles visibles usan WebGL, porque Chromium limita los contextos activos.
  activarDibujo(visible: boolean): void {
    if (!this.abierto) return;
    this.dibujoVisible = visible;
    if (!visible) {
      this.webgl?.dispose();
      this.webgl = null;
      return;
    }
    if (this.webgl) return;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        if (this.webgl === webgl) this.webgl = null;
        this.recuperarDibujo();
      });
      this.terminal.loadAddon(webgl);
      this.webgl = webgl;
    } catch (error) {
      console.warn("WebGL no disponible", error);
    }
  }

  // Chromium puede quitar contextos WebGL si se abren y cierran muchos paneles seguidos.
  private recuperarDibujo(): void {
    const ahora = Date.now();
    if (ahora - this.ultimaPerdida > VENTANA_REINTENTOS) this.reintentosDibujo = 0;
    this.ultimaPerdida = ahora;
    if (this.reintentosDibujo >= MAXIMO_REINTENTOS) return;
    this.reintentosDibujo++;
    setTimeout(() => {
      if (this.abierto && this.dibujoVisible) this.activarDibujo(true);
    }, ESPERA_REINTENTO);
  }

  // Prepara el panel para seguir funcionando en otra ventana.
  async exportar(): Promise<DatosPanel> {
    const sesion = this.sesion;
    if (sesion !== null) {
      await invoke("pausar_sesion", { id: sesion });
      // Deja llegar lo que ya estaba en camino antes de copiar la pantalla.
      await new Promise((listo) => setTimeout(listo, 60));
      await new Promise<void>((listo) => this.terminal.write("", listo));
    }
    const enCurso = this.enCurso;
    return {
      sesion,
      carpeta: this.carpeta,
      contenido: this.serializador.serialize({ scrollback: lineasHistorial() }),
      bloques: this.lista.exportar(),
      rama: this.rama,
      borrador: this.editor.texto,
      remoto: this.remoto && {
        host: this.remoto.host,
        carpeta: this.remoto.carpeta,
        conexion: this.remoto.conexion && {
          comando: this.remoto.conexion.comando,
          carpeta: this.remoto.conexion.carpeta,
          rama: this.remoto.conexion.rama,
          inicio: this.remoto.conexion.inicio,
        },
      },
      enCurso: enCurso && {
        comando: enCurso.comando,
        carpeta: enCurso.carpeta,
        rama: enCurso.rama,
        inicio: enCurso.inicio,
        linea: Math.max(0, enCurso.marcador?.line ?? 0),
      },
    };
  }

  // Vuelve a recibir la salida si el traspaso a otra ventana falló.
  async reanudar(): Promise<void> {
    if (this.sesion !== null) await this.adjuntar(this.sesion);
  }

  // Libera la interfaz sin terminar el proceso: lo sigue usando otra ventana.
  soltar(): void {
    this.abierto = false;
    this.generacion++;
    clearTimeout(this.temporizadorEjecucion);
    clearTimeout(this.temporizadorListo);
    clearTimeout(this.temporizadorArranque);
    this.observador.disconnect();
    cancelAnimationFrame(this.cuadroPendiente);
    cancelAnimationFrame(this.cuadroVivo);
    this.editor.destruir();
    this.terminal.dispose();
    this.elemento.remove();
  }

  cerrar(): void {
    if (this.sesion !== null) void invoke("cerrar_sesion", { id: this.sesion });
    this.soltar();
  }
}
