import { t } from "./i18n";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PanelAgentes } from "./agentes";
import { PanelArchivos } from "./archivos";
import { ACCIONES_DE_BLOQUES, accionDeTecla, type Accion } from "./atajos";
import { ajustes, cargarAjustes } from "./ajustes";
import { abrirAjustes, type SeccionAjustes } from "./ajustesUI";
import { alCambiarCuenta, cerrarSesion, iniciarSesion, perfilActual, sincronizarAhora } from "./cuenta";
import { abrirMenu, avisar, confirmar, type ColorMenu, type OpcionMenu } from "./dialogos";
import { ofrecerGuardarSecreto } from "./secretos";
import { cargarHistorial } from "./historial";
import type { Panel } from "./panel";
import { abrirGuardados, abrirHistorial, abrirPaleta, guardarComando, type ApiPaleta } from "./paleta";
import { Pestana, type DatosPestana, type Sentido } from "./pestana";
import { PanelCambios } from "./cambios";
import { PanelCopiloto } from "./copiloto";
import { PanelVisor } from "./visor";
import { iniciarControl, type PedidoWindows } from "./control";
import { abrirBuscadorRegistros, iniciarRegistro } from "./registros";
import {
  comandoAgente,
  crearTarea,
  descartarTarea,
  estaDentro,
  pedirNuevaTarea,
  unirTarea,
  type PedidoTarea,
  type Tarea,
  type TareaCreada,
} from "./tareas";
import { elegirSesion, listarSesiones, prepararParaReanudar, type SesionGuardada } from "./sesiones";

const COLORES: ColorMenu[] = [
  { nombre: t("Violeta"), valor: null },
  { nombre: t("Rojo"), valor: "#ff6b81" },
  { nombre: t("Ámbar"), valor: "#f4c96b" },
  { nombre: t("Verde"), valor: "#6fdc9c" },
  { nombre: t("Cian"), valor: "#62d6e8" },
  { nombre: t("Azul"), valor: "#74a7ff" },
];

const DISTANCIA_ARRASTRE = 5;
const INTERVALO_PROGRAMAS = 1000;

function elemento<T extends HTMLElement>(id: string): T {
  const encontrado = document.getElementById(id);
  if (!encontrado) throw new Error(`Falta el elemento #${id}`);
  return encontrado as T;
}

// La carpeta de un archivo. La raíz de un disco queda como "C:\".
export function carpetaDe(ruta: string): string {
  const carpeta = ruta.replace(/[\\/][^\\/]*$/, "");
  return /^[A-Za-z]:$/.test(carpeta) ? `${carpeta}\\` : carpeta;
}

export class GestorPestanas {
  private readonly barra = elemento<HTMLDivElement>("pestanas");
  private readonly contenido = elemento<HTMLElement>("contenido");
  private readonly ventana = getCurrentWindow();
  private pestanas: Pestana[] = [];
  private activa: Pestana | null = null;
  private readonly apiPaleta: ApiPaleta = {
    panel: () => this.activa?.activo ?? null,
    ejecutarAccion: (accion) => this.ejecutar(accion),
    abrirAjustes: (seccion) => this.abrirPantallaAjustes(seccion),
  };
  private temporizadorSesion = 0;
  private readonly visor = new PanelVisor(elemento("visor"), { alCerrar: () => this.activa?.activo.enfocar() });
  private readonly archivos = new PanelArchivos(elemento("archivos"), elemento("alternar-archivos"), {
    panel: () => this.activa?.activo ?? null,
    abrirArchivo: (ruta) => void this.visor.abrir(ruta),
    alMoverRuta: (vieja, nueva) => this.visor.alMoverRuta(vieja, nueva),
    alBorrarRuta: (ruta) => this.visor.alBorrarRuta(ruta),
  });
  private readonly cambios = new PanelCambios(
    elemento("cambios"),
    elemento("alternar-cambios"),
    () => this.activa?.activo ?? null,
  );
  private readonly copiloto = new PanelCopiloto(
    elemento("copiloto"),
    elemento("alternar-mahzz"),
    () => this.activa?.activo ?? null,
  );
  private readonly agentes = new PanelAgentes(elemento("agentes"), {
    pestanas: () => this.pestanas,
    activa: () => this.activa,
    irA: (pestana, panel) => {
      this.activar(pestana);
      requestAnimationFrame(() => panel.enfocar());
    },
    nuevoAgente: (comando) => void this.nuevaPestanaCon(comando),
    carpetaActiva: () => this.activa?.activo.carpeta ?? null,
    nuevaTarea: () => void this.nuevaTareaInteractiva(),
    abrirTarea: (tarea) => void this.abrirTarea(tarea),
    unirTarea: (tarea) => void this.terminarTarea(tarea.carpeta, tarea.nombre, "unir", true).catch((error) => avisar(String(error))),
    descartarTarea: (tarea) =>
      void this.terminarTarea(tarea.carpeta, tarea.nombre, "descartar", true).catch((error) => avisar(String(error))),
    alCerrar: () => this.recuperarFoco(),
  });
  // Cada ventana principal es una sesión: se guarda con este id para reanudarla después.
  private readonly idSesion = String(Date.now());
  private readonly inicioSesion = Date.now();

  constructor() {
    this.aplicarPosicionPestanas();
    iniciarRegistro();
    if (this.ventana.label === "main") this.prepararControl();
    elemento("nueva-pestana").addEventListener("click", () => void this.nuevaPestana());
    elemento("alternar-archivos").addEventListener("click", () => this.archivos.alternar());
    elemento("alternar-cambios").addEventListener("click", () => this.cambios.alternar());
    elemento("alternar-mahzz").addEventListener("click", () => this.copiloto.alternar());
    window.addEventListener("mahzz:orden", (evento) => this.alRecibirOrden((evento as CustomEvent<string>).detail));
    elemento("perfil").addEventListener("click", (evento) => this.abrirMenuPerfil(evento));
    alCambiarCuenta(() => this.pintarPerfil());
    elemento("ajustes").addEventListener("click", () => this.abrirPantallaAjustes("general"));
    window.addEventListener("keydown", (evento) => this.alPresionarTecla(evento), true);
    window.addEventListener("contextmenu", (evento) => evento.preventDefault());
    window.addEventListener("focus", () => {
      void cargarHistorial();
      void cargarAjustes();
      requestAnimationFrame(() => this.recuperarFoco());
    });
    window.addEventListener("mahzz:poner-comando", (evento) => {
      this.activa?.activo.ponerEnEditor((evento as CustomEvent<string>).detail);
    });
    window.addEventListener("mahzz:secreto", (evento) => {
      void ofrecerGuardarSecreto((evento as CustomEvent<string>).detail, () => this.recuperarFoco());
    });
    window.addEventListener("mahzz:guardar-comando", (evento) => {
      guardarComando(this.apiPaleta, (evento as CustomEvent<string>).detail);
    });
    setInterval(() => void this.actualizarProgramas(), INTERVALO_PROGRAMAS);
  }

  private abrirMenuPerfil(evento: MouseEvent): void {
    const perfil = perfilActual();
    const opciones: OpcionMenu[] = perfil
      ? [
          { texto: perfil.correo ?? perfil.nombre ?? "Google", accion: () => undefined, desactivada: true },
          { texto: t("Sincronizar ahora"), accion: () => void sincronizarAhora() },
          { texto: t("Cerrar sesión"), accion: () => void cerrarSesion(), peligro: true },
        ]
      : [{ texto: t("Iniciar sesión con Google"), accion: () => void iniciarSesion() }];
    abrirMenu(evento.clientX - 190, evento.clientY + 14, { opciones }, () => this.activa?.activo.enfocar());
  }

  // Con la sesión iniciada, el botón muestra la foto de la cuenta de Google.
  private pintarPerfil(): void {
    const boton = elemento("perfil");
    const perfil = perfilActual();
    boton.querySelector(".barra__avatar")?.remove();
    boton.classList.toggle("barra__boton--cuenta", Boolean(perfil));
    boton.setAttribute("aria-label", perfil?.correo ?? t("Perfil"));
    boton.title = perfil?.correo ?? t("Perfil");
    if (!perfil) return;
    const avatar = document.createElement(perfil.foto ? "img" : "span");
    avatar.className = "barra__avatar";
    if (avatar instanceof HTMLImageElement) {
      avatar.src = perfil.foto ?? "";
      avatar.alt = "";
    } else {
      avatar.textContent = (perfil.nombre ?? perfil.correo ?? "G").charAt(0).toUpperCase();
    }
    boton.append(avatar);
  }

  private abrirPantallaAjustes(seccion: SeccionAjustes): void {
    abrirAjustes(seccion, () => this.recuperarFoco());
  }

  // Las pestañas pueden ir arriba (en la barra de la ventana) o en una columna a un costado.
  private aplicarPosicionPestanas(): void {
    const posicion = ajustes().posicionPestanas;
    const lateral = elemento("lateral-pestanas");
    const nueva = elemento("nueva-pestana");
    const vertical = posicion === "izquierda" || posicion === "derecha";
    if (vertical) {
      if (this.barra.parentElement !== lateral) lateral.append(this.barra, nueva);
    } else if (this.barra.parentElement === lateral) {
      elemento("alternar-cambios").after(this.barra, nueva);
    }
    lateral.hidden = !vertical;
    lateral.classList.toggle("lateral-pestanas--derecha", posicion === "derecha");
    document.body.classList.toggle("pestanas-verticales", vertical);
    this.barra.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal");
    this.activa?.elemento.scrollIntoView({ inline: "nearest", block: "nearest" });
  }

  private cerrarPanelSinPreguntar(pestana: Pestana, panel: Panel): void {
    if (!pestana.cerrarPanel(panel)) {
      pestana.contenido.remove();
      pestana.elemento.remove();
      this.quitarDeLista(pestana);
    }
  }

  // Crea el worktree de la tarea, abre una pestaña ahí y arranca al agente.
  private async crearTareaConAgente(
    pedido: PedidoTarea,
    carpetaBase: string | null,
  ): Promise<{ pestana: Pestana; tarea: TareaCreada }> {
    if (!carpetaBase) throw new Error(t("No hay una carpeta activa para crear la tarea"));
    const tarea = await crearTarea(carpetaBase, pedido.nombre);
    await this.nuevaPestana({
      tituloManual: `🤖 ${tarea.nombre}`,
      color: "#62d6e8",
      nodo: { tipo: "panel", activo: true, datos: { sesion: null, carpeta: tarea.carpeta, contenido: null } },
    });
    const pestana = this.activa;
    if (!pestana) throw new Error(t("No se pudo abrir la pestaña"));
    pestana.activo.ejecutarComando(comandoAgente(pedido.agente, pedido.instrucciones));
    return { pestana, tarea };
  }

  private async nuevaTareaInteractiva(): Promise<void> {
    const carpeta = this.activa?.activo.carpeta ?? null;
    const pedido = await pedirNuevaTarea();
    if (!pedido) {
      this.recuperarFoco();
      return;
    }
    try {
      const { tarea } = await this.crearTareaConAgente(pedido, carpeta);
      avisar(t("Tarea {0} creada en la rama {1}", tarea.nombre, tarea.rama));
    } catch (error) {
      avisar(t("No se pudo crear la tarea: {0}", String(error)));
    }
  }

  private async abrirTarea(tarea: Tarea): Promise<void> {
    for (const pestana of this.pestanas) {
      const panel = pestana.paneles.find((actual) => estaDentro(actual.carpeta, tarea.carpeta));
      if (panel) {
        this.activar(pestana);
        pestana.activarPanel(panel);
        panel.enfocar();
        return;
      }
    }
    await this.nuevaPestana({
      tituloManual: `🤖 ${tarea.nombre}`,
      color: "#62d6e8",
      nodo: { tipo: "panel", activo: true, datos: { sesion: null, carpeta: tarea.carpeta, contenido: null } },
    });
  }

  // Une o descarta una tarea. Antes cierra los paneles que están en esa carpeta,
  // porque Windows no deja borrar una carpeta que un PowerShell tiene abierta.
  private async terminarTarea(
    carpeta: string,
    nombre: string | null,
    modo: "unir" | "descartar",
    preguntar: boolean,
  ): Promise<unknown> {
    const etiqueta = nombre ?? carpeta.split("\\").filter(Boolean).at(-1) ?? carpeta;
    if (preguntar) {
      const seguir =
        modo === "unir"
          ? await confirmar(
              t("¿Unir la tarea {0}?", etiqueta),
              t("Lo que dejó el agente se guarda en un commit, se une a tu rama actual y se borra la carpeta de la tarea. Las pestañas abiertas en esa carpeta se cierran."),
              t("Unir"),
            )
          : await confirmar(
              t("¿Descartar la tarea {0}?", etiqueta),
              t("Se borran la carpeta y la rama con todo lo que hizo el agente. No se puede deshacer."),
              t("Descartar"),
            );
      if (!seguir) return null;
    }
    let cerro = false;
    for (const pestana of [...this.pestanas]) {
      for (const panel of [...pestana.paneles]) {
        if (estaDentro(panel.carpeta, carpeta)) {
          this.cerrarPanelSinPreguntar(pestana, panel);
          cerro = true;
        }
      }
    }
    if (cerro) await new Promise((listo) => setTimeout(listo, 900));
    const resultado = modo === "unir" ? await unirTarea(carpeta) : await descartarTarea(carpeta);
    avisar(modo === "unir" ? t("Tarea {0} unida", etiqueta) : t("Tarea {0} descartada", etiqueta));
    this.cambios.sincronizar();
    void this.agentes.refrescarTareas();
    return resultado;
  }

  // Lo que puede hacer una IA conectada por MCP (ver control.ts).
  private prepararControl(): void {
    iniciarControl({
      pestanas: () => this.pestanas,
      activa: () => this.activa,
      activar: (pestana) => this.activar(pestana),
      nuevaPestana: async (carpeta, titulo) => {
        await this.nuevaPestana(this.datosEnCarpeta(carpeta ?? this.activa?.activo.carpeta ?? null, titulo));
        if (!this.activa) throw new Error("No se pudo abrir la pestaña");
        return this.activa;
      },
      cerrarPanel: (pestana, panel) => this.cerrarPanelSinPreguntar(pestana, panel),
      crearTarea: (pedido, carpeta) => this.crearTareaConAgente(pedido, carpeta ?? this.activa?.activo.carpeta ?? null),
      terminarTarea: (carpeta, modo) => this.terminarTarea(carpeta, null, modo, false),
      renombrar: (pestana, titulo) => {
        pestana.tituloManual = titulo;
        this.pintarPestana(pestana);
      },
      agentes: () => this.agentes.listar(),
      abrirArchivo: (ruta) => void this.visor.abrir(ruta),
      abrirDesdeWindows: (pedido) => this.abrirDesdeWindows(pedido),
    });
  }

  private datosEnCarpeta(carpeta: string | null, titulo: string | null = null): DatosPestana {
    return {
      tituloManual: titulo,
      color: null,
      nodo: { tipo: "panel", activo: true, datos: { sesion: null, carpeta, contenido: null } },
    };
  }

  async nuevaPestanaEn(carpeta: string): Promise<void> {
    await this.nuevaPestana(this.datosEnCarpeta(carpeta));
  }

  // "Abrir en MahzzTerm" abre una pestaña en esa carpeta; "Abrir con" muestra el archivo en el visor.
  async abrirDesdeWindows(pedido: PedidoWindows): Promise<void> {
    if (pedido.carpeta) await this.nuevaPestanaEn(pedido.carpeta);
    if (pedido.archivo) await this.visor.abrir(pedido.archivo);
    requestAnimationFrame(() => this.recuperarFoco());
  }

  aplicarAjustes(): void {
    this.aplicarPosicionPestanas();
    for (const pestana of this.pestanas) {
      for (const panel of pestana.paneles) panel.aplicarAjustes();
    }
  }

  // Vuelve a abrir las pestañas y carpetas de la última vez.
  async restaurarSesion(): Promise<boolean> {
    const sesion = await invoke<{ pestanas: DatosPestana[]; activa: number } | null>("leer_sesion");
    if (!sesion?.pestanas?.length) return false;
    await this.abrirPestanasDe(sesion);
    return true;
  }

  private async abrirPestanasDe(sesion: { pestanas: DatosPestana[]; activa: number }): Promise<void> {
    const primera = this.pestanas.length;
    for (const pestana of sesion.pestanas) await this.nuevaPestana(prepararParaReanudar(pestana));
    const activa = this.pestanas[primera + (sesion.activa ?? 0)];
    if (activa) this.activar(activa);
  }

  // `mahzz --resume` muestra las sesiones anteriores; `mahzz --resume 2` abre directo la segunda.
  private async reanudarSesion(numero: number | null): Promise<void> {
    let sesiones: SesionGuardada[];
    try {
      sesiones = await listarSesiones(this.idSesion);
    } catch (error) {
      avisar(t("No se pudieron leer las sesiones: {0}", String(error)));
      return;
    }
    if (numero !== null) {
      const sesion = sesiones[numero - 1];
      if (sesion) await this.abrirPestanasDe(sesion);
      else avisar(t("No hay una sesión número {0}", numero));
      return;
    }
    elegirSesion(
      sesiones,
      (sesion) => void this.abrirPestanasDe(sesion),
      () => this.recuperarFoco(),
    );
  }

  private alRecibirOrden(orden: string): void {
    const partes = orden.trim().split(/\s+/);
    switch (partes[0]) {
      case "--resume": {
        const numero = Number(partes[1]);
        void this.reanudarSesion(Number.isInteger(numero) && numero > 0 ? numero : null);
        break;
      }
      case "--agentes":
        this.agentes.alternar();
        break;
      case "--cambios":
        this.cambios.alternar();
        break;
    }
  }

  private async nuevaPestanaCon(comando: string): Promise<void> {
    await this.nuevaPestana({
      tituloManual: null,
      color: null,
      nodo: {
        tipo: "panel",
        activo: true,
        datos: { sesion: null, carpeta: this.activa?.activo.carpeta ?? null, contenido: null },
      },
    });
    this.activa?.activo.ejecutarComando(comando);
  }

  private programarGuardadoSesion(): void {
    if (this.ventana.label !== "main") return;
    clearTimeout(this.temporizadorSesion);
    this.temporizadorSesion = window.setTimeout(() => {
      const activa = this.activa ? this.pestanas.indexOf(this.activa) : 0;
      const sesion = {
        id: this.idSesion,
        inicio: this.inicioSesion,
        actualizada: Date.now(),
        pestanas: this.pestanas.map((pestana) => pestana.plano()),
        activa,
      };
      void invoke("guardar_sesion", { sesion });
    }, 700);
  }

  // Al volver a la ventana el teclado tiene que quedar listo para escribir.
  recuperarFoco(): void {
    if (document.querySelector("dialog[open], .menu")) return;
    if (document.activeElement instanceof HTMLInputElement) return;
    if (window.getSelection()?.isCollapsed === false) return;
    // Si estabas en el visor o en el árbol de archivos, el foco se queda ahí.
    if (document.activeElement?.closest("#visor, #archivos")) return;
    this.activa?.activo.enfocar();
  }

  async nuevaPestana(datos?: DatosPestana): Promise<void> {
    const pestana = new Pestana({ alCambiar: (cambiada) => this.pintarPestana(cambiada) }, datos);
    this.prepararElemento(pestana);
    this.pestanas.push(pestana);
    this.barra.append(pestana.elemento);
    this.contenido.append(pestana.contenido);
    this.activar(pestana);
    await pestana.iniciar();
    this.pintarPestana(pestana);
  }

  private activar(pestana: Pestana): void {
    if (this.activa === pestana) return;
    this.activa?.ocultar();
    this.activa = pestana;
    for (const actual of this.pestanas) this.pintarPestana(actual);
    pestana.mostrar();
    pestana.elemento.scrollIntoView({ inline: "nearest", block: "nearest" });
  }

  private prepararElemento(pestana: Pestana): void {
    const raiz = pestana.elemento;
    raiz.className = "pestana";
    raiz.setAttribute("role", "tab");

    const punto = document.createElement("span");
    punto.className = "pestana__punto";
    const titulo = document.createElement("span");
    titulo.className = "pestana__titulo";
    const cerrar = document.createElement("button");
    cerrar.type = "button";
    cerrar.className = "pestana__cerrar";
    cerrar.setAttribute("aria-label", t("Cerrar pestaña"));
    cerrar.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1L1 9" /></svg>';
    raiz.append(punto, titulo, cerrar);

    cerrar.addEventListener("pointerdown", (evento) => evento.stopPropagation());
    cerrar.addEventListener("click", () => void this.cerrarPestana(pestana));
    raiz.addEventListener("pointerdown", (evento) => this.iniciarArrastre(pestana, evento));
    raiz.addEventListener("dblclick", (evento) => {
      if (evento.target !== cerrar && !cerrar.contains(evento.target as Node)) this.renombrar(pestana);
    });
    raiz.addEventListener("auxclick", (evento) => {
      if (evento.button === 1) void this.cerrarPestana(pestana);
    });
    raiz.addEventListener("contextmenu", (evento) => {
      evento.preventDefault();
      this.abrirMenuPestana(pestana, evento.clientX, evento.clientY);
    });
  }

  private pintarPestana(pestana: Pestana): void {
    const raiz = pestana.elemento;
    const activa = pestana === this.activa;
    raiz.classList.toggle("pestana--activa", activa);
    raiz.setAttribute("aria-selected", String(activa));
    raiz.title = pestana.activo.carpeta ?? pestana.titulo;
    raiz.style.setProperty("--color-pestana", pestana.color ?? "var(--acento)");
    const titulo = raiz.querySelector(".pestana__titulo");
    if (titulo) titulo.textContent = pestana.titulo;
    if (activa) {
      this.archivos.sincronizar();
      this.cambios.sincronizar();
    }
    this.programarGuardadoSesion();
  }

  private abrirMenuPestana(pestana: Pestana, x: number, y: number): void {
    abrirMenu(
      x,
      y,
      {
        opciones: [
          { texto: t("Renombrar"), accion: () => this.renombrar(pestana) },
          {
            texto: t("Mover a ventana nueva"),
            accion: () => void this.moverAVentana(pestana, null, null),
            desactivada: this.pestanas.length < 2,
          },
          { texto: t("Cerrar pestaña"), accion: () => void this.cerrarPestana(pestana), peligro: true },
        ],
        colores: COLORES,
        colorActual: pestana.color,
        alElegirColor: (color) => {
          pestana.color = color;
          this.pintarPestana(pestana);
        },
      },
      () => this.activa?.activo.enfocar(),
    );
  }

  private renombrar(pestana: Pestana): void {
    const titulo = pestana.elemento.querySelector<HTMLElement>(".pestana__titulo");
    if (!titulo || pestana.elemento.querySelector(".pestana__entrada")) return;

    const entrada = document.createElement("input");
    entrada.className = "pestana__entrada";
    entrada.value = pestana.titulo;
    entrada.setAttribute("aria-label", t("Nombre de la pestaña"));
    titulo.hidden = true;
    titulo.after(entrada);
    entrada.focus();
    entrada.select();

    let terminado = false;
    const terminar = (guardar: boolean) => {
      if (terminado) return;
      terminado = true;
      if (guardar) pestana.tituloManual = entrada.value.trim() || null;
      entrada.remove();
      titulo.hidden = false;
      this.pintarPestana(pestana);
      this.activa?.activo.enfocar();
    };
    entrada.addEventListener("pointerdown", (evento) => evento.stopPropagation());
    entrada.addEventListener("blur", () => terminar(true));
    entrada.addEventListener("keydown", (evento) => {
      evento.stopPropagation();
      if (evento.key === "Enter") terminar(true);
      if (evento.key === "Escape") terminar(false);
    });
  }

  // Arrastrar reordena. Soltar fuera de la ventana abre la pestaña en una ventana nueva.
  private iniciarArrastre(pestana: Pestana, inicio: PointerEvent): void {
    if (inicio.button !== 0) return;
    this.activar(pestana);

    const raiz = pestana.elemento;
    const vertical = document.body.classList.contains("pestanas-verticales");
    const caja = raiz.getBoundingClientRect();
    const agarre = vertical ? inicio.clientY - caja.top : inicio.clientX - caja.left;
    let arrastrando = false;
    raiz.setPointerCapture(inicio.pointerId);

    const mover = (evento: PointerEvent) => {
      const distancia = Math.hypot(evento.clientX - inicio.clientX, evento.clientY - inicio.clientY);
      if (!arrastrando && distancia < DISTANCIA_ARRASTRE) return;
      arrastrando = true;
      raiz.classList.add("pestana--arrastrando");

      const otras = this.pestanas.filter((otra) => otra !== pestana);
      const destino = otras.filter((otra) => {
        const caja = otra.elemento.getBoundingClientRect();
        return vertical ? caja.top + caja.height / 2 < evento.clientY : caja.left + caja.width / 2 < evento.clientX;
      }).length;
      if (this.pestanas.indexOf(pestana) !== destino) {
        otras.splice(destino, 0, pestana);
        this.pestanas = otras;
        this.barra.append(...this.pestanas.map((actual) => actual.elemento));
      }
      if (vertical) {
        const origen = this.barra.getBoundingClientRect().top + raiz.offsetTop - this.barra.scrollTop;
        raiz.style.transform = `translateY(${evento.clientY - agarre - origen}px)`;
      } else {
        const origen = this.barra.getBoundingClientRect().left + raiz.offsetLeft - this.barra.scrollLeft;
        raiz.style.transform = `translateX(${evento.clientX - agarre - origen}px)`;
      }
    };

    const soltar = (evento: PointerEvent) => {
      raiz.removeEventListener("pointermove", mover);
      raiz.removeEventListener("pointerup", soltar);
      raiz.removeEventListener("pointercancel", soltar);
      raiz.classList.remove("pestana--arrastrando");
      raiz.style.transform = "";
      const afuera =
        evento.clientX < 0 ||
        evento.clientY < 0 ||
        evento.clientX > innerWidth ||
        evento.clientY > innerHeight;
      if (evento.type === "pointerup" && arrastrando && afuera && this.pestanas.length > 1) {
        void this.moverAVentana(pestana, evento.screenX - 80, evento.screenY - 16);
      } else {
        pestana.activo.enfocar();
      }
    };

    raiz.addEventListener("pointermove", mover);
    raiz.addEventListener("pointerup", soltar);
    raiz.addEventListener("pointercancel", soltar);
  }

  private async moverAVentana(pestana: Pestana, x: number | null, y: number | null): Promise<void> {
    if (this.pestanas.length < 2) return;
    const traspaso = await pestana.exportar();
    try {
      await invoke("abrir_ventana", { traspaso, x, y });
    } catch (error) {
      console.error("No se pudo mover la pestaña", error);
      await pestana.reanudar();
      return;
    }
    pestana.soltar();
    this.quitarDeLista(pestana);
  }

  private quitarDeLista(pestana: Pestana): void {
    const indice = this.pestanas.indexOf(pestana);
    this.pestanas.splice(indice, 1);
    if (this.pestanas.length === 0) {
      void this.ventana.destroy();
      return;
    }
    if (this.activa === pestana) {
      this.activa = null;
      this.activar(this.pestanas[Math.min(indice, this.pestanas.length - 1)]);
    }
  }

  private async programasCorriendo(paneles: Panel[]): Promise<string[]> {
    const ids = paneles.flatMap((panel) => (panel.sesion === null ? [] : [panel.sesion]));
    if (ids.length === 0) return [];
    const programas = await invoke<Record<string, string | null>>("programas_sesiones", { ids });
    return [...new Set(Object.values(programas).filter((nombre): nombre is string => Boolean(nombre)))];
  }

  private async confirmarCierre(paneles: Panel[], titulo: string, textoAceptar: string): Promise<boolean> {
    const programas = await this.programasCorriendo(paneles);
    if (programas.length === 0) return true;
    const mensaje =
      programas.length === 1
        ? t("{0} sigue corriendo. Si cerrás ahora, se va a detener.")
        : t("{0} siguen corriendo. Si cerrás ahora, se van a detener.");
    return confirmar(titulo, t(mensaje, programas.join(", ")), textoAceptar);
  }

  private async cerrarPestana(pestana: Pestana): Promise<void> {
    const seguir = await this.confirmarCierre(pestana.paneles, t("¿Cerrar esta pestaña?"), t("Cerrar pestaña"));
    if (seguir) {
      pestana.cerrar();
      this.quitarDeLista(pestana);
    } else {
      this.activa?.activo.enfocar();
    }
  }

  private async cerrarPanelActivo(): Promise<void> {
    const pestana = this.activa;
    if (!pestana) return;
    const panel = pestana.activo;
    const seguir = await this.confirmarCierre([panel], t("¿Cerrar este panel?"), t("Cerrar panel"));
    if (!seguir) {
      panel.enfocar();
      return;
    }
    if (!pestana.cerrarPanel(panel)) {
      pestana.contenido.remove();
      pestana.elemento.remove();
      this.quitarDeLista(pestana);
    }
  }

  // La usa el botón de cerrar y también Alt+F4.
  async confirmarCierreVentana(): Promise<boolean> {
    if (this.visor.hayCambiosSinGuardar()) {
      const descartar = await confirmar(
        t("Hay archivos sin guardar"),
        t("Tenés cambios sin guardar en el visor. Si cerrás ahora, se pierden."),
        t("Cerrar sin guardar"),
      );
      if (!descartar) return false;
    }
    const paneles = this.pestanas.flatMap((pestana) => pestana.paneles);
    const seguir = await this.confirmarCierre(paneles, t("¿Cerrar esta ventana?"), t("Cerrar ventana"));
    if (!seguir) this.activa?.activo.enfocar();
    return seguir;
  }

  private async actualizarProgramas(): Promise<void> {
    const paneles = this.pestanas
      .flatMap((pestana) => pestana.paneles)
      .filter((panel) => panel.sesion !== null);
    if (paneles.length > 0) {
      const programas = await invoke<Record<string, string | null>>("programas_sesiones", {
        ids: paneles.map((panel) => panel.sesion),
      });
      for (const panel of paneles) {
        if (panel.sesion !== null) panel.registrarPrograma(programas[panel.sesion] ?? null);
      }
    }
    this.agentes.actualizar();
  }

  private alPresionarTecla(evento: KeyboardEvent): void {
    if (document.querySelector("dialog[open], .menu")) return;
    if (evento.target instanceof HTMLInputElement) return;
    // En el visor (por ejemplo editando código) las teclas son del editor.
    if (evento.target instanceof Element && evento.target.closest("#visor")) return;

    const panel = this.activa?.activo;
    if (evento.key === "Escape" && panel?.lista.hayBloqueSeleccionado && !panel.ocupado) {
      evento.preventDefault();
      evento.stopPropagation();
      panel.lista.deseleccionar();
      return;
    }

    const accion = accionDeTecla(evento);
    if (!accion) return;
    if (ACCIONES_DE_BLOQUES.includes(accion) && panel?.ocupado) return;
    evento.preventDefault();
    evento.stopPropagation();
    this.ejecutar(accion);
  }

  private moverActiva(paso: number): void {
    if (!this.activa) return;
    const total = this.pestanas.length;
    const indice = this.pestanas.indexOf(this.activa);
    this.activar(this.pestanas[(indice + paso + total) % total]);
  }

  private enfocarPanel(sentido: Sentido): void {
    this.activa?.enfocarVecino(sentido);
  }

  private ejecutar(accion: Accion): void {
    if (accion.startsWith("irPestana")) {
      const pestana = this.pestanas[Number(accion.slice("irPestana".length)) - 1];
      if (pestana) this.activar(pestana);
      return;
    }
    switch (accion) {
      case "nuevaPestana":
        void this.nuevaPestana();
        break;
      case "nuevaVentana":
        void invoke("abrir_ventana", { traspaso: null, x: null, y: null });
        break;
      case "cerrarPanel":
        void this.cerrarPanelActivo();
        break;
      case "pestanaSiguiente":
        this.moverActiva(1);
        break;
      case "pestanaAnterior":
        this.moverActiva(-1);
        break;
      case "dividirDerecha":
        void this.activa?.dividir("fila");
        break;
      case "dividirAbajo":
        void this.activa?.dividir("columna");
        break;
      case "panelIzquierda":
        this.enfocarPanel("izquierda");
        break;
      case "panelDerecha":
        this.enfocarPanel("derecha");
        break;
      case "panelArriba":
        this.enfocarPanel("arriba");
        break;
      case "panelAbajo":
        this.enfocarPanel("abajo");
        break;
      case "buscar":
        this.activa?.abrirBusqueda();
        break;
      case "bloqueAnterior":
        this.activa?.activo.lista.moverSeleccion(-1);
        break;
      case "bloqueSiguiente":
        this.activa?.activo.lista.moverSeleccion(1);
        break;
      case "historial":
        abrirHistorial(this.apiPaleta);
        break;
      case "paleta":
        void abrirPaleta(this.apiPaleta);
        break;
      case "guardarComando":
        guardarComando(this.apiPaleta);
        break;
      case "verGuardados":
        void abrirGuardados(this.apiPaleta);
        break;
      case "alternarArchivos":
        this.archivos.alternar();
        break;
      case "abrirAjustes":
        this.abrirPantallaAjustes("general");
        break;
      case "alternarCambios":
        this.cambios.alternar();
        break;
      case "alternarAgentes":
        this.agentes.alternar();
        break;
      case "alternarMahzz":
        this.copiloto.alternar();
        break;
      case "reanudarSesion":
        void this.reanudarSesion(null);
        break;
      case "buscarLogs":
        abrirBuscadorRegistros(
          (comando) => this.activa?.activo.ponerEnEditor(comando),
          () => this.recuperarFoco(),
        );
        break;
      case "nuevaTarea":
        void this.nuevaTareaInteractiva();
        break;
    }
  }
}
