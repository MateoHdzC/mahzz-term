import type { IBufferCell, IBufferLine, Terminal } from "@xterm/xterm";

export interface Captura {
  lineasHtml: string[];
  texto: string;
}

const NIVELES_CUBO = [0, 95, 135, 175, 215, 255];

function hexadecimal(rojo: number, verde: number, azul: number): string {
  return `#${[rojo, verde, azul].map((valor) => valor.toString(16).padStart(2, "0")).join("")}`;
}

function colorDePaleta(indice: number): string {
  if (indice < 16) return `var(--ansi-${indice})`;
  if (indice >= 232) {
    const gris = 8 + (indice - 232) * 10;
    return hexadecimal(gris, gris, gris);
  }
  const base = indice - 16;
  return hexadecimal(
    NIVELES_CUBO[Math.floor(base / 36)],
    NIVELES_CUBO[Math.floor(base / 6) % 6],
    NIVELES_CUBO[base % 6],
  );
}

function colorTexto(celda: IBufferCell): string | null {
  if (celda.isFgRGB()) return `#${celda.getFgColor().toString(16).padStart(6, "0")}`;
  return celda.isFgPalette() ? colorDePaleta(celda.getFgColor()) : null;
}

function colorFondo(celda: IBufferCell): string | null {
  if (celda.isBgRGB()) return `#${celda.getBgColor().toString(16).padStart(6, "0")}`;
  return celda.isBgPalette() ? colorDePaleta(celda.getBgColor()) : null;
}

function estiloDeCelda(celda: IBufferCell): string {
  let texto = colorTexto(celda);
  let fondo = colorFondo(celda);
  if (celda.isInverse()) {
    [texto, fondo] = [fondo ?? "var(--fondo)", texto ?? "var(--texto)"];
  }

  const reglas: string[] = [];
  if (celda.isInvisible()) reglas.push("color:transparent");
  else if (texto) reglas.push(`color:${texto}`);
  if (fondo) reglas.push(`background:${fondo}`);
  if (celda.isBold()) reglas.push("font-weight:700");
  if (celda.isItalic()) reglas.push("font-style:italic");
  if (celda.isDim()) reglas.push("opacity:.65");

  const decoraciones = [
    celda.isUnderline() ? "underline" : "",
    celda.isStrikethrough() ? "line-through" : "",
    celda.isOverline() ? "overline" : "",
  ].filter(Boolean);
  if (decoraciones.length > 0) reglas.push(`text-decoration:${decoraciones.join(" ")}`);
  return reglas.join(";");
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (caracter) => `&#${caracter.charCodeAt(0)};`);
}

function ultimaCeldaUsada(linea: IBufferLine, celda: IBufferCell): number {
  for (let x = linea.length - 1; x >= 0; x--) {
    linea.getCell(x, celda);
    const caracteres = celda.getChars();
    if ((caracteres && caracteres !== " ") || !celda.isBgDefault()) return x + 1;
  }
  return 0;
}

export function capturarRango(terminal: Terminal, desde: number, hasta: number): Captura {
  const buffer = terminal.buffer.normal;
  const celda = buffer.getNullCell();
  const lineasHtml: string[] = [];
  const lineasTexto: string[] = [];

  let html = "";
  let texto = "";
  let tramo = "";
  let estiloTramo = "";

  const cerrarTramo = () => {
    if (!tramo) return;
    const contenido = escapar(tramo);
    html += estiloTramo ? `<span style="${estiloTramo}">${contenido}</span>` : contenido;
    tramo = "";
  };

  for (let y = Math.max(0, desde); y < hasta; y++) {
    const linea = buffer.getLine(y);
    if (!linea) continue;

    const siguiente = y + 1 < hasta ? buffer.getLine(y + 1) : undefined;
    const continua = Boolean(siguiente?.isWrapped);
    const ancho = continua ? linea.length : ultimaCeldaUsada(linea, celda);

    for (let x = 0; x < ancho; x++) {
      linea.getCell(x, celda);
      if (celda.getWidth() === 0) continue;
      const caracteres = celda.getChars() || " ";
      const estilo = estiloDeCelda(celda);
      if (estilo !== estiloTramo) {
        cerrarTramo();
        estiloTramo = estilo;
      }
      tramo += caracteres;
      texto += caracteres;
    }

    if (!continua) {
      cerrarTramo();
      lineasHtml.push(html);
      lineasTexto.push(texto);
      html = "";
      texto = "";
    }
  }

  while (lineasTexto.length > 0 && lineasTexto[lineasTexto.length - 1].trim() === "") {
    lineasTexto.pop();
    lineasHtml.pop();
  }
  while (lineasTexto.length > 0 && lineasTexto[0].trim() === "") {
    lineasTexto.shift();
    lineasHtml.shift();
  }
  return { lineasHtml, texto: lineasTexto.join("\n") };
}
