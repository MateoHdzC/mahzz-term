import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { ajustes, alCambiarAjustes, cargarAjustes } from "./ajustes";
import { cargarCuenta } from "./cuenta";
import { definirAtajos } from "./atajos";
import "./estilos.css";
import type { PedidoWindows } from "./control";
import { carpetaDe, GestorPestanas } from "./gestor";
import { cargarHistorial } from "./historial";
import { t, traducirPagina } from "./i18n";
import type { DatosPestana } from "./pestana";
import { mostrarPrimerUso } from "./primerUso";
import { iniciarActualizaciones } from "./actualizaciones";
import { aplicarTema, cargarTemas } from "./temas";

const ICONO_MAXIMIZAR = "M0.5 0.5h9v9h-9z";
const ICONO_RESTAURAR = "M2.5 2.5v-2h7v7h-2M0.5 2.5h7v7h-7z";

const ventana = getCurrentWindow();
const esPrincipal = ventana.label === "main";

function boton(id: string): HTMLElement {
  const elemento = document.getElementById(id);
  if (!elemento) throw new Error(`Falta el elemento #${id}`);
  return elemento;
}

async function actualizarIconoMaximizar(): Promise<void> {
  const maximizada = await ventana.isMaximized();
  boton("icono-maximizar").setAttribute("d", maximizada ? ICONO_RESTAURAR : ICONO_MAXIMIZAR);
  boton("maximizar").setAttribute("aria-label", maximizada ? t("Restaurar") : t("Maximizar"));
  // Maximizada ocupa toda la pantalla, así que las esquinas vuelven a ser rectas.
  document.body.classList.toggle("ventana--maximizada", maximizada);
  await compensarBordesMaximizada(maximizada);
}

// Windows agranda las ventanas sin marco más allá de la pantalla: se recupera ese sobrante.
async function compensarBordesMaximizada(maximizada: boolean): Promise<void> {
  if (!maximizada) {
    document.body.style.padding = "";
    return;
  }
  const [monitor, posicion, tamano, escala] = await Promise.all([
    currentMonitor(),
    ventana.outerPosition(),
    ventana.outerSize(),
    ventana.scaleFactor(),
  ]);
  if (!monitor) return;
  const { position: inicio, size: disponible } = monitor.workArea;
  const sobrante = (valor: number) => `${Math.max(0, valor) / escala}px`;
  document.body.style.padding = [
    sobrante(inicio.y - posicion.y),
    sobrante(posicion.x + tamano.width - (inicio.x + disponible.width)),
    sobrante(posicion.y + tamano.height - (inicio.y + disponible.height)),
    sobrante(inicio.x - posicion.x),
  ].join(" ");
}

// Los botones de la ventana no se quedan con el foco del teclado.
for (const id of ["minimizar", "maximizar", "cerrar", "perfil", "ajustes", "alternar-archivos", "alternar-cambios", "alternar-mahzz", "agentes"]) {
  boton(id).addEventListener("mousedown", (evento) => evento.preventDefault());
}

boton("minimizar").addEventListener("click", () => void ventana.minimize());
boton("maximizar").addEventListener("click", () => void ventana.toggleMaximize());
boton("cerrar").addEventListener("click", () => void ventana.close());

function sincronizarDesplegable(): void {
  if (!esPrincipal) return;
  const { desplegableActivo: activo, desplegableAtajo: atajo } = ajustes();
  void invoke("definir_desplegable", { activo, atajo }).catch((error) => console.warn(error));
}

// "Abrir en MahzzTerm" y "Abrir con" se registran con el idioma y la ruta de esta copia.
// En modo desarrollo no, para no pisar la de la app instalada.
function sincronizarIntegracion(): void {
  if (!esPrincipal || import.meta.env.DEV) return;
  void invoke("integracion_windows", {
    activar: ajustes().integracionWindows,
    etiqueta: t("Abrir en MahzzTerm"),
  }).catch((error) => console.warn(error));
}

async function iniciar(): Promise<void> {
  let gestor: GestorPestanas | null = null;
  try {
    await cargarAjustes();
    await cargarTemas();
    aplicarTema();
    definirAtajos(ajustes().atajos);
    traducirPagina();

    // La fuente tiene que estar cargada antes de medir el tamaño de cada celda.
    await Promise.all([
      document.fonts.load('400 14px "JetBrains Mono"'),
      document.fonts.load('700 14px "JetBrains Mono"'),
    ]);

    await cargarHistorial();
    const creado = new GestorPestanas();
    gestor = creado;
    alCambiarAjustes(() => {
      aplicarTema();
      definirAtajos(ajustes().atajos);
      creado.aplicarAjustes();
      sincronizarDesplegable();
      sincronizarIntegracion();
    });
    sincronizarDesplegable();
    sincronizarIntegracion();
    await cargarCuenta();

    await ventana.onCloseRequested(async (evento) => {
      evento.preventDefault();
      if (await creado.confirmarCierreVentana()) await ventana.destroy();
    });
    await ventana.onResized(() => void actualizarIconoMaximizar());
    await actualizarIconoMaximizar();

    const traspaso = await invoke<DatosPestana | null>("tomar_traspaso");
    // Abierta desde el Explorador: una carpeta ("Abrir en MahzzTerm") o un archivo ("Abrir con").
    const pedido = esPrincipal && !traspaso ? await invoke<PedidoWindows | null>("tomar_pedido_windows") : null;
    const restaurada = !traspaso && esPrincipal && ajustes().restaurarPestanas && (await creado.restaurarSesion());
    if (!restaurada && !pedido?.carpeta) {
      if (pedido?.archivo) await creado.nuevaPestanaEn(carpetaDe(pedido.archivo));
      else await creado.nuevaPestana(traspaso ?? undefined);
    }
    if (pedido) await creado.abrirDesdeWindows(pedido);
  } catch (error) {
    boton("contenido").textContent = `No se pudo iniciar la terminal: ${String(error)}`;
  } finally {
    // La ventana se muestra recién cuando está lista, para evitar el parpadeo blanco.
    await ventana.show();
    await ventana.setFocus();
    gestor?.recuperarFoco();
    if (esPrincipal && !ajustes().primerUsoHecho) mostrarPrimerUso(() => gestor?.recuperarFoco());
    // Busca versiones nuevas al abrir y cada 6 horas; avisa con una notificación de Windows.
    if (esPrincipal && !import.meta.env.DEV && ajustes().buscarActualizaciones) iniciarActualizaciones();
  }
}

// Sin foco un rato (o con la ventana oculta), WebView2 pasa a modo de memoria baja.
const ESPERA_MEMORIA_BAJA = 30_000;
let temporizadorMemoria = 0;
let memoriaBaja = false;

function definirMemoriaBaja(baja: boolean): void {
  clearTimeout(temporizadorMemoria);
  if (baja === memoriaBaja) return;
  memoriaBaja = baja;
  void invoke("definir_memoria_baja", { baja }).catch(() => undefined);
}

window.addEventListener("blur", () => {
  clearTimeout(temporizadorMemoria);
  temporizadorMemoria = window.setTimeout(() => definirMemoriaBaja(true), ESPERA_MEMORIA_BAJA);
});
window.addEventListener("focus", () => definirMemoriaBaja(false));
document.addEventListener("visibilitychange", () => definirMemoriaBaja(document.visibilityState === "hidden"));

void iniciar();
