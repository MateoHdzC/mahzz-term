import { Channel, invoke } from "@tauri-apps/api/core";
import { idiomaWeb, t } from "./i18n";
import type { Panel } from "./panel";

// Panel lateral de Mahzz-AI: el copiloto local que corre en Ollama.

interface Mensaje {
  role: "user" | "assistant";
  content: string;
}

interface Trozo {
  pensando?: string;
  texto?: string;
}

interface Estado {
  modelo: string;
  provisorio: boolean;
}

const CLAVE_VISIBLE = "mahzz-copiloto-visible";
const CLAVE_ANCHO = "mahzz-copiloto-ancho";
const ANCHO_MINIMO = 300;
const ANCHO_MAXIMO = 900;
const LIMITE_SALIDA = 4000;

const ICONO_ENVIAR = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" /></svg>';
const ICONO_DETENER = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>';
const ICONO_NUEVA =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4.5M11.5 1.5l3 3L8 11H5V8z" /></svg>';
const ICONO_CERRAR = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>';
const ICONO_BLOQUE =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12v9H2zM4.5 7l2 1.5-2 1.5M8.5 10h3" /></svg>';

const SUGERENCIAS = [
  t("¿Por qué falló el último comando?"),
  t("Explicame qué hizo el último comando"),
  t("Dame un comando para ver qué ocupa espacio en esta carpeta"),
];

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

async function markdownSeguro(texto: string): Promise<string> {
  const [{ marked }, { default: DOMPurify }] = await Promise.all([import("marked"), import("dompurify")]);
  return DOMPurify.sanitize(await marked.parse(texto, { gfm: true, breaks: true }), { USE_PROFILES: { html: true } });
}

function boton(clase: string, icono: string, titulo: string): HTMLButtonElement {
  const elemento = document.createElement("button");
  elemento.type = "button";
  elemento.className = clase;
  elemento.innerHTML = icono;
  elemento.title = titulo;
  elemento.setAttribute("aria-label", titulo);
  return elemento;
}

export class PanelCopiloto {
  private readonly lista = document.createElement("div");
  private readonly entrada = document.createElement("textarea");
  private readonly enviar = boton("copiloto__enviar", ICONO_ENVIAR, t("Enviar (Enter)"));
  private readonly contexto = document.createElement("button");
  private readonly modelo = document.createElement("span");
  private readonly historial: Mensaje[] = [];
  private respondiendo = false;
  private conContexto = true;
  private disponible = true;

  constructor(
    private readonly elemento: HTMLElement,
    private readonly botonAlternar: HTMLElement,
    private readonly obtenerPanel: () => Panel | null,
  ) {
    const asa = document.createElement("div");
    asa.className = "copiloto__asa";
    asa.setAttribute("role", "separator");
    asa.setAttribute("aria-orientation", "vertical");
    asa.addEventListener("pointerdown", (evento) => this.iniciarAjusteAncho(asa, evento));

    // Encabezado: marca, modelo en uso y acciones.
    const marca = document.createElement("div");
    marca.className = "copiloto__marca";
    const orbe = document.createElement("span");
    orbe.className = "copiloto__orbe";
    orbe.setAttribute("aria-hidden", "true");
    const nombre = document.createElement("span");
    nombre.className = "copiloto__nombre";
    nombre.textContent = "Mahzz-AI";
    this.modelo.className = "copiloto__modelo";
    const textos = document.createElement("div");
    textos.className = "copiloto__textos";
    textos.append(nombre, this.modelo);
    marca.append(orbe, textos);

    const nueva = boton("archivos__boton", ICONO_NUEVA, t("Nueva charla"));
    nueva.addEventListener("click", () => this.nuevaCharla());
    const cerrar = boton("archivos__boton", ICONO_CERRAR, t("Cerrar"));
    cerrar.addEventListener("click", () => this.alternar());

    const encabezado = document.createElement("div");
    encabezado.className = "copiloto__encabezado";
    encabezado.append(marca, nueva, cerrar);

    this.lista.className = "copiloto__lista";

    // Caja de escritura, estilo copilot.
    this.entrada.className = "copiloto__entrada";
    this.entrada.rows = 1;
    this.entrada.placeholder = t("Preguntale algo a Mahzz-AI…");
    this.entrada.addEventListener("input", () => this.ajustarAlto());
    this.entrada.addEventListener("keydown", (evento) => {
      evento.stopPropagation();
      if (evento.key === "Enter" && !evento.shiftKey) {
        evento.preventDefault();
        void this.mandar();
      } else if (evento.key === "Escape") {
        this.obtenerPanel()?.enfocar();
      }
    });

    this.contexto.type = "button";
    this.contexto.className = "copiloto__chip";
    this.contexto.innerHTML = ICONO_BLOQUE;
    this.contexto.append(t("Último comando"));
    this.contexto.title = t("Le pasa a Mahzz-AI el último comando de la terminal y su salida");
    this.contexto.addEventListener("click", () => {
      this.conContexto = !this.conContexto;
      this.pintarContexto();
    });

    this.enviar.addEventListener("click", () => (this.respondiendo ? this.detener() : void this.mandar()));

    const herramientas = document.createElement("div");
    herramientas.className = "copiloto__herramientas";
    herramientas.append(this.contexto, this.enviar);

    const caja = document.createElement("div");
    caja.className = "copiloto__caja";
    caja.append(this.entrada, herramientas);
    caja.addEventListener("click", (evento) => {
      if (evento.target === caja) this.entrada.focus();
    });

    const pie = document.createElement("div");
    pie.className = "copiloto__pie";
    const aviso = document.createElement("div");
    aviso.className = "copiloto__aviso";
    aviso.textContent = t("Corre en tu PC. Puede equivocarse: revisá los comandos antes de ejecutarlos.");
    pie.append(caja, aviso);

    this.elemento.append(asa, encabezado, this.lista, pie);

    const ancho = Number(leerPreferencia(CLAVE_ANCHO));
    if (ancho >= ANCHO_MINIMO && ancho <= ANCHO_MAXIMO) this.elemento.style.width = `${ancho}px`;
    this.pintarContexto();
    this.mostrarBienvenida();
    this.definirVisible(leerPreferencia(CLAVE_VISIBLE) === "si");
  }

  private get visible(): boolean {
    return !this.elemento.hidden;
  }

  alternar(): void {
    this.definirVisible(!this.visible);
    if (this.visible) this.entrada.focus();
    else this.obtenerPanel()?.enfocar();
  }

  private definirVisible(visible: boolean): void {
    this.elemento.hidden = !visible;
    this.botonAlternar.setAttribute("aria-pressed", String(visible));
    guardarPreferencia(CLAVE_VISIBLE, visible ? "si" : "no");
    if (visible) void this.revisarModelo();
  }

  private async revisarModelo(): Promise<void> {
    this.modelo.textContent = t("conectando…");
    this.modelo.classList.remove("copiloto__modelo--error");
    try {
      const estado = await invoke<Estado>("mahzz_estado");
      const nombre = estado.modelo.replace(/:latest$/, "");
      this.modelo.textContent = estado.provisorio ? t("{0} · provisorio", nombre) : nombre;
      if (!this.disponible) {
        this.disponible = true;
        if (this.historial.length === 0) this.mostrarBienvenida();
      }
      this.modelo.title = estado.provisorio
        ? t("El modelo propio todavía no está instalado: se usa la base con la identidad de Mahzz-AI.")
        : "";
    } catch (error) {
      this.modelo.textContent = t("sin conexión");
      this.modelo.title = String(error);
      this.modelo.classList.add("copiloto__modelo--error");
      this.disponible = false;
      if (this.historial.length === 0) this.mostrarProximamente(String(error));
    }
  }

  // Sin Ollama o sin el modelo: se cuenta qué es Mahzz-AI y se manda a la web.
  private mostrarProximamente(motivo: string): void {
    const tarjeta = document.createElement("div");
    tarjeta.className = "copiloto__bienvenida";
    const orbe = document.createElement("div");
    orbe.className = "copiloto__orbe copiloto__orbe--grande";
    const etiqueta = document.createElement("span");
    etiqueta.className = "copiloto__etiqueta";
    etiqueta.textContent = t("Próximamente");
    const titulo = document.createElement("div");
    titulo.className = "copiloto__saludo";
    titulo.textContent = t("Mahzz-AI llega pronto");
    const texto = document.createElement("div");
    texto.className = "copiloto__subtitulo";
    texto.textContent = t(
      "Es el copiloto propio de MahzzTerm: corre en tu PC, ve tus comandos y te ayuda a arreglarlos. Todavía no se puede descargar.",
    );
    const detalle = document.createElement("div");
    detalle.className = "copiloto__detalle";
    detalle.textContent = motivo;
    const web = document.createElement("button");
    web.type = "button";
    web.className = "copiloto__sugerencia copiloto__sugerencia--principal";
    web.textContent = t("Ver más en mahzzterm.xyz");
    web.addEventListener("click", () => {
      void invoke("abrir_externo", { destino: `https://mahzzterm.xyz/${idiomaWeb()}/mahzz-ai/` });
    });
    const reintentar = document.createElement("button");
    reintentar.type = "button";
    reintentar.className = "copiloto__sugerencia";
    reintentar.textContent = t("Volver a buscar el modelo");
    reintentar.addEventListener("click", () => void this.revisarModelo());
    const acciones = document.createElement("div");
    acciones.className = "copiloto__sugerencias";
    acciones.append(web, reintentar);
    tarjeta.append(orbe, etiqueta, titulo, texto, acciones, detalle);
    this.lista.replaceChildren(tarjeta);
  }

  private pintarContexto(): void {
    this.contexto.setAttribute("aria-pressed", String(this.conContexto));
  }

  private ajustarAlto(): void {
    this.entrada.style.height = "auto";
    this.entrada.style.height = `${Math.min(this.entrada.scrollHeight, 180)}px`;
  }

  private mostrarBienvenida(): void {
    const bienvenida = document.createElement("div");
    bienvenida.className = "copiloto__bienvenida";
    const orbe = document.createElement("div");
    orbe.className = "copiloto__orbe copiloto__orbe--grande";
    const titulo = document.createElement("div");
    titulo.className = "copiloto__saludo";
    titulo.textContent = t("¿En qué te ayudo?");
    const texto = document.createElement("div");
    texto.className = "copiloto__subtitulo";
    texto.textContent = t("Mahzz-AI ve el último comando de la terminal si dejás prendido el chip.");
    const sugerencias = document.createElement("div");
    sugerencias.className = "copiloto__sugerencias";
    for (const sugerencia of SUGERENCIAS) {
      const opcion = document.createElement("button");
      opcion.type = "button";
      opcion.className = "copiloto__sugerencia";
      opcion.textContent = sugerencia;
      opcion.addEventListener("click", () => {
        this.entrada.value = sugerencia;
        void this.mandar();
      });
      sugerencias.append(opcion);
    }
    bienvenida.append(orbe, titulo, texto, sugerencias);
    this.lista.replaceChildren(bienvenida);
  }

  private nuevaCharla(): void {
    if (this.respondiendo) this.detener();
    this.historial.length = 0;
    this.mostrarBienvenida();
    this.entrada.focus();
  }

  // El último comando terminado de la terminal activa, con la salida recortada.
  private ultimoComando(): string | null {
    const panel = this.obtenerPanel();
    if (!panel) return null;
    const bloque = panel.lista
      .exportar()
      .filter((datos) => datos.tipo === "comando")
      .at(-1);
    if (!bloque) return null;
    const salida =
      bloque.texto.length > LIMITE_SALIDA ? `…${bloque.texto.slice(-LIMITE_SALIDA)}` : bloque.texto;
    return [
      `Carpeta: ${bloque.carpeta ?? panel.carpeta ?? "desconocida"}`,
      `Comando: ${bloque.comando}`,
      `Código de salida: ${bloque.codigo}`,
      "Salida:",
      "```",
      salida.trimEnd(),
      "```",
    ].join("\n");
  }

  private async mandar(): Promise<void> {
    const pregunta = this.entrada.value.trim();
    if (!pregunta || this.respondiendo) return;
    if (!this.disponible) {
      await this.revisarModelo();
      if (!this.disponible) return;
    }
    if (this.historial.length === 0) this.lista.replaceChildren();

    const contexto = this.conContexto ? this.ultimoComando() : null;
    this.agregarBurbujaUsuario(pregunta, contexto !== null);
    this.historial.push({
      role: "user",
      content: contexto ? `Contexto de la terminal MahzzTerm:\n${contexto}\n\nPregunta: ${pregunta}` : pregunta,
    });
    this.entrada.value = "";
    this.ajustarAlto();

    const { elemento, pensando, cuerpo } = this.agregarBurbujaMahzz();
    this.definirRespondiendo(true);

    let texto = "";
    let razonamiento = "";
    let pendiente = false;
    let version = 0;
    const pintar = () => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(async () => {
        pendiente = false;
        const actual = ++version;
        if (razonamiento) {
          pensando.hidden = false;
          pensando.querySelector(".copiloto__pensando-texto")!.textContent = razonamiento;
        }
        if (texto) {
          elemento.classList.remove("copiloto__mensaje--esperando");
          const html = await markdownSeguro(texto);
          // Si mientras tanto empezó un repintado más nuevo, este ya quedó viejo.
          if (actual !== version) return;
          cuerpo.innerHTML = html;
          this.decorarCodigo(cuerpo);
        }
        this.bajar();
      });
    };

    const canal = new Channel<Trozo>();
    canal.onmessage = (trozo) => {
      if (trozo.pensando) razonamiento += trozo.pensando;
      if (trozo.texto) texto += trozo.texto;
      pintar();
    };

    try {
      await invoke("mahzz_chat", { mensajes: this.historial, canal });
      if (!texto) texto = razonamiento ? t("_(Solo pensó, sin respuesta.)_") : t("_(Sin respuesta.)_");
      this.historial.push({ role: "assistant", content: texto });
    } catch (error) {
      texto = `**${t("Error")}:** ${String(error)}`;
      elemento.classList.add("copiloto__mensaje--error");
      this.historial.pop();
      void this.revisarModelo();
    } finally {
      pensando.removeAttribute("open");
      pensando.classList.add("copiloto__pensando--listo");
      pensando.querySelector("summary")!.textContent = t("Pensamiento");
      pintar();
      this.definirRespondiendo(false);
    }
  }

  private detener(): void {
    void invoke("mahzz_detener");
  }

  private definirRespondiendo(respondiendo: boolean): void {
    this.respondiendo = respondiendo;
    this.enviar.innerHTML = respondiendo ? ICONO_DETENER : ICONO_ENVIAR;
    this.enviar.title = respondiendo ? t("Detener") : t("Enviar (Enter)");
    this.enviar.classList.toggle("copiloto__enviar--detener", respondiendo);
  }

  private agregarBurbujaUsuario(texto: string, conContexto: boolean): void {
    const mensaje = document.createElement("div");
    mensaje.className = "copiloto__mensaje copiloto__mensaje--usuario";
    const burbuja = document.createElement("div");
    burbuja.className = "copiloto__burbuja";
    burbuja.textContent = texto;
    mensaje.append(burbuja);
    if (conContexto) {
      const etiqueta = document.createElement("div");
      etiqueta.className = "copiloto__adjunto";
      etiqueta.innerHTML = ICONO_BLOQUE;
      etiqueta.append(t("con el último comando"));
      mensaje.append(etiqueta);
    }
    this.lista.append(mensaje);
    this.bajar();
  }

  private agregarBurbujaMahzz(): { elemento: HTMLElement; pensando: HTMLDetailsElement; cuerpo: HTMLElement } {
    const elemento = document.createElement("div");
    elemento.className = "copiloto__mensaje copiloto__mensaje--mahzz copiloto__mensaje--esperando";
    const autor = document.createElement("div");
    autor.className = "copiloto__autor";
    const orbe = document.createElement("span");
    orbe.className = "copiloto__orbe copiloto__orbe--chico";
    autor.append(orbe, "Mahzz-AI");

    const pensando = document.createElement("details");
    pensando.className = "copiloto__pensando";
    pensando.hidden = true;
    const resumen = document.createElement("summary");
    resumen.textContent = t("Pensando…");
    const razonamiento = document.createElement("div");
    razonamiento.className = "copiloto__pensando-texto";
    pensando.append(resumen, razonamiento);

    const puntos = document.createElement("div");
    puntos.className = "copiloto__puntos";
    puntos.innerHTML = "<span></span><span></span><span></span>";

    const cuerpo = document.createElement("div");
    cuerpo.className = "copiloto__cuerpo";
    elemento.append(autor, pensando, puntos, cuerpo);
    this.lista.append(elemento);
    this.bajar();
    return { elemento, pensando, cuerpo };
  }

  // Los bloques de código llevan "Copiar" y "A la terminal" (lo escribe sin ejecutarlo).
  private decorarCodigo(cuerpo: HTMLElement): void {
    for (const pre of cuerpo.querySelectorAll("pre")) {
      const codigo = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
      const lenguaje = /language-(\S+)/.exec(pre.querySelector("code")?.className ?? "")?.[1] ?? "";
      const barra = document.createElement("div");
      barra.className = "copiloto__codigo-barra";
      const nombre = document.createElement("span");
      nombre.textContent = lenguaje || t("código");
      const copiar = document.createElement("button");
      copiar.type = "button";
      copiar.textContent = t("Copiar");
      copiar.addEventListener("click", () => {
        void navigator.clipboard.writeText(codigo.trimEnd());
        copiar.textContent = t("Copiado");
        setTimeout(() => (copiar.textContent = t("Copiar")), 1200);
      });
      const terminal = document.createElement("button");
      terminal.type = "button";
      terminal.textContent = t("A la terminal");
      terminal.title = t("Lo escribe en la terminal activa sin ejecutarlo");
      terminal.addEventListener("click", () => {
        const panel = this.obtenerPanel();
        if (!panel) return;
        panel.ponerEnEditor(codigo.trim());
        panel.enfocar();
      });
      barra.append(nombre, copiar, terminal);
      const envoltura = document.createElement("div");
      envoltura.className = "copiloto__codigo";
      pre.replaceWith(envoltura);
      envoltura.append(barra, pre);
    }
  }

  private bajar(): void {
    const cerca = this.lista.scrollHeight - this.lista.scrollTop - this.lista.clientHeight < 120;
    if (cerca || !this.respondiendo) this.lista.scrollTop = this.lista.scrollHeight;
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
