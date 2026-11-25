import { invoke } from "@tauri-apps/api/core";
import { ajustes, type Logo } from "./ajustes";
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

// Cambia el logo de la barra de la app y el icono de las ventanas (barra de tareas y Alt+Tab).
export function aplicarLogo(): void {
  const logo = ajustes().logo;
  for (const imagen of document.querySelectorAll<HTMLImageElement>(".barra__logo")) imagen.src = rutaLogo(logo);
  if (logo === logoAplicado) return;
  logoAplicado = logo;
  invoke("aplicar_logo", { logo }).catch((error) => console.error("No se pudo cambiar el icono", error));
}
