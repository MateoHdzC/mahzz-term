import { ajustes, cambiarAjustes, type Ajustes } from "./ajustes";
import { FUENTES } from "./ajustesUI";
import { t } from "./i18n";
import { listaTemas } from "./temas";

interface Paso {
  titulo: string;
  opciones: [string, string][];
  valor: () => string;
  elegir: (valor: string) => Partial<Ajustes>;
}

export function mostrarPrimerUso(alTerminar: () => void): void {
  const pasos: Paso[] = [
    {
      titulo: t("Elegí tu idioma"),
      opciones: [["es", "Español"], ["en", "English"]],
      valor: () => (ajustes().idioma === "en" ? "en" : "es"),
      elegir: (idioma) => ({ idioma: idioma as Ajustes["idioma"] }),
    },
    {
      titulo: t("Elegí la fuente"),
      opciones: FUENTES.map((fuente) => [fuente, fuente]),
      valor: () => ajustes().fuente,
      elegir: (fuente) => ({ fuente }),
    },
    {
      titulo: t("Elegí el tema"),
      opciones: listaTemas().map((tema) => [tema.id, tema.nombre]),
      valor: () => ajustes().tema,
      elegir: (tema) => ({ tema }),
    },
    {
      titulo: t("¿Sumamos MahzzTerm al Explorador de Windows?"),
      opciones: [
        ["si", t("Sí: «Abrir en MahzzTerm» en el clic derecho y MahzzTerm en «Abrir con»")],
        ["no", t("No, gracias")],
      ],
      valor: () => (ajustes().integracionWindows ? "si" : "no"),
      elegir: (valor) => ({ integracionWindows: valor === "si" }),
    },
  ];

  const dialogo = document.createElement("dialog");
  dialogo.className = "dialogo primer-uso";
  let indice = 0;

  const dibujar = () => {
    const paso = pasos[indice];
    const encabezado = document.createElement("h2");
    encabezado.className = "dialogo__titulo";
    encabezado.textContent = t("Te damos la bienvenida a MahzzTerm");
    const subtitulo = document.createElement("p");
    subtitulo.className = "dialogo__mensaje";
    subtitulo.textContent = paso.titulo;

    const opciones = document.createElement("div");
    opciones.className = "primer-uso__opciones";
    opciones.setAttribute("role", "radiogroup");
    opciones.setAttribute("aria-label", paso.titulo);
    for (const [valor, texto] of paso.opciones) {
      const opcion = document.createElement("button");
      opcion.type = "button";
      opcion.className = "primer-uso__opcion";
      opcion.textContent = texto;
      opcion.setAttribute("role", "radio");
      opcion.setAttribute("aria-checked", String(valor === paso.valor()));
      opcion.addEventListener("click", () => void cambiarAjustes(paso.elegir(valor)).then(dibujar));
      opciones.append(opcion);
    }

    const nota = document.createElement("p");
    nota.className = "ajuste__ayuda";
    nota.textContent = t("Podés cambiar todo esto después en Ajustes.");

    const acciones = document.createElement("div");
    acciones.className = "dialogo__acciones";
    if (indice > 0) {
      const atras = document.createElement("button");
      atras.type = "button";
      atras.className = "boton";
      atras.textContent = t("Atrás");
      atras.addEventListener("click", () => {
        indice--;
        dibujar();
      });
      acciones.append(atras);
    }
    const siguiente = document.createElement("button");
    siguiente.type = "button";
    siguiente.className = "boton boton--principal";
    siguiente.textContent = indice === pasos.length - 1 ? t("Empezar") : t("Siguiente");
    siguiente.addEventListener("click", () => {
      if (indice < pasos.length - 1) {
        indice++;
        dibujar();
      } else {
        dialogo.close();
      }
    });
    acciones.append(siguiente);
    dialogo.replaceChildren(encabezado, subtitulo, opciones, nota, acciones);
    siguiente.focus();
  };

  dialogo.addEventListener("close", () => {
    dialogo.remove();
    void cambiarAjustes({ primerUsoHecho: true, integracionPreguntada: true }).then(alTerminar);
  });
  document.body.append(dialogo);
  dialogo.showModal();
  dibujar();
}
