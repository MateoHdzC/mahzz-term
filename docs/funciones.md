# Cómo funcionan las mejoras de la 0.2

Esta guía explica qué hace cada función nueva, cómo usarla y dónde está el código, por si querés cambiarla.

## Panel de agentes activos

**Para qué sirve:** cuando tenés varios Claude Code (u otros agentes) en distintas pestañas, te muestra cuál está trabajando y cuál te está esperando, sin tener que revisar pestaña por pestaña.

**Cómo se usa**
- El botón ✦ de la barra, `Ctrl+Shift+A` o `mahzz --agentes`.
- El número sobre el botón es la cantidad de agentes. Se pone ámbar y late cuando alguno terminó y no lo viste.
- Al hacer clic en una fila, te lleva a su pestaña y a su panel.
- "Claude Code en pestaña nueva" abre una pestaña en la misma carpeta y ejecuta `claude`.

**Cómo decide el estado**

| Estado | Regla |
|---|---|
| Trabajando | El programa escribió algo en los últimos 3 segundos. Lo que llega justo después de que tecleás (400 ms) no cuenta, porque es el eco de lo que escribiste. |
| Esperando | Pasaron más de 3 segundos sin salida. |
| Te necesita | El programa tocó la campana de la terminal (BEL). Claude Code lo hace si en su configuración tiene la notificación por campana. |

Si un agente trabajó 10 segundos o más y pasa a esperar mientras estás en otra pestaña o en otra ventana, MahzzTerm manda una notificación de Windows (si "Avisar cuando termina un comando largo" está activado en Ajustes) y pone ámbar el punto de esa pestaña. Mientras trabaja, el punto late.

**Qué cuenta como agente:** el nombre del programa que corre dentro del shell. La lista está en `AGENTES`, en [`src/agentes.ts`](../src/agentes.ts): claude, codex, gemini, aider, opencode, cursor-agent, copilot, goose, crush, qwen, amp y ollama. Un agente instalado con npm corre como `node` y no se detecta. Claude Code con el instalador nativo (`claude.exe`) sí.

**Código:** [`src/agentes.ts`](../src/agentes.ts) (panel y estados) y [`src/panel.ts`](../src/panel.ts) (`ultimaSalida`, `pideAtencion`, `programaDesde`).

## Revisión de cambios

**Para qué sirve:** ver qué tocó un agente (o vos) en el repositorio y decidir archivo por archivo, sin salir de la terminal.

**Cómo se usa**
- El botón de ramas de la barra, `Ctrl+Shift+G` o `mahzz --cambios`.
- Toma el repositorio de la carpeta del panel activo. Si no es un repo de git, lo avisa.
- Clic en un archivo: muestra u oculta su diff, con número de línea viejo y nuevo.
- ✓ **Aceptar**: hace `git add` del archivo, y queda marcado con ✓. **Aceptar todo** hace lo mismo con todos.
- ↺ **Revertir**: lo deja como en el último commit. Si el archivo es nuevo, lo borra del disco. Siempre pide confirmación, porque no se puede deshacer.
- El panel se agranda arrastrando su borde izquierdo.

| Letra | Significa |
|---|---|
| M | Modificado |
| N | Nuevo |
| B | Borrado |
| R | Renombrado |
| ✓ | Aceptado (ya está en el índice de git, sin cambios encima) |

**Límites:** se muestran hasta 1000 archivos y 4000 líneas por diff. Los archivos nuevos de más de 512 KB y los binarios no muestran contenido.

**Seguridad:** las rutas se pasan a git como `:(literal)ruta`, para que no se interpreten comodines, y se rechaza cualquier ruta que salga del repositorio.

**Código:** [`src/cambios.ts`](../src/cambios.ts) (interfaz) y [`src-tauri/src/cambios.rs`](../src-tauri/src/cambios.rs) (comandos de git).

## Sesiones y `mahzz --resume`

**Para qué sirve:** volver a una forma de trabajo de otro día, con sus pestañas, divisiones y carpetas, aunque desde entonces hayas abierto otras cosas.

**Cómo se usa**

```powershell
mahzz --resume      # selector con las sesiones anteriores
mahzz --resume 2    # abre directo la segunda más reciente
```

En el selector, Enter abre la sesión elegida y Supr la borra de la lista. Las pestañas se agregan a la ventana actual. También está en la paleta como "Reanudar una sesión anterior".

**Qué se guarda:** cada ventana principal es una sesión. Se guardan las pestañas, las divisiones con su proporción, la carpeta de cada panel, los colores, los nombres y qué programa corría. No se guarda la salida de la terminal. Se conservan las 30 más recientes. Dos sesiones con las mismas pestañas y carpetas se muestran una sola vez.

**Claude Code:** si un panel tenía `claude` corriendo, al reabrirlo queda escrito `claude --continue` en el editor. No se ejecuta solo: lo confirmás con Enter.

**Cómo funciona `mahzz`:** es una función de PowerShell que MahzzTerm carga en cada sesión ([`integracion.ps1`](../src-tauri/src/integracion.ps1)). No abre nada por su cuenta: escribe una marca invisible (`OSC 133;X`) que la interfaz lee y convierte en la acción.

**Código:** [`src/sesiones.ts`](../src/sesiones.ts), [`src-tauri/src/sesiones.rs`](../src-tauri/src/sesiones.rs) y `reanudarSesion` en [`src/gestor.ts`](../src/gestor.ts).

## Tareas en paralelo (worktrees)

**Para qué sirve:** darle una tarea a cada agente sin que se pisen. Cada tarea es una copia de trabajo de git aparte (un *worktree*) con su propia rama, así dos Claude pueden tocar los mismos archivos sin chocar.

**Cómo se usa**
- En el panel de agentes (✦), **Nueva tarea en paralelo (worktree)**. También está en la paleta.
- Ponés el nombre, que pasa a ser la rama `mahzz/<nombre>`, lo que tiene que hacer el agente y el comando del agente (`claude` por defecto).
- MahzzTerm crea la carpeta `<repo>-agentes\<nombre>` al lado de tu repositorio, abre una pestaña ahí (🤖, en cian) y arranca al agente con las instrucciones.
- En el mismo panel, la sección **Tareas en paralelo** lista cada tarea con sus cambios sin guardar y sus commits:
  - **Clic en la tarea**: va a su pestaña, o abre una nueva si la cerraste. Con la revisión de cambios (`Ctrl+Shift+G`) ves el diff de lo que hizo.
  - **Unir**: guarda en un commit lo que dejó el agente, lo une a la rama actual de tu repositorio y borra la carpeta de la tarea. Si hay conflictos, no cambia nada y te avisa.
  - **Descartar**: borra la carpeta y la rama con todo lo que hizo el agente.
- Antes de unir o descartar, se cierran las pestañas abiertas en esa carpeta, porque Windows no deja borrar una carpeta que un PowerShell tiene abierta.

**Requisito:** que la carpeta sea un repositorio de git con al menos un commit.

**Código:** [`src-tauri/src/tareas.rs`](../src-tauri/src/tareas.rs) (git) y [`src/tareas.ts`](../src/tareas.ts).

## Logs y búsqueda global

**Para qué sirve:** encontrar ese error que viste ayer en otra pestaña, o revisar qué salió de un comando aunque hayas cerrado la terminal.

- Cada bloque terminado se guarda en `datos\logs\AAAA-MM-DD.jsonl`, con comando, carpeta, código de salida, duración y salida (hasta 200 KB por bloque). Se guardan 30 días.
- **`Ctrl+Shift+F`** abre el buscador: busca en los comandos y en las salidas de todas las pestañas, con filtro de **solo errores**. Un clic muestra la salida completa, para copiarla o volver a usar el comando.
- Los comandos que parecen tener una contraseña o una clave no se guardan, igual que en el historial.
- **Al reabrir** una sesión (al abrir la app o con `mahzz --resume`), cada panel vuelve con sus últimos 30 bloques.

**Código:** [`src-tauri/src/registros.rs`](../src-tauri/src/registros.rs) y [`src/registros.ts`](../src/registros.ts).

## Actualizaciones automáticas

- MahzzTerm se instala con `MahzzTerm-setup.exe` y no pide permisos de administrador.
- Al abrirse, consulta `latest.json` en el último release de GitHub. Si hay una versión nueva, pregunta si querés instalarla; si aceptás, se descarga, se instala y la app se reinicia. También se puede buscar desde Ajustes → General → **Buscar ahora**.
- Cada actualización viene **firmada**: la app trae la clave pública y rechaza cualquier instalador que no esté firmado con la clave privada del proyecto.
- Para publicar una versión: `.\scripts\publicar.ps1 -Publicar` (ver el README).

**Código:** [`src/actualizaciones.ts`](../src/actualizaciones.ts) y [`scripts/publicar.ps1`](../scripts/publicar.ps1).

## Integración con Windows

- **Abrir en MahzzTerm**: aparece en el clic derecho de una carpeta, del fondo de una carpeta y de un disco, y abre una pestaña en esa carpeta. En Windows 11 está en «Mostrar más opciones».
- **Abrir con**: MahzzTerm aparece como recomendado para Markdown, texto y código (`.md`, `.json`, `.ps1`, `.py`, `.ts`…) y como opción para cualquier otro archivo. El archivo se abre en el visor y la pestaña nueva, si hace falta, arranca en su carpeta.
- **Una sola ventana**: si MahzzTerm ya está abierta, la copia que abre el Explorador le pasa la carpeta o el archivo por el mismo canal local del MCP (`127.0.0.1` con clave) y se cierra. La ventana vuelve al frente aunque esté minimizada.
- **No roba nada**: no cambia el programa por defecto de ninguna extensión. Solo suma a MahzzTerm a la lista de «Abrir con» (`OpenWithProgids`), así que Windows te pregunta con qué abrir y vos elegís.
- Todo va en `HKCU\Software\Classes`, sin permisos de administrador. Viene apagado: se activa en el primer uso o en Ajustes → General → **Integración con Windows**. Con eso, la app lo registra al abrirse con la ruta de su `.exe` y el idioma de la interfaz, y lo rehace solo si cambian.
- Apagarlo en Ajustes lo borra. Al desinstalar, el instalador corre `MahzzTerm.exe --quitar-integracion`, que borra solo lo que agregó MahzzTerm.

**Código:** [`src-tauri/src/integracion.rs`](../src-tauri/src/integracion.rs) y [`src-tauri/instalador/hooks.nsh`](../src-tauri/instalador/hooks.nsh).

## Control por IA (MCP)

**Para qué sirve:** que Claude Code (u otra IA compatible con MCP) use la terminal como vos. Puede correr comandos y leer su resultado ya separado en bloques, mirar los logs de un servidor que sigue corriendo o coordinar a otros agentes que corren en otras pestañas.

**Cómo se conecta:** en Ajustes → General, **Conectar con Claude Code** copia este comando con la ruta de tu `MahzzTerm.exe`. Pegalo en una terminal:

```powershell
claude mcp add --scope user mahzzterm -- "C:\ruta\a\MahzzTerm.exe" --mcp
```

Si MahzzTerm no está abierta cuando la IA la necesita, se abre sola.

**Herramientas**

| Herramienta | Qué hace |
|---|---|
| `listar_pestanas` | Pestañas y paneles con su id, carpeta, programa, rama de git y si están ocupados |
| `leer_bloques` | Los últimos comandos terminados, con salida, código de salida, duración y carpeta (`solo_errores` para filtrar) |
| `leer_pantalla` | Lo que se ve ahora: la salida en vivo de un comando largo o la pantalla de un programa interactivo |
| `ejecutar` | Corre un comando y devuelve su bloque. Si tarda más que `timeout_s`, devuelve lo que se ve y el comando sigue (`esperar=false` para no esperar) |
| `enviar_teclas` | Texto y teclas (`enter`, `ctrl+c`, flechas…) para programas interactivos |
| `nueva_pestana`, `dividir_panel`, `cerrar_panel`, `enfocar_panel`, `renombrar_pestana` | Manejo del espacio de trabajo |
| `estado_agentes` | Qué agentes corren y si están trabajando, esperando o necesitan respuesta |
| `historial` | Los últimos comandos ejecutados, con filtro |
| `buscar_logs` | Busca en los comandos y salidas de todas las pestañas (últimos 30 días) |
| `nueva_tarea`, `listar_tareas`, `unir_tarea`, `descartar_tarea` | Tareas en paralelo con worktrees de git |
| `abrir_archivo` | Abre un archivo en el visor para que lo veas |

Sin `panel`, las herramientas usan el panel activo. `cerrar_panel` no cierra un panel con algo corriendo salvo que se pase `forzar=true`.

**Cómo funciona:** `MahzzTerm.exe --mcp` no abre ninguna ventana: habla MCP por entrada y salida estándar y le pasa cada pedido a la MahzzTerm abierta. Esa conexión es local (`127.0.0.1`, puerto al azar) y usa una clave que la app guarda en `control.json`, dentro de la carpeta de datos. La interfaz ejecuta el pedido y devuelve el resultado.

**Seguridad:** la IA puede ejecutar cualquier comando, igual que si lo escribieras vos. Para apagarlo, desactivá **Control por IA (MCP)** en Ajustes: los pedidos se rechazan al instante.

**Código:** [`src-tauri/src/mcp.rs`](../src-tauri/src/mcp.rs) (protocolo MCP), [`src-tauri/src/control.rs`](../src-tauri/src/control.rs) (conexión local) y [`src/control.ts`](../src/control.ts) (cada herramienta).

## Dónde se guardan los datos

Todo lo de MahzzTerm (ajustes, historial, sesiones, temas, secretos y la sesión de Google) vive en:

```
%LOCALAPPDATA%\com.mahzz.mahzzterm\datos
```

- La sesión de Google (`cuenta.dat`) y los secretos están cifrados con tu usuario de Windows: copiados a otra PC o a otra cuenta no se pueden leer.
- Las versiones anteriores guardaban todo junto al ejecutable. La primera vez que abrís la 0.2, se copia lo que falte desde esa carpeta vieja, sin pisar nada, y queda un archivo `.migrado` para no repetirlo.
- Para usar otra carpeta (pruebas o portable), definí la variable de entorno `MAHZZTERM_DATOS`.

**Código:** `carpeta_datos` en [`src-tauri/src/datos.rs`](../src-tauri/src/datos.rs).

## Atajos nuevos

| Atajo | Acción |
|---|---|
| `Ctrl+Shift+A` | Mostrar u ocultar los agentes activos |
| `Ctrl+Shift+G` | Mostrar u ocultar la revisión de cambios |
| `Ctrl+Shift+F` | Buscar en todos los logs |

Se pueden cambiar en Ajustes → Atajos.
