import { t } from "./i18n";
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completionStatus,
  startCompletion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import {
  addCursorAbove,
  addCursorBelow,
  defaultKeymap,
  history,
  historyKeymap,
  insertNewline,
  simplifySelection,
} from "@codemirror/commands";
import { selectNextOccurrence } from "@codemirror/search";
import { EditorState, Prec, StateEffect, type Range } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  keymap,
  placeholder,
  rectangularSelection,
  tooltips,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { MotorAutocompletado } from "./autocompletado";
import type { VerificadorComandos } from "./comandos";
import { comandosRecorribles, sugerenciaFantasma } from "./historial";
import { tokenizar } from "./sintaxis";

export interface EventosEditor {
  alEjecutar(comando: string): boolean;
  alEnfocar(): void;
}

const refrescarSintaxis = StateEffect.define<null>();
const marcaError = Decoration.mark({
  class: "tk-error",
  attributes: { title: t("Este comando no existe en esta sesión") },
});

function crearSintaxis(verificador: VerificadorComandos) {
  const dibujar = (vista: EditorView): DecorationSet => {
    const marcas: Range<Decoration>[] = [];
    for (const token of tokenizar(vista.state.doc.toString())) {
      if (token.hasta <= token.desde) continue;
      marcas.push(Decoration.mark({ class: `tk-${token.tipo}` }).range(token.desde, token.hasta));
      const nombre = vista.state.sliceDoc(token.desde, token.hasta);
      if (token.verificable && verificador.noExiste(nombre)) {
        marcas.push(marcaError.range(token.desde, token.hasta));
      }
    }
    return Decoration.set(marcas, true);
  };

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(vista: EditorView) {
        this.decorations = dibujar(vista);
      }
      update(cambio: ViewUpdate) {
        const refrescar = cambio.transactions.some((transaccion) =>
          transaccion.effects.some((efecto) => efecto.is(refrescarSintaxis)),
        );
        if (cambio.docChanged || refrescar) this.decorations = dibujar(cambio.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

class TextoFantasma extends WidgetType {
  constructor(readonly texto: string) {
    super();
  }
  eq(otro: TextoFantasma): boolean {
    return otro.texto === this.texto;
  }
  toDOM(): HTMLElement {
    const elemento = document.createElement("span");
    elemento.className = "cm-fantasma";
    elemento.textContent = this.texto;
    return elemento;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function calcularFantasma(estado: EditorState, carpeta: string | null): string | null {
  const { doc, selection } = estado;
  if (doc.length === 0 || doc.lines > 1 || selection.ranges.length > 1) return null;
  if (!selection.main.empty || selection.main.head !== doc.length || completionStatus(estado)) return null;
  return sugerenciaFantasma(doc.toString(), carpeta);
}

function crearFantasma(obtenerCarpeta: () => string | null) {
  const dibujar = (estado: EditorState): DecorationSet => {
    const texto = calcularFantasma(estado, obtenerCarpeta());
    if (!texto) return Decoration.none;
    const widget = Decoration.widget({ widget: new TextoFantasma(texto), side: 1 });
    return Decoration.set([widget.range(estado.doc.length)]);
  };

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(vista: EditorView) {
        this.decorations = dibujar(vista.state);
      }
      update(cambio: ViewUpdate) {
        this.decorations = dibujar(cambio.state);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

export class EditorComandos {
  readonly elemento = document.createElement("div");
  private readonly vista: EditorView;
  private indiceHistorial: number | null = null;
  private recorrido: string[] = [];
  private borrador = "";

  constructor(
    private readonly eventos: EventosEditor,
    verificador: VerificadorComandos,
    private readonly motor: MotorAutocompletado,
    private readonly obtenerCarpeta: () => string | null,
    textoInicial = "",
  ) {
    this.elemento.className = "editor";

    const teclas = keymap.of([
      { key: "Enter", run: () => this.ejecutar() },
      { key: "Shift-Enter", run: insertNewline },
      { key: "Mod-c", run: () => this.copiarOVaciar() },
      { key: "ArrowUp", run: () => this.moverHistorial(-1) },
      { key: "ArrowDown", run: () => this.moverHistorial(1) },
      { key: "ArrowRight", run: () => this.aceptarFantasma(false) },
      { key: "End", run: () => this.aceptarFantasma(false) },
      { key: "Mod-ArrowRight", run: () => this.aceptarFantasma(true) },
      { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
      { key: "Shift-Alt-ArrowUp", run: addCursorAbove },
      { key: "Shift-Alt-ArrowDown", run: addCursorBelow },
      { key: "Escape", run: simplifySelection },
      { key: "Tab", run: () => this.alPresionarTab() },
      { key: "Shift-Tab", run: () => true },
    ]);

    this.vista = new EditorView({
      parent: this.elemento,
      state: EditorState.create({
        doc: textoInicial,
        extensions: [
          Prec.highest(keymap.of(completionKeymap)),
          Prec.high(teclas),
          history(),
          drawSelection({ cursorBlinkRate: 1100 }),
          EditorState.allowMultipleSelections.of(true),
          EditorView.clickAddsSelectionRange.of((evento) => evento.ctrlKey || evento.altKey),
          rectangularSelection(),
          closeBrackets(),
          autocompletion({
            override: [(contexto: CompletionContext) => this.motor.sugerir(contexto.state.doc.toString(), contexto.pos)],
            activateOnTyping: false,
            defaultKeymap: false,
            icons: false,
            maxRenderedOptions: 60,
            tooltipClass: () => "sugerencias",
          }),
          tooltips({ parent: document.body, position: "fixed" }),
          keymap.of([...closeBracketsKeymap, ...historyKeymap, ...defaultKeymap]),
          placeholder(t("Escribí un comando")),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": t("Editor de comandos"),
            spellcheck: "false",
            autocapitalize: "off",
            autocorrect: "off",
          }),
          crearSintaxis(verificador),
          crearFantasma(this.obtenerCarpeta),
          EditorView.domEventHandlers({
            focus: () => {
              this.eventos.alEnfocar();
              return false;
            },
          }),
        ],
      }),
    });

    verificador.alCambiar(() => this.vista.dispatch({ effects: refrescarSintaxis.of(null) }));
  }

  get texto(): string {
    return this.vista.state.doc.toString();
  }

  enfocar(): void {
    this.vista.focus();
  }

  get tieneFoco(): boolean {
    return this.vista.hasFocus;
  }

  definirTexto(texto: string): void {
    this.vista.dispatch({
      changes: { from: 0, to: this.vista.state.doc.length, insert: texto },
      selection: { anchor: texto.length },
    });
  }

  insertar(texto: string): void {
    this.vista.dispatch(this.vista.state.replaceSelection(texto));
  }

  private ejecutar(): boolean {
    const comando = this.texto.trim();
    if (!comando) return true;
    if (this.eventos.alEjecutar(comando)) {
      this.indiceHistorial = null;
      this.borrador = "";
      this.definirTexto("");
    }
    return true;
  }

  private copiarOVaciar(): boolean {
    if (this.vista.state.selection.ranges.some((rango) => !rango.empty)) return false;
    this.indiceHistorial = null;
    this.definirTexto("");
    return true;
  }

  private aceptarFantasma(soloPalabra: boolean): boolean {
    const fantasma = calcularFantasma(this.vista.state, this.obtenerCarpeta());
    if (!fantasma) return false;
    const texto = soloPalabra ? (fantasma.match(/^\s*\S+/)?.[0] ?? fantasma) : fantasma;
    const fin = this.vista.state.doc.length;
    this.vista.dispatch({ changes: { from: fin, insert: texto }, selection: { anchor: fin + texto.length } });
    return true;
  }

  private alPresionarTab(): boolean {
    if (completionStatus(this.vista.state) === "active") return acceptCompletion(this.vista);
    void this.completar();
    return true;
  }

  private async completar(): Promise<void> {
    const { state } = this.vista;
    if (state.selection.ranges.length > 1) return;
    const posicion = state.selection.main.head;
    const resultado = await this.motor.sugerir(state.doc.toString(), posicion);
    if (!resultado || this.vista.state.doc !== state.doc) return;

    const exactas = resultado.options.filter((opcion) =>
      opcion.label.toLowerCase().startsWith(resultado.parcial),
    );
    const unica = exactas.length === 1 ? exactas[0] : resultado.options.length === 1 ? resultado.options[0] : null;
    if (unica && typeof unica.apply === "string") {
      this.vista.dispatch({
        changes: { from: resultado.from, to: posicion, insert: unica.apply },
        selection: { anchor: resultado.from + unica.apply.length },
      });
      return;
    }
    startCompletion(this.vista);
  }

  private moverHistorial(paso: number): boolean {
    const { state } = this.vista;
    if (state.selection.ranges.length > 1 || !state.selection.main.empty) return false;
    const linea = state.doc.lineAt(state.selection.main.head).number;
    if (paso < 0 ? linea !== 1 : linea !== state.doc.lines) return false;
    if (this.indiceHistorial === null && paso > 0) return false;

    if (this.indiceHistorial === null) {
      this.recorrido = comandosRecorribles();
      if (this.recorrido.length === 0) return true;
      this.borrador = this.texto;
      this.indiceHistorial = this.recorrido.length;
    }
    const destino = this.indiceHistorial + paso;
    if (destino < 0) return true;
    if (destino >= this.recorrido.length) {
      this.indiceHistorial = null;
      this.definirTexto(this.borrador);
      return true;
    }
    this.indiceHistorial = destino;
    this.definirTexto(this.recorrido[destino]);
    return true;
  }

  destruir(): void {
    this.vista.destroy();
  }
}
