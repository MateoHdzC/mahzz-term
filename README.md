<p align="center"><img src="public/logo.png" width="96" alt="MazzTerm"></p>

<h1 align="center">MazzTerm</h1>

<p align="center">Terminal para Windows con bloques de comandos, pensada para trabajar con agentes de IA.<br>Hecha con Tauri 2, Rust y xterm.js.</p>

## Qué tiene

- **Bloques de comandos**: cada comando queda agrupado con su salida, su duración y su código de error. Se pueden copiar, repetir o buscar.
- **Editor de comandos**: resaltado de sintaxis, varios cursores, autocompletado y una barra de contexto con la carpeta, la rama de git y el tipo de proyecto.
- **Pestañas y paneles**: divisiones horizontales y verticales, colores por pestaña, pestañas arriba o en una columna a un costado y la opción de arrastrar una pestaña a una ventana nueva.
- **Agentes activos**: un botón (✦, `Ctrl+Shift+A`) muestra los agentes que corren en la ventana (Claude Code, Codex, Gemini CLI, Aider…) y si están trabajando o esperando tu respuesta. Te avisa con una notificación cuando un agente termina mientras mirás otra cosa.
- **Revisión de cambios**: un panel (`Ctrl+Shift+G`) lista los archivos que cambiaron en el repositorio, con el diff de cada uno. Desde ahí podés aceptarlos (`git add`) o revertirlos.
- **Sesiones**: `mahzz --resume` te deja elegir una sesión anterior y vuelve a abrir sus pestañas, paneles y carpetas. Si había un Claude Code abierto, el panel queda con `claude --continue` listo para ejecutar.
- **Visor y editor de archivos**: un clic en un archivo lo abre al costado. Código con colores y guardado (`Ctrl+S`), Markdown renderizado, HTML con vista web, imágenes, video, audio, PDF, Excel y Word, sin salir de la terminal.
- **Archivos como en VS Code**: renombrar (F2), crear, mandar a la papelera (Supr), cortar, copiar y pegar, y arrastrar para mover.
- **Productividad**: historial con `Ctrl+R`, paleta de comandos (`Ctrl+Shift+P`), comandos guardados con parámetros y un árbol de archivos.
- **SSH con bloques**: los hosts de `~/.ssh/config` también tienen bloques dentro del servidor (bash).
- **Personalización**: temas editables, atajos, español e inglés y secretos cifrados con tu usuario de Windows.
- **Sincronización opcional**: si iniciás sesión con Google, los ajustes, temas, comandos guardados e historial se guardan en la carpeta privada de la app en tu Drive.

Más detalle en [docs/funciones.md](docs/funciones.md) y el historial de versiones en [CHANGELOG.md](CHANGELOG.md).

## El comando `mahzz`

Dentro de MazzTerm:

```powershell
mahzz --resume      # elegir una sesión anterior y abrir sus pestañas
mahzz --resume 2    # abrir directo la segunda sesión más reciente
mahzz --agentes     # ver los agentes que están corriendo
mahzz --cambios     # revisar los cambios del repositorio
```

## Requisitos

- Windows 10 u 11 con WebView2
- [PowerShell 7](https://github.com/PowerShell/PowerShell)
- [Rust](https://rustup.rs) estable, [Node.js](https://nodejs.org) 20 o superior y [pnpm](https://pnpm.io)

## Compilar

```powershell
pnpm install
pnpm tauri dev      # versión de desarrollo
pnpm tauri build    # instalador en src-tauri/target/release/bundle
```

## Datos

MazzTerm guarda los ajustes, el historial, las sesiones y la cuenta en `%LOCALAPPDATA%\com.mahzz.mahzzterm\datos`. Para usar otra carpeta (por ejemplo, una versión portable o pruebas), definí la variable `MAHZZTERM_DATOS`.

## Inicio de sesión con Google (opcional)

El repositorio no incluye credenciales. Para habilitar la sincronización:

1. En Google Cloud, creá un cliente OAuth de tipo **App de escritorio** y activá la API de Google Drive.
2. Descargá el JSON y guardalo como `src-tauri/credenciales/google.json`. Esa carpeta está en `.gitignore`.
3. Volvé a compilar. Sin ese archivo, la app funciona igual y solo oculta la sincronización.

> Si el cliente OAuth está en modo "Prueba", Google vence la sesión a los 7 días. Para que dure, publicá la app en la pantalla de consentimiento.

## Licencia

[MIT](LICENSE)
