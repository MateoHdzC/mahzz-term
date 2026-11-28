import { invoke } from "@tauri-apps/api/core";

export interface EntradaHistorial {
  comando: string;
  carpeta: string | null;
  fecha: number;
  codigo: number;
}

const POSIBLE_SECRETO =
  /(pass(word|wd)?|pwd|secret|token|api[_-]?key|authorization|bearer)\s*[:=\s]\s*\S|\b(ghp_|gho_|github_pat_|glpat-|sk-[a-z0-9-]{8,}|xox[bp]-|AKIA[0-9A-Z]{12})/i;

let entradas: EntradaHistorial[] = [];

export function pareceSecreto(comando: string): boolean {
  return POSIBLE_SECRETO.test(comando);
}

export async function cargarHistorial(): Promise<void> {
  entradas = await invoke<EntradaHistorial[]>("leer_historial");
}

export function registrarEnHistorial(entrada: EntradaHistorial): void {
  if (pareceSecreto(entrada.comando)) {
    window.dispatchEvent(new CustomEvent("mahzz:secreto", { detail: entrada.comando }));
    return;
  }
  entradas.push(entrada);
  void invoke("agregar_historial", { entrada });
  window.dispatchEvent(new Event("mahzz:datos-cambiados"));
}

export function entradasHistorial(): readonly EntradaHistorial[] {
  return entradas;
}

export function comandosRecorribles(): string[] {
  const vistos = new Set<string>();
  const lista: string[] = [];
  for (let i = entradas.length - 1; i >= 0; i--) {
    const { comando } = entradas[i];
    if (vistos.has(comando)) continue;
    vistos.add(comando);
    lista.push(comando);
  }
  return lista.reverse();
}

export function sugerenciaFantasma(prefijo: string, carpeta: string | null): string | null {
  let mejor: EntradaHistorial | null = null;
  let mejorPuntaje = -1;
  for (let i = entradas.length - 1; i >= 0; i--) {
    const entrada = entradas[i];
    if (entrada.comando.length <= prefijo.length || !entrada.comando.startsWith(prefijo)) continue;
    if (entrada.comando.includes("\n")) continue;
    const puntaje = (entrada.carpeta === carpeta ? 2 : 0) + (entrada.codigo === 0 ? 1 : 0);
    if (puntaje > mejorPuntaje) {
      mejor = entrada;
      mejorPuntaje = puntaje;
      if (puntaje === 3) break;
    }
  }
  return mejor ? mejor.comando.slice(prefijo.length) : null;
}

export function carpetasRecientes(limite: number): string[] {
  const carpetas = new Set<string>();
  for (let i = entradas.length - 1; i >= 0 && carpetas.size < limite; i--) {
    const { carpeta } = entradas[i];
    if (carpeta) carpetas.add(carpeta);
  }
  return [...carpetas];
}
