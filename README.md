<p align="center"><img src="public/logo.png" width="96" alt="MahzzTerm"></p>

<h1 align="center">MahzzTerm</h1>

<p align="center">Terminal para Windows con bloques de comandos, pensada para trabajar con agentes de IA.<br>Hecha con Tauri 2, Rust y xterm.js.</p>

<p align="center"><a href="https://mahzzterm.xyz">mahzzterm.xyz</a> · <a href="https://github.com/MateoHdzC/mahzz-term/releases/latest">Descargar</a></p>

## Qué tiene

- **Bloques de comandos**: cada comando queda agrupado con su salida, su duración y su código de error. Se pueden copiar, repetir o buscar.
- **Editor de comandos**: resaltado de sintaxis, varios cursores, autocompletado y una barra de contexto con la carpeta, la rama de git y el tipo de proyecto.
- **Pestañas y paneles**: divisiones horizontales y verticales, pestañas arriba o en una columna a un costado, duplicar una pestaña (`Ctrl+Shift+U`) y arrastrarla a otra ventana sin perderla. El color de la pestaña tiñe la ventana: el árbol de archivos, la carpeta y la rama de cada bloque y los resaltados.
- **Agentes activos**: un botón (✦, `Ctrl+Shift+A`) muestra los agentes que corren en la ventana (Claude Code, Codex, Gemini CLI, Aider…) y si están trabajando o esperando tu respuesta. Te avisa con una notificación cuando un agente termina mientras mirás otra cosa. Dentro de esos programas, `Shift+Enter` es un salto de línea.
- **Mahzz-AI, el copiloto** (`Ctrl+Shift+M`): una ventanita flotante, o anclada al costado, para preguntarle a una IA sobre el último comando (su salida y su error) sin copiar nada. Corre en tu PC con Ollama y su modelo propio, que MahzzTerm instala solo, o con tu API key de cualquier servicio compatible con OpenAI.
- **Revisión de cambios**: un panel (`Ctrl+Shift+G`) lista los archivos que cambiaron en el repositorio, con el diff de cada uno. Desde ahí podés aceptarlos (`git add`) o revertirlos.
- **Sesiones**: `mahzz --resume` te deja elegir una sesión anterior y vuelve a abrir sus pestañas, paneles y carpetas. Si había un Claude Code abierto, el panel queda con `claude --continue` listo para ejecutar.
- **Visor y editor de archivos**: un clic en un archivo lo abre al costado. Código con colores y guardado (`Ctrl+S`), Markdown renderizado, HTML con vista web, imágenes, video, audio, PDF, Excel y Word, sin salir de la terminal.
- **Archivos como en VS Code**: renombrar (F2), crear, mandar a la papelera (Supr), cortar, copiar y pegar, y arrastrar para mover.
- **Tareas en paralelo**: cada agente trabaja en su propio worktree de git (rama `mahzz/…`), sin pisarse con los demás. Al terminar, unís o descartás con un clic.
- **Todos los logs, buscables** (`Ctrl+Shift+F`): los comandos y salidas de cualquier pestaña de los últimos 30 días. Al reabrir, cada panel vuelve con sus bloques.
- **Control por IA (MCP)**: Claude Code y otras IAs pueden leer los bloques y los logs, ejecutar comandos y manejar las pestañas de MahzzTerm.
- **Integración con Windows** (a pedido): «Abrir en MahzzTerm» en el clic derecho de carpetas y discos, y MahzzTerm en «Abrir con» para tus archivos, que se abren en el visor. Se pregunta una vez y se prende o apaga en Ajustes → General.
- **Productividad**: historial con `Ctrl+R`, paleta de comandos (`Ctrl+Shift+P`), comandos guardados con parámetros y un árbol de archivos.
- **SSH con bloques**: los hosts de `~/.ssh/config` también tienen bloques dentro del servidor (bash).
- **Personalización**: temas editables, atajos, español e inglés y secretos cifrados con tu usuario de Windows.
- **Sincronización opcional**: si iniciás sesión con Google, los ajustes, temas, comandos guardados e historial se guardan en la carpeta privada de la app en tu Drive.

Más detalle en [docs/funciones.md](docs/funciones.md) y el historial de versiones en [CHANGELOG.md](CHANGELOG.md).

## El comando `mahzz`

Dentro de MahzzTerm:

```powershell
mahzz --resume      # elegir una sesión anterior y abrir sus pestañas
mahzz --resume 2    # abrir directo la segunda sesión más reciente
mahzz --agentes     # ver los agentes que están corriendo
mahzz --cambios     # revisar los cambios del repositorio
```

## Control por IA (MCP)

MahzzTerm trae un servidor MCP para que una IA use la terminal como vos: ver las pestañas, leer los bloques y los logs, ejecutar comandos, mandar teclas a programas interactivos y manejar pestañas y paneles. Para conectarlo con Claude Code:

```powershell
claude mcp add --scope user mahzzterm -- "C:\ruta\a\MahzzTerm.exe" --mcp
```

En Ajustes → General, el botón **Conectar con Claude Code** copia ese comando con la ruta correcta, y el interruptor **Control por IA** lo apaga cuando quieras. Más detalle en [docs/funciones.md](docs/funciones.md#control-por-ia-mcp).

## Mahzz-AI

Con `Ctrl+Shift+M` o su botón en la barra. Si falta el modelo, MahzzTerm ofrece instalarlo (y Ollama, si no está). También se puede bajar a mano:

```powershell
ollama pull dkdidmateo/mahzz
```

Para usar otro servicio, en los ajustes del panel cargá una API compatible con OpenAI (OpenAI, OpenRouter, Groq, DeepSeek, LM Studio…). La key se guarda cifrada con tu usuario de Windows.

## Instalar

Bajá `MahzzTerm-setup.exe` del [último release](https://github.com/MateoHdzC/mahzz-term/releases/latest) y abrilo. No pide permisos de administrador. Después MahzzTerm se actualiza sola: al abrirse y cada 6 horas se fija si hay una versión nueva y te avisa con una notificación.

## Requisitos

Para usarla:
- Windows 10 u 11 con WebView2
- [PowerShell 7](https://github.com/PowerShell/PowerShell)
- [Ollama](https://ollama.com), solo si querés Mahzz-AI con el modelo local

Para compilarla, además:
- [Rust](https://rustup.rs) estable, [Node.js](https://nodejs.org) 20 o superior y [pnpm](https://pnpm.io)

## Compilar

```powershell
pnpm install
pnpm tauri dev      # versión de desarrollo
pnpm tauri build    # instalador en src-tauri/target/release/bundle
```

Para publicar una versión (instalador firmado, `latest.json` para las actualizaciones y release en GitHub):

```powershell
.\scripts\publicar.ps1             # compila y deja los archivos en src-tauri/target/release/publicar
.\scripts\publicar.ps1 -Publicar   # además crea el release vX.Y.Z
```

Necesita la clave privada de firma en `~\.tauri\mahzzterm.key`, que nunca va al repositorio.

## Datos

MahzzTerm guarda los ajustes, el historial, las sesiones y la cuenta en `%LOCALAPPDATA%\com.mahzz.mahzzterm\datos`. Para usar otra carpeta (por ejemplo, una versión portable o pruebas), definí la variable `MAHZZTERM_DATOS`.

## Inicio de sesión con Google (opcional)

El repositorio no incluye credenciales. Para habilitar la sincronización:

1. En Google Cloud, creá un cliente OAuth de tipo **App de escritorio** y activá la API de Google Drive.
2. Descargá el JSON y guardalo como `src-tauri/credenciales/google.json`. Esa carpeta está en `.gitignore`.
3. Volvé a compilar. Sin ese archivo, la app funciona igual y solo oculta la sincronización.

> Si el cliente OAuth está en modo "Prueba", Google vence la sesión a los 7 días. Para que dure, publicá la app en la pantalla de consentimiento.

## Code signing policy

Los instaladores se compilan en GitHub Actions desde este repositorio ([`.github/workflows/release.yml`](.github/workflows/release.yml)) y cada firma se aprueba a mano.

La firma de código gratuita de [SignPath Foundation](https://signpath.org) está en trámite. Mientras tanto, los instaladores no tienen firma Authenticode y Windows puede mostrar un aviso al descargarlos.

**Equipo**
- Autores y revisores (committers and reviewers): [MateoHdzC](https://github.com/MateoHdzC)
- Aprobadores (approvers): [MateoHdzC](https://github.com/MateoHdzC)

**Privacidad.** MahzzTerm no manda información a otros sistemas salvo en estos casos, y solo los que pidas o actives:
- **Actualizaciones:** al abrirse y cada 6 horas consulta `latest.json` en los releases de GitHub. No manda datos tuyos y se apaga en Ajustes → General → **Buscar actualizaciones sola**.
- **Sincronización con Google:** solo si iniciás sesión. Guarda tus ajustes en la carpeta privada de la app en tu Drive.
- **Mahzz-AI:** con el modelo local habla con Ollama en `127.0.0.1`. Si configurás una API key, lo que le preguntes va al servicio que elijas.
- **Control por IA (MCP):** escucha solo en `127.0.0.1` y pide una clave local.

## Licencia

[MIT](LICENSE)
