import { invoke } from "@tauri-apps/api/core";
import { ajustes, alCambiarAjustes, cambiarAjustes, type Ajustes } from "./ajustes";
import { avisar } from "./dialogos";
import { cargarHistorial, entradasHistorial, type EntradaHistorial } from "./historial";
import { t } from "./i18n";
import { guardarTema, listaTemas, TEMA_MAHZZ, type Tema } from "./temas";

export interface Perfil {
  nombre: string | null;
  correo: string | null;
  foto: string | null;
}

interface ComandoRemoto {
  id: string;
  nombre: string;
  comando: string;
}

interface Paquete {
  version: 1;
  fecha: number;
  ajustes: Partial<Ajustes>;
  temas: Tema[];
  guardados: ComandoRemoto[];
  historial: EntradaHistorial[];
}

const CLAVE_FECHA = "mazz-sync-fecha";
const RETRASO_SUBIDA = 8000;

let perfil: Perfil | null = null;
let sincronizando = false;
let aplicandoRemoto = false;
let temporizador = 0;
const oyentes = new Set<() => void>();

export function perfilActual(): Perfil | null {
  return perfil;
}

export function alCambiarCuenta(oyente: () => void): void {
  oyentes.add(oyente);
}

function definirPerfil(nuevo: Perfil | null): void {
  perfil = nuevo;
  for (const oyente of oyentes) oyente();
}

function leerFecha(): number {
  try {
    return Number(localStorage.getItem(CLAVE_FECHA)) || 0;
  } catch {
    return 0;
  }
}

function guardarFecha(fecha: number): void {
  try {
    localStorage.setItem(CLAVE_FECHA, String(fecha));
  } catch {
  }
}

function ajustesCompartidos(): Partial<Ajustes> {
  const { primerUsoHecho: _primerUso, desplegableActivo: _activo, desplegableAtajo: _atajo, ...resto } = ajustes();
  return resto;
}

async function armarPaquete(fecha: number): Promise<Paquete> {
  return {
    version: 1,
    fecha,
    ajustes: ajustesCompartidos(),
    temas: listaTemas().filter((tema) => tema.id !== TEMA_MAHZZ.id),
    guardados: await invoke<ComandoRemoto[]>("leer_guardados"),
    historial: [...entradasHistorial()],
  };
}

async function fusionar(remoto: Paquete): Promise<void> {
  const fechaLocal = leerFecha();
  if (remoto.fecha > fechaLocal) {
    await cambiarAjustes(remoto.ajustes);
    for (const tema of remoto.temas) await guardarTema(tema);

    const locales = await invoke<ComandoRemoto[]>("leer_guardados");
    const ids = new Set(remoto.guardados.map((comando) => comando.id));
    const guardados = fechaLocal === 0
      ? [...remoto.guardados, ...locales.filter((comando) => !ids.has(comando.id))]
      : remoto.guardados;
    await invoke("escribir_guardados", { lista: guardados });
  }
  await invoke("fusionar_historial", { entradas: remoto.historial });
  await cargarHistorial();
}

async function sincronizar(manual: boolean): Promise<void> {
  if (!perfil || sincronizando) return;
  sincronizando = true;
  aplicandoRemoto = true;
  try {
    const remoto = await invoke<Paquete | null>("bajar_sincronizacion");
    if (remoto?.version === 1) await fusionar(remoto);
    const fecha = Date.now();
    await invoke("subir_sincronizacion", { contenido: await armarPaquete(fecha) });
    guardarFecha(fecha);
    if (manual) avisar(t("Datos sincronizados"));
  } catch (error) {
    if (manual) avisar(t("No se pudo sincronizar: {0}", String(error)));
    else console.warn("Sincronización pendiente", error);
  } finally {
    sincronizando = false;
    aplicandoRemoto = false;
  }
}

export function sincronizarAhora(): Promise<void> {
  return sincronizar(true);
}

function programarSubida(): void {
  if (!perfil || aplicandoRemoto) return;
  clearTimeout(temporizador);
  temporizador = window.setTimeout(() => void sincronizar(false), RETRASO_SUBIDA);
}

export async function cargarCuenta(): Promise<void> {
  alCambiarAjustes(programarSubida);
  window.addEventListener("mahzz:datos-cambiados", programarSubida);
  definirPerfil(await invoke<Perfil | null>("cuenta_google"));
  void sincronizar(false);
}

export async function iniciarSesion(): Promise<void> {
  if (!(await invoke<boolean>("google_configurado"))) {
    avisar(t("Esta copia de MahzzTerm no tiene configurado Google"));
    return;
  }
  avisar(t("Completá el inicio de sesión en tu navegador"));
  try {
    definirPerfil(await invoke<Perfil>("iniciar_sesion_google"));
    avisar(t("Sesión iniciada"));
    await sincronizar(false);
  } catch (error) {
    avisar(t("No se pudo iniciar sesión: {0}", String(error)));
  }
}

export async function cerrarSesion(): Promise<void> {
  clearTimeout(temporizador);
  await invoke("cerrar_sesion_google");
  guardarFecha(0);
  definirPerfil(null);
  avisar(t("Sesión cerrada"));
}
