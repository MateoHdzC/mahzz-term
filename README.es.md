<p align="center"><img src="public/logo.png" width="104" alt="MahzzTerm"></p>

<h1 align="center">MahzzTerm</h1>

<p align="center"><b>La terminal para Windows pensada para trabajar con agentes de IA.</b><br>
Bloques de comandos, panel de agentes, copiloto propio y visor de archivos, todo en una ventana.</p>

<p align="center">
  <a href="https://github.com/MateoHdzC/mahzz-term/releases/latest"><img src="https://img.shields.io/github/v/release/MateoHdzC/mahzz-term?label=versi%C3%B3n&color=8b45ff" alt="Última versión"></a>
  <a href="https://github.com/MateoHdzC/mahzz-term/releases"><img src="https://img.shields.io/github/downloads/MateoHdzC/mahzz-term/total?label=descargas&color=25b4c4" alt="Descargas"></a>
  <a href="https://github.com/MateoHdzC/mahzz-term/actions/workflows/ci.yml"><img src="https://github.com/MateoHdzC/mahzz-term/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078d4" alt="Windows 10 y 11">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/MateoHdzC/mahzz-term?label=licencia&color=17b885" alt="Licencia MIT"></a>
</p>

<p align="center">
  <a href="https://github.com/MateoHdzC/mahzz-term/releases/latest/download/MahzzTerm-setup.exe"><b>⬇️ Descargar para Windows</b></a> ·
  <a href="https://mahzzterm.xyz">🌐 mahzzterm.xyz</a> ·
  <a href="CHANGELOG.md">📝 Cambios</a> ·
  <a href="README.md">🗣️ Read in English</a>
</p>

---

## ✨ Lo principal

| Función | Qué hace |
|---|---|
| 🧱 **Bloques de comandos** | Cada comando queda agrupado con su salida, su duración y su código de error. Se pueden copiar, repetir o buscar. |
| ✦ **Panel de agentes** | Muestra los agentes que corren en la ventana (Claude Code, Codex, Gemini CLI, Aider…), si están trabajando o esperando tu respuesta, y te avisa cuando terminan. |
| 🤖 **Mahzz-AI** | Un copiloto flotante que ve el último comando (su salida y su error) para que le preguntes por qué falló sin copiar nada. Local con Ollama o con tu API key. |
| 🌳 **Tareas en paralelo** | Cada agente trabaja en su propio worktree de git, sin pisarse con los demás. Al terminar, unís o descartás con un clic. |
| 🔌 **Control por IA (MCP)** | Claude Code y otras IAs pueden leer los bloques y los logs, ejecutar comandos y manejar las pestañas de MahzzTerm. |
| 🎨 **A tu gusto** | Seis logos, colores que siguen al logo, temas editables, atajos y español o inglés. |

## 🧰 Todo lo que hace

<details open>
<summary><b>Terminal y editor</b></summary>

- **Bloques de comandos:** salida, duración y código de error de cada comando. Se copian, se repiten o se buscan.
- **Editor de comandos:** resaltado de sintaxis, varios cursores, autocompletado y una barra de contexto con la carpeta, la rama de git y el tipo de proyecto.
- **Pestañas y paneles:** divisiones horizontales y verticales, pestañas arriba o en una columna a un costado, duplicar una pestaña y arrastrarla a otra ventana sin perderla. El color de la pestaña tiñe toda la ventana.
- **Logs buscables:** los comandos y salidas de cualquier pestaña de los últimos 30 días. Al reabrir, cada panel vuelve con sus bloques.
- **Productividad:** historial (`Ctrl+R`), paleta de comandos, comandos guardados con parámetros y un árbol de archivos.
- **SSH con bloques:** los hosts de `~/.ssh/config` también tienen bloques dentro del servidor (bash).

</details>

<details open>
<summary><b>Agentes de IA</b></summary>

- **Panel de agentes (✦):** quién está trabajando, quién espera tu respuesta y una notificación de Windows cuando un agente termina mientras mirás otra cosa. También detecta los agentes instalados con npm (corren como `node`).
- **`Shift+Enter`** es un salto de línea dentro de Claude Code, Codex y otros programas interactivos.
- **Tareas en paralelo:** cada agente tiene su propio worktree de git (rama `mahzz/…`). Lo unís a tu rama o lo descartás con un clic.
- **Revisión de cambios (`Ctrl+Shift+G`):** los archivos que cambiaron en el repositorio, con su diff. Desde ahí los aceptás (`git add`) o los revertís.
- **Sesiones:** `mahzz --resume` vuelve a abrir las pestañas, paneles y carpetas de una sesión anterior. Si había un Claude Code abierto, el panel queda con `claude --continue` listo para ejecutar.
- **Control por IA (MCP):** un servidor MCP propio para que una IA use la terminal como vos.

</details>

<details open>
<summary><b>Archivos</b></summary>

- **Visor y editor:** un clic en un archivo lo abre al costado. Código con colores y guardado (`Ctrl+S`), Markdown renderizado, HTML con vista web, imágenes, video, audio, PDF, Excel y Word.
- **Archivos como en VS Code:** renombrar (F2), crear, mandar a la papelera (Supr), cortar, copiar, pegar y arrastrar para mover.
- **Integración con Windows (a pedido):** «Abrir en MahzzTerm» en el clic derecho de carpetas y discos, y MahzzTerm en «Abrir con» para tus archivos.

</details>

<details open>
<summary><b>Personalización y sincronización</b></summary>

- **Logos:** elegí uno de seis en Ajustes → Apariencia. Cambia en la app, la barra de tareas (también anclada), Alt+Tab y los accesos directos de MahzzTerm.
- **Colores que siguen al logo:** con el tema MahzzTerm, los botones, bordes y resaltados toman el color del logo.
- **Temas y atajos:** temas editables, atajos configurables y español o inglés.
- **Secretos cifrados:** se guardan cifrados con tu usuario de Windows.
- **Sincronización opcional:** si iniciás sesión con Google, los ajustes, temas, comandos guardados e historial se guardan en la carpeta privada de la app en tu Drive.

</details>

### 🎨 Logos

| Clásico | Azul | Océano | Esmeralda | Hielo | Aurora |
|:---:|:---:|:---:|:---:|:---:|:---:|
| <img src="public/logo.png" width="56" alt="Clásico"> | <img src="public/logos/azul.png" width="56" alt="Azul"> | <img src="public/logos/oceano.png" width="56" alt="Océano"> | <img src="public/logos/esmeralda.png" width="56" alt="Esmeralda"> | <img src="public/logos/hielo.png" width="56" alt="Hielo"> | <img src="public/logos/aurora.png" width="56" alt="Aurora"> |

Más detalle en [docs/funciones.md](docs/funciones.md).

## 🚀 Instalar

1. Bajá **[MahzzTerm-setup.exe](https://github.com/MateoHdzC/mahzz-term/releases/latest/download/MahzzTerm-setup.exe)** del último release.
2. Abrilo. No pide permisos de administrador.
3. Listo. MahzzTerm se actualiza sola: al abrirse y cada 6 horas se fija si hay una versión nueva y te avisa con una notificación.

> [!NOTE]
> Los instaladores todavía no tienen firma de código (ver [Code signing policy](#code-signing-policy)), así que Windows puede mostrar el aviso «Windows protegió tu PC». Tocá **Más información → Ejecutar de todas formas**.

**Requisitos:** Windows 10 u 11 con WebView2 y [PowerShell 7](https://github.com/PowerShell/PowerShell). [Ollama](https://ollama.com), solo si querés Mahzz-AI con el modelo local.

## ⌨️ Atajos de teclado

| Acción | Atajo | | Acción | Atajo |
|---|---|---|---|---|
| Nueva pestaña | `Ctrl+Shift+T` | | Panel de agentes | `Ctrl+Shift+A` |
| Duplicar pestaña | `Ctrl+Shift+U` | | Mahzz-AI | `Ctrl+Shift+M` |
| Nueva ventana | `Ctrl+Shift+N` | | Revisar cambios | `Ctrl+Shift+G` |
| Dividir a la derecha / abajo | `Ctrl+Shift+D` / `E` | | Buscar en todos los logs | `Ctrl+Shift+F` |
| Cerrar panel | `Ctrl+Shift+W` | | Buscar en los bloques | `Ctrl+F` |
| Ir a la pestaña 1–9 | `Ctrl+1` … `Ctrl+9` | | Historial de comandos | `Ctrl+R` |
| Moverse entre paneles | `Ctrl+Alt+Flechas` | | Paleta de comandos | `Ctrl+Shift+P` |
| Bloque anterior / siguiente | `Ctrl+↑` / `Ctrl+↓` | | Archivos | `Ctrl+Shift+B` |
| Guardar comando | `Ctrl+Shift+S` | | Ajustes | `Ctrl+,` |

Todos se pueden cambiar en Ajustes → Atajos.

## 💻 El comando `mahzz`

Dentro de MahzzTerm:

```powershell
mahzz --resume      # elegir una sesión anterior y abrir sus pestañas
mahzz --resume 2    # abrir directo la segunda sesión más reciente
mahzz --agentes     # ver los agentes que están corriendo
mahzz --cambios     # revisar los cambios del repositorio
```

## 🤖 Mahzz-AI

Se abre con `Ctrl+Shift+M` o con su botón en la barra. Si falta el modelo, MahzzTerm ofrece instalarlo (y Ollama, si hace falta). También se puede bajar a mano:

```powershell
ollama pull dkdidmateo/mahzz
```

Para usar otro servicio, en los ajustes del panel cargá una API compatible con OpenAI (OpenAI, OpenRouter, Groq, DeepSeek, LM Studio…). La key se guarda cifrada con tu usuario de Windows y nunca vuelve a la interfaz.

## 🔌 Control por IA (MCP)

MahzzTerm trae un servidor MCP para que una IA use la terminal como vos: ver las pestañas, leer los bloques y los logs, ejecutar comandos, mandar teclas a programas interactivos y manejar pestañas y paneles. Para conectarlo con Claude Code:

```powershell
claude mcp add --scope user mahzzterm -- "C:\ruta\a\MahzzTerm.exe" --mcp
```

En Ajustes → General, el botón **Conectar con Claude Code** copia ese comando con la ruta correcta, y el interruptor **Control por IA** lo apaga cuando quieras. Más detalle en [docs/funciones.md](docs/funciones.md#control-por-ia-mcp).

## 🛠️ Desarrollo

<details>
<summary><b>Compilar desde el código</b></summary>

Necesitás [Rust](https://rustup.rs) (estable), [Node.js](https://nodejs.org) 20 o superior y [pnpm](https://pnpm.io).

```powershell
pnpm install
pnpm tauri dev      # versión de desarrollo
pnpm tauri build    # instalador en src-tauri/target/release/bundle
```

Antes de pushear, los mismos chequeos que corre el CI:

```powershell
cd src-tauri; cargo fmt --check; cargo clippy --all-targets -- -D warnings; cargo test
```

Cada push y pull request corre el [CI](.github/workflows/ci.yml): formato, clippy (las advertencias cuentan como error) y tests de Rust en Windows, y revisión de tipos más el build del frontend.

</details>

<details>
<summary><b>Publicar una versión</b></summary>

```powershell
.\scripts\publicar.ps1             # compila y deja los archivos en src-tauri/target/release/publicar
.\scripts\publicar.ps1 -Publicar   # además crea el release vX.Y.Z en GitHub
```

Arma el instalador firmado y el `latest.json` que usan las actualizaciones automáticas. Necesita la clave privada de firma en `~\.tauri\mahzzterm.key`, que nunca va al repositorio. Las notas del release salen de la sección de esa versión en `CHANGELOG.md`.

</details>

<details>
<summary><b>Logos</b></summary>

Los logos de `public/logos` son PNG de 256 px generados desde las imágenes originales con:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\logos.ps1 -Origen C:\carpeta\con\opc1..opc5
```

Saca los fondos negros sólidos, borra las manchitas sueltas y centra cada logo en un cuadrado.

</details>

<details>
<summary><b>Carpeta de datos</b></summary>

MahzzTerm guarda los ajustes, el historial, las sesiones y la cuenta en `%LOCALAPPDATA%\com.mahzz.mahzzterm\datos`. Para usar otra carpeta (una versión portable o pruebas), definí la variable `MAHZZTERM_DATOS`.

</details>

<details>
<summary><b>Inicio de sesión con Google (opcional)</b></summary>

La app **no lleva ningún secret de Google**. El login pasa por un backend chico en la VPS ([`servidor/`](servidor/README.md)), que es el único que conoce el client secret:

1. La app abre el navegador en `mahzzterm.xyz/api/auth/google`.
2. El backend manda al usuario a Google y canjea el código con el secret.
3. La app recibe en `127.0.0.1` un código de un solo uso y lo cambia por la sesión (con PKCE).

Para probar con un backend local: `$env:MAHZZTERM_SERVIDOR = "http://127.0.0.1:8080"`.

> Si el cliente OAuth está en modo «Prueba», Google vence la sesión a los 7 días. Para que dure, publicá la app en la pantalla de consentimiento.

</details>

## 🗺️ Roadmap

| Versión | Tema | Estado |
|---|---|---|
| 0.7 | Logos, colores del logo y agentes de npm | ✅ Publicada |
| 0.8 | Agentes | 🔨 En curso |
| 0.9 | A tu manera | ⏳ Próxima |
| 1.0 | Lista para todos | ⏳ Próxima |

El roadmap completo está en [mahzzterm.xyz/es/roadmap](https://mahzzterm.xyz/es/roadmap/).

## Code signing policy

Los instaladores se compilan en GitHub Actions desde este repositorio ([`.github/workflows/release.yml`](.github/workflows/release.yml)) y cada firma se aprueba a mano.

La firma de código gratuita de [SignPath Foundation](https://signpath.org) está en trámite. Mientras tanto, los instaladores no tienen firma Authenticode y Windows puede mostrar un aviso al descargarlos.

**Equipo**
- Autores y revisores (committers and reviewers): [MateoHdzC](https://github.com/MateoHdzC)
- Aprobadores (approvers): [MateoHdzC](https://github.com/MateoHdzC)

## 🔒 Privacidad

MahzzTerm no manda información a otros sistemas salvo en estos casos, y solo los que pidas o actives:

| Qué | Cuándo | Qué manda |
|---|---|---|
| **Actualizaciones** | Al abrirse y cada 6 horas | Solo consulta `latest.json` en los releases de GitHub. No manda datos tuyos. Se apaga en Ajustes → General → **Buscar actualizaciones sola**. |
| **Sincronización con Google** | Solo si iniciás sesión | Tus ajustes, a la carpeta privada de la app en tu Drive. |
| **Mahzz-AI** | Cuando le preguntás algo | Con el modelo local habla con Ollama en `127.0.0.1`. Con una API key, tu pregunta va al servicio que elijas. |
| **Control por IA (MCP)** | Si está prendido | Escucha solo en `127.0.0.1` y pide una clave local. |

## 📄 Licencia

[MIT](LICENSE) © [MateoHdzC](https://github.com/MateoHdzC)
