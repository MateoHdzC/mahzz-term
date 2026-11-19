import { invoke } from "@tauri-apps/api/core";

type Oyente = () => void;

const RETRASO_LISTA = 1500;
let listaCompartida: Promise<string[]> | null = null;

// La lista se pide una sola vez por ventana y después de abrir, para no demorar el inicio.
function obtenerCmdlets(): Promise<string[]> {
  listaCompartida ??= new Promise((listo) => setTimeout(listo, RETRASO_LISTA)).then(() =>
    invoke<string[]>("comandos_powershell"),
  );
  return listaCompartida;
}

// Decide si un comando existe combinando cmdlets, alias, funciones y programas del PATH.
export class VerificadorComandos {
  private cmdlets: Set<string> | null = null;
  private nombresCmdlets: string[] = [];
  private nombresSesion: string[] = [];
  private sesion = new Set<string>();
  private ruta: string | null = null;
  private externos = new Map<string, boolean>();
  private pendientes = new Set<string>();
  private temporizador = 0;
  private readonly oyentes = new Set<Oyente>();

  constructor(private readonly obtenerCarpeta: () => string | null) {
    void obtenerCmdlets().then((nombres) => {
      if (nombres.length === 0) return;
      this.nombresCmdlets = nombres;
      this.cmdlets = new Set(nombres.map((nombre) => nombre.toLowerCase()));
      this.avisar();
    });
  }

  alCambiar(oyente: Oyente): void {
    this.oyentes.add(oyente);
  }

  private avisar(): void {
    for (const oyente of this.oyentes) oyente();
  }

  enRemoto = false;

  // En un servidor no se puede saber qué comandos existen desde esta PC.
  definirRemoto(remoto: boolean): void {
    this.enRemoto = remoto;
    this.avisar();
  }

  get rutaActual(): string | null {
    return this.ruta;
  }

  nombresConocidos(): string[] {
    return [...this.nombresSesion, ...this.nombresCmdlets];
  }

  definirSesion(nombres: string[]): void {
    this.nombresSesion = nombres.filter(Boolean);
    this.sesion = new Set(nombres.map((nombre) => nombre.toLowerCase()));
    this.avisar();
  }

  definirRuta(ruta: string): void {
    this.ruta = ruta;
    this.invalidar();
  }

  // Después de cada comando puede haber programas nuevos o una carpeta distinta.
  invalidar(): void {
    this.externos.clear();
    this.avisar();
  }

  // Devuelve true solo cuando hay certeza de que el comando no existe.
  noExiste(nombre: string): boolean {
    const clave = nombre.toLowerCase();
    if (this.enRemoto || !this.cmdlets || this.cmdlets.has(clave) || this.sesion.has(clave)) return false;
    const externo = this.externos.get(clave);
    if (externo === undefined) this.solicitar(clave);
    return externo === false;
  }

  private solicitar(clave: string): void {
    this.pendientes.add(clave);
    clearTimeout(this.temporizador);
    this.temporizador = window.setTimeout(() => void this.consultar(), 120);
  }

  private async consultar(): Promise<void> {
    const nombres = [...this.pendientes];
    this.pendientes.clear();
    if (nombres.length === 0) return;
    const resultado = await invoke<Record<string, boolean>>("existen_comandos", {
      nombres,
      carpeta: this.obtenerCarpeta(),
      ruta: this.ruta,
    });
    for (const [nombre, existe] of Object.entries(resultado)) this.externos.set(nombre, existe);
    this.avisar();
  }
}
