export type TipoToken =
  | "comando"
  | "clave"
  | "parametro"
  | "texto"
  | "variable"
  | "numero"
  | "comentario"
  | "operador"
  | "tipo";

export interface Token {
  desde: number;
  hasta: number;
  tipo: TipoToken;
  // Solo estos comandos se verifican, para no marcar errores cuando hay dudas.
  verificable?: boolean;
}

const CLAVES = new Set(
  "if else elseif foreach for while do until switch function filter param try catch finally return throw break continue class enum begin process end in using exit trap data dynamicparam".split(" "),
);
const FIN_DE_PALABRA = /[\s|;(){}'"&<>,=$`]/;
const NUMERO = /^\d+(\.\d+)?([kmgtp]b)?$/i;

// Reconoce la sintaxis de PowerShell mientras se escribe, sin ejecutar nada.
export function tokenizar(texto: string): Token[] {
  const tokens: Token[] = [];
  const pila: string[] = [];
  let i = 0;
  let esperaComando = true;
  let saltarNombre = false;

  const agregar = (desde: number, hasta: number, tipo: TipoToken, verificable = false) => {
    tokens.push({ desde, hasta, tipo, verificable });
  };

  while (i < texto.length) {
    const caracter = texto[i];
    const siguiente = texto[i + 1] ?? "";

    if (caracter === "\n") {
      if (pila.length === 0) esperaComando = true;
      i++;
      continue;
    }
    if (/\s/.test(caracter)) {
      i++;
      continue;
    }

    if (caracter === "<" && siguiente === "#") {
      const fin = texto.indexOf("#>", i + 2);
      const hasta = fin < 0 ? texto.length : fin + 2;
      agregar(i, hasta, "comentario");
      i = hasta;
      continue;
    }
    if (caracter === "#") {
      const fin = texto.indexOf("\n", i);
      const hasta = fin < 0 ? texto.length : fin;
      agregar(i, hasta, "comentario");
      i = hasta;
      continue;
    }

    if (caracter === "@" && (siguiente === "'" || siguiente === '"')) {
      const cierre = texto.indexOf(`\n${siguiente}@`, i + 2);
      const hasta = cierre < 0 ? texto.length : cierre + 3;
      agregar(i, hasta, "texto");
      i = hasta;
      esperaComando = false;
      continue;
    }

    if (caracter === "'" || caracter === '"') {
      let j = i + 1;
      while (j < texto.length) {
        if (caracter === '"' && texto[j] === "`") {
          j += 2;
          continue;
        }
        if (texto[j] === caracter) {
          if (texto[j + 1] !== caracter) break;
          j++;
        }
        j++;
      }
      const hasta = Math.min(j + 1, texto.length);
      agregar(i, hasta, "texto");
      i = hasta;
      esperaComando = false;
      continue;
    }

    if (caracter === "$") {
      if (siguiente === "(") {
        agregar(i, i + 2, "operador");
        pila.push("(");
        i += 2;
        esperaComando = true;
        continue;
      }
      let j = i + 1;
      if (siguiente === "{") {
        const cierre = texto.indexOf("}", j);
        j = cierre < 0 ? texto.length : cierre + 1;
      } else if (/[?$^_]/.test(siguiente) && !/\w/.test(texto[i + 2] ?? "")) {
        j = i + 2;
      } else {
        while (j < texto.length && /[\w:]/.test(texto[j])) j++;
      }
      agregar(i, j, "variable");
      i = j;
      esperaComando = false;
      continue;
    }

    if (caracter === "@" && (siguiente === "{" || siguiente === "(")) {
      agregar(i, i + 2, "operador");
      pila.push(siguiente === "{" ? "@{" : "(");
      i += 2;
      esperaComando = siguiente === "(";
      continue;
    }

    if (caracter === "(" || caracter === "{") {
      agregar(i, i + 1, "operador");
      pila.push(caracter);
      i++;
      esperaComando = true;
      continue;
    }
    if (caracter === ")" || caracter === "}") {
      agregar(i, i + 1, "operador");
      pila.pop();
      i++;
      esperaComando = false;
      continue;
    }

    if (caracter === "[") {
      const cierre = texto.indexOf("]", i);
      const hasta = cierre < 0 ? texto.length : cierre + 1;
      agregar(i, hasta, "tipo");
      i = hasta;
      esperaComando = false;
      continue;
    }

    if (caracter === "|" || caracter === ";" || caracter === "&") {
      const doble = siguiente === caracter && caracter !== ";";
      const hasta = i + (doble ? 2 : 1);
      agregar(i, hasta, "operador");
      i = hasta;
      if (pila.at(-1) !== "@{") esperaComando = true;
      continue;
    }

    if (esperaComando && (caracter === "%" || caracter === "?") && /\s/.test(siguiente || " ")) {
      agregar(i, i + 1, "comando");
      i++;
      esperaComando = false;
      continue;
    }

    if ("=<>,+*/%!".includes(caracter)) {
      agregar(i, i + 1, "operador");
      esperaComando = caracter === "=" && pila.at(-1) !== "@{";
      i++;
      continue;
    }

    if (caracter === "-" && /[a-z-]/i.test(siguiente) && !esperaComando) {
      let j = i + 1;
      while (j < texto.length && !FIN_DE_PALABRA.test(texto[j]) && texto[j] !== ":") j++;
      agregar(i, j, "parametro");
      i = j;
      continue;
    }

    let j = i;
    while (j < texto.length && !FIN_DE_PALABRA.test(texto[j])) j++;
    if (j === i) j = i + 1;
    const palabra = texto.slice(i, j);
    const pegada = /[$'"`]/.test(texto[j] ?? "");

    if (NUMERO.test(palabra) || /^\d+\.\.\d*$/.test(palabra)) {
      agregar(i, j, "numero");
      esperaComando = false;
    } else if (palabra === "." && esperaComando) {
      // El punto ejecuta un script en la sesión actual: lo que sigue es el comando.
      agregar(i, j, "operador");
    } else if (saltarNombre) {
      agregar(i, j, "comando");
      saltarNombre = false;
      esperaComando = false;
    } else if (esperaComando && CLAVES.has(palabra.toLowerCase())) {
      agregar(i, j, "clave");
      const clave = palabra.toLowerCase();
      saltarNombre = clave === "function" || clave === "filter";
      esperaComando = !["exit", "break", "continue", "param"].includes(clave);
    } else if (esperaComando) {
      const verificable = pila.length === 0 && !pegada && /^[\p{L}_.\\/]/u.test(palabra);
      agregar(i, j, "comando", verificable);
      esperaComando = false;
    }
    i = j;
  }
  return tokens;
}
