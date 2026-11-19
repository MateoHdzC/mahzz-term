import { t } from "./i18n";
export interface OpcionMenu {
  texto: string;
  accion: () => void;
  peligro?: boolean;
  desactivada?: boolean;
}

export interface ColorMenu {
  nombre: string;
  valor: string | null;
}

export interface ContenidoMenu {
  opciones: OpcionMenu[];
  colores?: ColorMenu[];
  colorActual?: string | null;
  alElegirColor?: (color: string | null) => void;
}

const DURACION_AVISO = 2600;

// Mensaje breve que confirma una acción sin interrumpir.
export function avisar(texto: string): void {
  document.querySelector(".aviso")?.remove();
  const aviso = document.createElement("div");
  aviso.className = "aviso";
  aviso.setAttribute("role", "status");
  aviso.textContent = texto;
  document.body.append(aviso);
  setTimeout(() => aviso.remove(), DURACION_AVISO);
}

// Pide confirmación con un diálogo propio, que resuelve el foco y la tecla Esc.
export function confirmar(titulo: string, mensaje: string, textoAceptar: string): Promise<boolean> {
  return new Promise((resolver) => {
    const dialogo = document.createElement("dialog");
    dialogo.className = "dialogo";

    const encabezado = document.createElement("h2");
    encabezado.className = "dialogo__titulo";
    encabezado.textContent = titulo;

    const texto = document.createElement("p");
    texto.className = "dialogo__mensaje";
    texto.textContent = mensaje;

    const cancelar = document.createElement("button");
    cancelar.type = "button";
    cancelar.className = "boton";
    cancelar.textContent = t("Cancelar");

    const aceptar = document.createElement("button");
    aceptar.type = "button";
    aceptar.className = "boton boton--peligro";
    aceptar.textContent = textoAceptar;

    const acciones = document.createElement("div");
    acciones.className = "dialogo__acciones";
    acciones.append(cancelar, aceptar);
    dialogo.append(encabezado, texto, acciones);

    let resultado = false;
    cancelar.addEventListener("click", () => dialogo.close());
    aceptar.addEventListener("click", () => {
      resultado = true;
      dialogo.close();
    });
    dialogo.addEventListener("close", () => {
      dialogo.remove();
      resolver(resultado);
    });

    document.body.append(dialogo);
    dialogo.showModal();
    cancelar.focus();
  });
}

export interface CampoFormulario {
  clave: string;
  etiqueta: string;
  valor?: string;
  multilinea?: boolean;
  obligatorio?: boolean;
}

// Pide datos en un diálogo. Devuelve null si la persona cancela.
export function pedirDatos(
  titulo: string,
  campos: CampoFormulario[],
  textoAceptar: string,
): Promise<Record<string, string> | null> {
  return new Promise((resolver) => {
    const dialogo = document.createElement("dialog");
    dialogo.className = "dialogo";

    const formulario = document.createElement("form");
    formulario.method = "dialog";
    const encabezado = document.createElement("h2");
    encabezado.className = "dialogo__titulo";
    encabezado.textContent = titulo;
    formulario.append(encabezado);

    const entradas = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
    for (const campo of campos) {
      const etiqueta = document.createElement("label");
      etiqueta.className = "dialogo__campo";
      etiqueta.textContent = campo.etiqueta;
      const entrada = document.createElement(campo.multilinea ? "textarea" : "input");
      entrada.className = "dialogo__entrada";
      entrada.value = campo.valor ?? "";
      entrada.required = Boolean(campo.obligatorio);
      entrada.spellcheck = false;
      etiqueta.append(entrada);
      formulario.append(etiqueta);
      entradas.set(campo.clave, entrada);
    }

    const cancelar = document.createElement("button");
    cancelar.type = "button";
    cancelar.className = "boton";
    cancelar.textContent = t("Cancelar");
    cancelar.addEventListener("click", () => dialogo.close());

    const aceptar = document.createElement("button");
    aceptar.type = "submit";
    aceptar.className = "boton boton--principal";
    aceptar.textContent = textoAceptar;

    const acciones = document.createElement("div");
    acciones.className = "dialogo__acciones";
    acciones.append(cancelar, aceptar);
    formulario.append(acciones);
    dialogo.append(formulario);

    let resultado: Record<string, string> | null = null;
    formulario.addEventListener("submit", () => {
      resultado = Object.fromEntries([...entradas].map(([clave, entrada]) => [clave, entrada.value]));
    });
    dialogo.addEventListener("keydown", (evento) => evento.stopPropagation());
    dialogo.addEventListener("close", () => {
      dialogo.remove();
      resolver(resultado);
    });

    document.body.append(dialogo);
    dialogo.showModal();
    [...entradas.values()][0]?.select();
  });
}

export function abrirMenu(x: number, y: number, contenido: ContenidoMenu, alCerrar: () => void): void {
  document.querySelector(".menu")?.remove();

  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");

  const cerrarMenu = () => {
    menu.remove();
    window.removeEventListener("pointerdown", alTocarAfuera, true);
    window.removeEventListener("keydown", alPresionar, true);
    window.removeEventListener("blur", cerrarMenu);
    alCerrar();
  };
  const alTocarAfuera = (evento: PointerEvent) => {
    if (!menu.contains(evento.target as Node)) cerrarMenu();
  };
  const alPresionar = (evento: KeyboardEvent) => {
    const botones = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const indice = botones.indexOf(document.activeElement as HTMLButtonElement);
    if (evento.key === "Escape") {
      cerrarMenu();
    } else if (evento.key === "ArrowDown") {
      botones[(indice + 1) % botones.length]?.focus();
    } else if (evento.key === "ArrowUp") {
      botones[(indice - 1 + botones.length) % botones.length]?.focus();
    } else if (evento.key !== "Enter" && evento.key !== " ") {
      return;
    } else {
      return;
    }
    evento.preventDefault();
    evento.stopPropagation();
  };

  for (const opcion of contenido.opciones) {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = opcion.peligro ? "menu__opcion menu__opcion--peligro" : "menu__opcion";
    boton.setAttribute("role", "menuitem");
    boton.textContent = opcion.texto;
    boton.disabled = Boolean(opcion.desactivada);
    boton.addEventListener("click", () => {
      cerrarMenu();
      opcion.accion();
    });
    menu.append(boton);
  }

  if (contenido.colores) {
    const colores = document.createElement("div");
    colores.className = "menu__colores";
    colores.setAttribute("role", "group");
    colores.setAttribute("aria-label", t("Color de la pestaña"));
    for (const color of contenido.colores) {
      const muestra = document.createElement("button");
      muestra.type = "button";
      muestra.className = "muestra";
      muestra.title = color.nombre;
      muestra.setAttribute("aria-label", color.nombre);
      muestra.setAttribute("aria-pressed", String(color.valor === contenido.colorActual));
      muestra.style.setProperty("--muestra", color.valor ?? "var(--acento)");
      muestra.addEventListener("click", () => {
        contenido.alElegirColor?.(color.valor);
        cerrarMenu();
      });
      colores.append(muestra);
    }
    menu.append(colores);
  }

  document.body.append(menu);
  const caja = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - caja.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - caja.height - 4))}px`;
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();

  window.addEventListener("pointerdown", alTocarAfuera, true);
  window.addEventListener("keydown", alPresionar, true);
  window.addEventListener("blur", cerrarMenu);
}
