# Cambios

Todas las versiones de MazzTerm. Las fechas usan el formato año-mes-día.

## [0.3.0] - 2026-11-19

### Agregado
- **Vista web de HTML, como Live Server**: los `.html` se abren en el visor mostrando la página como en el navegador, con un botón para alternar entre **Web** y **Código**. Un servidor local (solo en `127.0.0.1`) sirve todo el proyecto (la raíz del repo de git o la carpeta con `package.json`), así cargan el CSS, el JS y las imágenes aunque estén en otras carpetas, con rutas que empiezan con `/`, módulos de JS y `fetch`. La página se recarga sola cuando cambia el HTML o cualquier archivo que haya cargado. Corre aislada y no puede leer nada fuera del proyecto.
- **Pestañas a un costado**: en Ajustes → Apariencia → "Posición de las pestañas" se elige Arriba, A la izquierda o A la derecha. Al costado se reordenan arrastrando hacia arriba o abajo.
- **Visor y editor de archivos** en un panel lateral que se agranda arrastrando su borde. Un clic en un archivo del árbol lo abre en una pestaña.
  - Código con colores según el lenguaje, números de línea, búsqueda y plegado. Se edita ahí mismo y se guarda con el botón **Guardar** o `Ctrl+S`. Respeta los finales de línea y la marca BOM del archivo.
  - Los cambios sin guardar se marcan con un punto en la pestaña. Al cerrar la pestaña o la ventana, pregunta qué hacer.
  - Si el archivo cambia en el disco (por ejemplo, lo edita un agente), se recarga solo; si tenías cambios sin guardar, avisa antes de pisarlos.
  - Markdown renderizado con botón **Editar / Vista**; imágenes, video, audio y PDF; Excel, ODS y CSV como tabla con una pestaña por hoja; Word (.docx) como documento.
- **Manejo de archivos como en VS Code** en el panel de archivos: menú de clic derecho, renombrar en el lugar (F2), crear archivos y carpetas, mandar a la papelera de Windows (Supr), cortar, copiar y pegar (Ctrl+X/C/V) y arrastrar para mover (con Ctrl, copiar). Soltar un archivo sobre la terminal escribe su ruta.

### Cambiado
- **Menos memoria RAM**: WebView2 corre la red y la GPU dentro del proceso principal (de 6 procesos a 4) y usa un heap de JavaScript más chico. Con la ventana minimizada, oculta o sin usar más de 30 segundos, pasa a modo de memoria baja. Las librerías del visor se cargan recién al abrir ese tipo de archivo.
- Clic en un archivo del árbol ahora lo abre en el visor. Para mandar su ruta a la terminal, usá el clic derecho o arrastralo a la terminal.

## [0.2.0] - 2026-11-19

### Agregado
- **Panel de agentes activos** (botón ✦, `Ctrl+Shift+A`, `mahzz --agentes`). Lista los agentes que corren en la ventana (Claude Code, Codex, Gemini CLI, Aider, opencode y otros) con su estado: trabajando, esperando o "te necesita". Al hacer clic te lleva a su pestaña. Si un agente trabajó al menos 10 segundos y termina mientras mirás otra cosa, avisa con una notificación de Windows y pone en ámbar el punto de la pestaña.
- **Revisión de cambios** (`Ctrl+Shift+G`, `mahzz --cambios`). Panel a la derecha con los archivos cambiados del repositorio git, el diff de cada uno con números de línea y botones para aceptar (`git add`) o revertir. Revertir pide confirmación. Mientras está abierto se actualiza cada 3 segundos, porque los agentes cambian archivos sin terminar un comando.
- **Historial de sesiones** y el comando `mahzz --resume`. Cada ventana principal se guarda como una sesión, con sus pestañas, divisiones, carpetas, colores y nombres. `mahzz --resume` abre un selector y `mahzz --resume 2` abre directo la segunda más reciente. Se guardan las últimas 30 y se ocultan las repetidas.
- Al reabrir una sesión, el panel que tenía Claude Code queda con `claude --continue` escrito, listo para ejecutar.
- El comando `mahzz` dentro de la terminal, con su ayuda (`mahzz --help`).
- Acciones nuevas en la paleta de comandos: "Revisar cambios", "Ver agentes activos" y "Reanudar una sesión anterior".

### Corregido
- **La sesión de Google se perdía al cerrar la app o reiniciar la PC.** Los datos se guardaban en una carpeta `datos` junto al ejecutable, así que cada forma de abrir MazzTerm (desarrollo, release, instalador) tenía su propia carpeta y no veía la sesión de las otras. Ahora todo vive en `%LOCALAPPDATA%\com.mahzz.mahzzterm\datos`, y la primera vez se copia lo que había en la carpeta vieja, sin pisar nada.

## [0.1.0] - 2026-11-18

### Agregado
- Primera versión: PowerShell 7 real con bloques de comandos, editor con sintaxis y autocompletado, pestañas y paneles, SSH con bloques remotos, temas, atajos, secretos cifrados, idiomas y sincronización opcional con Google Drive.
