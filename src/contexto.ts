import { t } from "./i18n";
import { invoke } from "@tauri-apps/api/core";

export interface DatosGit {
  cambios: number;
  adelante: number;
  atras: number;
}

export interface DatosProyecto {
  tipo: string;
  version: string | null;
}

const PROYECTOS: Record<string, { sigla: string; nombre: string; color: string }> = {
  node: { sigla: "JS", nombre: "Node", color: "#6fdc9c" },
  python: { sigla: "Py", nombre: "Python", color: "#f4c96b" },
  rust: { sigla: "Rs", nombre: "Rust", color: "#ff9e64" },
  go: { sigla: "Go", nombre: "Go", color: "#62d6e8" },
  dotnet: { sigla: ".N", nombre: ".NET", color: "#b98aff" },
  java: { sigla: "Jv", nombre: "Java", color: "#ff8fa0" },
  unreal: { sigla: "UE", nombre: "Unreal", color: "#d5d3de" },
  lua: { sigla: "Lu", nombre: "Lua", color: "#74a7ff" },
  web: { sigla: "<>", nombre: "Web", color: "#ff9e64" },
};

let carpetaUsuario: Promise<string | null> | null = null;

function obtenerCarpetaUsuario(): Promise<string | null> {
  carpetaUsuario ??= invoke<string | null>("carpeta_usuario");
  return carpetaUsuario;
}

function acortarRuta(ruta: string, casa: string | null): string {
  if (ruta.startsWith("/")) {
    const remota = ruta.replace(/^\/(home\/[^/]+|root)(?=\/|$)/, "~");
    const tramos = remota.split("/").filter(Boolean);
    return tramos.length <= 4 ? remota : `…/${tramos.slice(-3).join("/")}`;
  }
  const relativa =
    casa && ruta.toLowerCase().startsWith(casa.toLowerCase()) ? `~${ruta.slice(casa.length)}` : ruta;
  const partes = relativa.split("\\").filter(Boolean);
  if (partes.length <= 4) return relativa;
  return `${partes[0]}\\…\\${partes.slice(-2).join("\\")}`;
}

export class BarraContexto {
  readonly elemento = document.createElement("div");
  private readonly botonCarpeta = document.createElement("button");
  private readonly proyecto = document.createElement("span");
  private readonly rama = document.createElement("span");
  private readonly ssh = document.createElement("span");

  constructor(alElegirCarpeta: () => void) {
    this.elemento.className = "contexto";

    this.botonCarpeta.type = "button";
    this.botonCarpeta.className = "contexto__carpeta";
    this.botonCarpeta.addEventListener("click", alElegirCarpeta);

    this.proyecto.className = "contexto__proyecto";
    this.proyecto.hidden = true;
    this.rama.className = "contexto__rama";
    this.rama.hidden = true;

    this.ssh.className = "contexto__ssh";
    this.ssh.hidden = true;

    this.elemento.append(this.ssh, this.proyecto, this.botonCarpeta, this.rama);
  }

  definirSsh(host: string | null): void {
    this.ssh.hidden = !host;
    this.ssh.textContent = host ? `SSH ${host}` : "";
    this.ssh.title = host ? t("Conectado a {0}", host) : "";
    this.botonCarpeta.disabled = Boolean(host);
  }

  async definirCarpeta(carpeta: string | null): Promise<void> {
    const texto = carpeta ? acortarRuta(carpeta, await obtenerCarpetaUsuario()) : "";
    this.botonCarpeta.textContent = texto;
    this.botonCarpeta.title = carpeta ? `${carpeta}\n${t("Clic para cambiar de carpeta")}` : "";
    this.botonCarpeta.setAttribute("aria-label", carpeta ? t("Carpeta actual: {0}. Cambiar de carpeta", carpeta) : t("Cambiar de carpeta"));
  }

  definirProyecto(datos: DatosProyecto | null): void {
    const info = datos ? PROYECTOS[datos.tipo] : undefined;
    this.proyecto.hidden = !info;
    if (!datos || !info) return;

    const sigla = document.createElement("span");
    sigla.className = "contexto__sigla";
    sigla.style.setProperty("--color-proyecto", info.color);
    sigla.textContent = info.sigla;
    const texto = document.createElement("span");
    texto.textContent = datos.version ?? info.nombre;
    this.proyecto.title = datos.version ? `${info.nombre} ${datos.version}` : info.nombre;
    this.proyecto.replaceChildren(sigla, texto);
  }

  definirGit(rama: string | null, datos: DatosGit | null): void {
    this.rama.hidden = !rama;
    if (!rama) return;

    const partes = [rama];
    if (datos?.adelante) partes.push(`↑${datos.adelante}`);
    if (datos?.atras) partes.push(`↓${datos.atras}`);
    if (datos?.cambios) partes.push(`±${datos.cambios}`);
    this.rama.textContent = partes.join(" ");
    this.rama.classList.toggle("contexto__rama--cambios", Boolean(datos?.cambios));
    this.rama.title = datos?.cambios ? t("{0} archivos con cambios", datos.cambios) : t("Sin cambios pendientes");
  }
}
