import { ajustes, cambiarAjustes, type Ajustes } from "./ajustes";
import { ACCIONES_EDITABLES, combinacionActual, combinacionDeEvento, textoAtajo } from "./atajos";
import { avisar, confirmar } from "./dialogos";
import { t } from "./i18n";
import { borrarSecreto, listarSecretos } from "./secretos";
import {
  aplicarTema,
  borrarTema,
  CLAVES_COLOR,
  guardarTema,
  listaTemas,
  TEMA_MAHZZ,
  temaActual,
  type ClaveColor,
  type Tema,
} from "./temas";

export type SeccionAjustes = "general" | "apariencia" | "temas" | "terminal" | "atajos" | "secretos";

export const SECCIONES: { id: SeccionAjustes; titulo: string }[] = [
  { id: "general", titulo: t("General") },
  { id: "apariencia", titulo: t("Apariencia") },
  { id: "temas", titulo: t("Temas") },
  { id: "terminal", titulo: t("Terminal") },
  { id: "atajos", titulo: t("Atajos") },
  { id: "secretos", titulo: t("Secretos") },
];

export const FUENTES = ["JetBrains Mono", "Cascadia Code", "Fira Code", "Consolas"];

const NOMBRES_COLOR: Record<ClaveColor, string> = {
  fondo: t("Fondo"),
  barra: t("Barra superior"),
  elevado: t("Menús"),
  borde: t("Bordes"),
  texto: t("Texto"),
  textoSuave: t("Texto secundario"),
  acento: t("Acento"),
  acentoClaro: t("Acento claro"),
};

function fila(etiqueta: string, control: HTMLElement, ayuda?: string): HTMLElement {
  const contenedor = document.createElement("div");
  contenedor.className = "ajuste";
  const textos = document.createElement("div");
  textos.className = "ajuste__textos";
  const titulo = document.createElement("label");
  titulo.textContent = etiqueta;
  textos.append(titulo);
  if (ayuda) {
    const detalle = document.createElement("div");
    detalle.className = "ajuste__ayuda";
    detalle.textContent = ayuda;
    textos.append(detalle);
  }
  control.setAttribute("aria-label", etiqueta);
  contenedor.append(textos, control);
  return contenedor;
}

function lista(opciones: [string, string][], valor: string, alCambiar: (valor: string) => void): HTMLSelectElement {
  const selector = document.createElement("select");
  selector.className = "ajuste__control";
  for (const [clave, texto] of opciones) selector.add(new Option(texto, clave, false, clave === valor));
  selector.addEventListener("change", () => alCambiar(selector.value));
  return selector;
}

function interruptor(clave: keyof Ajustes): HTMLInputElement {
  const caja = document.createElement("input");
  caja.type = "checkbox";
  caja.className = "ajuste__interruptor";
  caja.checked = Boolean(ajustes()[clave]);
  caja.addEventListener("change", () => void cambiarAjustes({ [clave]: caja.checked }));
  return caja;
}

function numero(clave: keyof Ajustes, minimo: number, maximo: number): HTMLInputElement {
  const entrada = document.createElement("input");
  entrada.type = "number";
  entrada.className = "ajuste__control";
  entrada.min = String(minimo);
  entrada.max = String(maximo);
  entrada.value = String(ajustes()[clave]);
  entrada.addEventListener("change", () => {
    const valor = Math.min(maximo, Math.max(minimo, Number(entrada.value) || minimo));
    entrada.value = String(valor);
    void cambiarAjustes({ [clave]: valor });
  });
  return entrada;
}

function boton(texto: string, accion: () => void, clase = "boton"): HTMLButtonElement {
  const elemento = document.createElement("button");
  elemento.type = "button";
  elemento.className = clase;
  elemento.textContent = texto;
  elemento.addEventListener("click", accion);
  return elemento;
}

function seccionGeneral(): HTMLElement[] {
  return [
    fila(
      t("Idioma"),
      lista(
        [["auto", t("Automático (según Windows)")], ["es", "Español"], ["en", "English"]],
        ajustes().idioma,
        (valor) => void cambiarAjustes({ idioma: valor as Ajustes["idioma"] }),
      ),
      t("El idioma se aplica al volver a abrir MahzzTerm."),
    ),
    fila(t("Restaurar pestañas al abrir"), interruptor("restaurarPestanas")),
    fila(t("Avisar cuando termina un comando largo"), interruptor("avisarComandos")),
    fila(t("Segundos para avisar"), numero("segundosAviso", 5, 3600)),
    fila(t("Ventana desplegable"), interruptor("desplegableActivo"), t("Baja desde arriba de la pantalla con un atajo global.")),
  ];
}

function seccionApariencia(): HTMLElement[] {
  return [
    fila(
      t("Fuente"),
      lista(FUENTES.map((fuente) => [fuente, fuente]), ajustes().fuente, (fuente) => void cambiarAjustes({ fuente })),
    ),
    fila(t("Tamaño de fuente"), numero("tamanoFuente", 10, 24)),
    fila(
      t("Cursor"),
      lista(
        [["bar", t("Barra")], ["block", t("Bloque")], ["underline", t("Subrayado")]],
        ajustes().cursor,
        (cursor) => void cambiarAjustes({ cursor: cursor as Ajustes["cursor"] }),
      ),
    ),
    fila(t("Cursor con parpadeo"), interruptor("parpadeo")),
    fila(
      t("Posición de las pestañas"),
      lista(
        [["arriba", t("Arriba")], ["izquierda", t("A la izquierda")], ["derecha", t("A la derecha")]],
        ajustes().posicionPestanas,
        (posicion) => void cambiarAjustes({ posicionPestanas: posicion as Ajustes["posicionPestanas"] }),
      ),
      t("A un costado entran más pestañas y se leen mejor los nombres."),
    ),
  ];
}

function seccionTerminal(): HTMLElement[] {
  return [
    fila(
      t("Líneas guardadas por pestaña"),
      lista(
        [["10000", "10.000"], ["50000", "50.000"], ["100000", "100.000"], ["0", t("Ilimitado")]],
        String(ajustes().scrollback),
        (valor) => void cambiarAjustes({ scrollback: Number(valor) }),
      ),
      t("Usar más líneas consume más memoria."),
    ),
    fila(t("Avisar antes de pegar varias líneas"), interruptor("avisarPegado")),
  ];
}

function seccionTemas(redibujar: () => void): HTMLElement[] {
  const tema = temaActual();
  const editable = tema.id !== TEMA_MAHZZ.id;

  const elegir = lista(
    listaTemas().map((actual) => [actual.id, actual.nombre]),
    tema.id,
    (id) => void cambiarAjustes({ tema: id }).then(redibujar),
  );
  const acciones = document.createElement("div");
  acciones.className = "ajuste__acciones";
  acciones.append(
    elegir,
    boton(t("Duplicar"), () => {
      const id = `tema-${Date.now()}`;
      const copia: Tema = { ...structuredClone(tema), id, nombre: `${tema.nombre} 2` };
      void guardarTema(copia).then(() => cambiarAjustes({ tema: id })).then(redibujar);
    }),
  );
  if (editable) {
    acciones.append(
      boton(
        t("Eliminar"),
        () =>
          void confirmar(t("¿Eliminar este tema?"), tema.nombre, t("Eliminar")).then(async (aceptado) => {
            if (!aceptado) return;
            await borrarTema(tema.id);
            await cambiarAjustes({ tema: TEMA_MAHZZ.id });
            redibujar();
          }),
        "boton boton--peligro",
      ),
    );
  }
  const elementos = [fila(t("Tema"), acciones, editable ? undefined : t("Duplicá este tema para editar sus colores."))];
  if (!editable) return elementos;

  let temporizador = 0;
  const actualizar = () => {
    aplicarTema(tema);
    clearTimeout(temporizador);
    temporizador = window.setTimeout(() => void guardarTema(tema).then(() => cambiarAjustes({ tema: tema.id })), 250);
  };

  const nombre = document.createElement("input");
  nombre.className = "ajuste__control";
  nombre.value = tema.nombre;
  nombre.addEventListener("input", () => {
    tema.nombre = nombre.value;
    actualizar();
  });
  elementos.push(fila(t("Nombre del tema"), nombre));

  const selectorColor = (valor: string, etiqueta: string, alCambiar: (color: string) => void) => {
    const color = document.createElement("input");
    color.type = "color";
    color.className = "ajuste__color";
    color.value = valor;
    color.title = etiqueta;
    color.setAttribute("aria-label", etiqueta);
    color.addEventListener("input", () => {
      alCambiar(color.value);
      actualizar();
    });
    return color;
  };

  for (const clave of CLAVES_COLOR) {
    elementos.push(
      fila(NOMBRES_COLOR[clave], selectorColor(tema.colores[clave], NOMBRES_COLOR[clave], (color) => {
        tema.colores[clave] = color;
      })),
    );
  }
  const paleta = document.createElement("div");
  paleta.className = "ajuste__paleta";
  tema.ansi.forEach((valor, indice) => {
    paleta.append(selectorColor(valor, `ANSI ${indice}`, (color) => {
      tema.ansi[indice] = color;
    }));
  });
  elementos.push(fila(t("Colores de la terminal"), paleta));
  return elementos;
}

function seccionAtajos(redibujar: () => void): HTMLElement[] {
  const filas = ACCIONES_EDITABLES.map(({ accion, titulo }) => {
    const control = boton(textoAtajo(accion) ?? "-", () => {
      control.textContent = t("Presioná una combinación");
      const capturar = (evento: KeyboardEvent) => {
        evento.preventDefault();
        evento.stopPropagation();
        const combinacion = combinacionDeEvento(evento);
        if (!combinacion) return;
        window.removeEventListener("keydown", capturar, true);
        const ocupada = ACCIONES_EDITABLES.find(
          (otra) => otra.accion !== accion && combinacionActual(otra.accion) === combinacion,
        );
        if (ocupada) {
          avisar(t("Ese atajo ya lo usa: {0}", ocupada.titulo));
          redibujar();
          return;
        }
        void cambiarAjustes({ atajos: { ...ajustes().atajos, [accion]: combinacion } }).then(redibujar);
      };
      window.addEventListener("keydown", capturar, true);
    });
    return fila(titulo, control);
  });
  return [...filas, boton(t("Restablecer atajos"), () => void cambiarAjustes({ atajos: {} }).then(redibujar))];
}

async function seccionSecretos(redibujar: () => void): Promise<HTMLElement[]> {
  const elementos = [
    fila(
      t("Preguntar antes de guardar comandos con claves"),
      interruptor("preguntarSecretos"),
      t("Se guardan cifrados y solo tu usuario de Windows puede leerlos."),
    ),
  ];
  const secretos = await listarSecretos();
  if (secretos.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "ajuste__ayuda";
    vacio.textContent = t("Todavía no guardaste secretos.");
    elementos.push(vacio);
  }
  for (const secreto of secretos) {
    elementos.push(
      fila(
        secreto.nombre,
        boton(
          t("Eliminar"),
          () =>
            void confirmar(t("¿Eliminar este secreto?"), secreto.nombre, t("Eliminar")).then(async (aceptado) => {
              if (aceptado) await borrarSecreto(secreto.id);
              redibujar();
            }),
          "boton boton--peligro",
        ),
      ),
    );
  }
  return elementos;
}

export function abrirAjustes(inicial: SeccionAjustes, alCerrar: () => void): void {
  const dialogo = document.createElement("dialog");
  dialogo.className = "ajustes";

  const navegacion = document.createElement("nav");
  navegacion.className = "ajustes__nav";
  const contenido = document.createElement("div");
  contenido.className = "ajustes__contenido";
  let actual = inicial;

  const dibujar = async () => {
    navegacion.querySelectorAll("button").forEach((elemento) => {
      elemento.setAttribute("aria-current", String(elemento.dataset.seccion === actual));
    });
    const redibujar = () => void dibujar();
    const elementos =
      actual === "general" ? seccionGeneral()
      : actual === "apariencia" ? seccionApariencia()
      : actual === "temas" ? seccionTemas(redibujar)
      : actual === "terminal" ? seccionTerminal()
      : actual === "atajos" ? seccionAtajos(redibujar)
      : await seccionSecretos(redibujar);
    const titulo = document.createElement("h2");
    titulo.className = "ajustes__titulo";
    titulo.textContent = SECCIONES.find((seccion) => seccion.id === actual)?.titulo ?? "";
    contenido.replaceChildren(titulo, ...elementos);
  };

  for (const seccion of SECCIONES) {
    const elemento = boton(seccion.titulo, () => {
      actual = seccion.id;
      void dibujar();
    }, "ajustes__seccion");
    elemento.dataset.seccion = seccion.id;
    navegacion.append(elemento);
  }
  navegacion.append(boton(t("Cerrar"), () => dialogo.close(), "ajustes__seccion ajustes__cerrar"));

  dialogo.append(navegacion, contenido);
  dialogo.addEventListener("close", () => {
    dialogo.remove();
    alCerrar();
  });
  document.body.append(dialogo);
  dialogo.showModal();
  void dibujar();
}
