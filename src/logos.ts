import { invoke } from "@tauri-apps/api/core";
import { ajustes, type Logo } from "./ajustes";
import { confirmar } from "./dialogos";
import { t } from "./i18n";

export function nombreLogo(logo: Logo): string {
  const nombres: Record<Logo, string> = {
    clasico: t("Clásico"),
    azul: t("Azul"),
    oceano: t("Océano"),
    esmeralda: t("Esmeralda"),
    hielo: t("Hielo"),
    aurora: t("Aurora"),
  };
  return nombres[logo];
}

export function rutaLogo(logo: Logo): string {
  return logo === "clasico" ? "/logo.png" : `/logos/${logo}.png`;
}

// El último logo pedido a Windows: así no se vuelve a pedir en cada cambio de ajustes.
let logoAplicado: Logo | null = null;

// Cambia el logo de la barra de la app, el icono de las ventanas (Alt+Tab y la barra de tareas)
// y el de los accesos directos de MahzzTerm.
export function aplicarLogo(): void {
  const logo = ajustes().logo;
  for (const imagen of document.querySelectorAll<HTMLImageElement>(".barra__logo")) imagen.src = rutaLogo(logo);
  if (logo === logoAplicado) return;
  logoAplicado = logo;
  invoke<boolean>("aplicar_logo", { logo })
    .then((cambioAnclado) => {
      if (cambioAnclado) void ofrecerReiniciarExplorador();
    })
    .catch((error) => console.error("No se pudo cambiar el icono", error));
}

// Con MahzzTerm anclada, Windows dibuja el botón de la barra de tareas con el icono del acceso
// anclado y lo guarda en caché: solo lo vuelve a leer al reiniciar el Explorador.
async function ofrecerReiniciarExplorador(): Promise<void> {
  const aceptado = await confirmar(
    t("¿Actualizar el icono anclado?"),
    t(
      "MahzzTerm está anclada a la barra de tareas y Windows muestra el logo nuevo ahí recién cuando se reinicia el Explorador. La barra de tareas desaparece un segundo y vuelve; tus ventanas siguen abiertas.",
    ),
    t("Reiniciar el Explorador"),
  );
  if (aceptado) await invoke("reiniciar_explorador").catch((error) => console.error("No se pudo reiniciar el Explorador", error));
}
