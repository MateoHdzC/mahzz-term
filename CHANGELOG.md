# Cambios

Todas las versiones de MahzzTerm. Las fechas usan el formato año-mes-día.

## [0.6.2] - 2026-11-24

### Agregado
- **Mahzz-AI ya funciona con su modelo propio.** Si tenés `mahzz` instalado en Ollama, el panel lo usa directo. Si no, te muestra el comando para bajarlo (`ollama pull dkdidmateo/mahzz`) con botones para copiarlo o mandarlo a la terminal.
- **Mahzz-AI con tu API key.** Desde el botón de ajustes del panel podés usar cualquier API compatible con OpenAI (OpenAI, OpenRouter, Groq, DeepSeek, LM Studio…). La key se guarda cifrada con tu usuario de Windows y nunca vuelve a la interfaz.
- **Abrir en MahzzTerm desde el Explorador.** Clic derecho en una carpeta, en el fondo de una carpeta o en un disco → **Abrir en MahzzTerm** abre una pestaña ahí. Si MahzzTerm ya está abierta, la pestaña se suma a esa ventana y la trae al frente. En Windows 11 está en «Mostrar más opciones».
- **MahzzTerm en «Abrir con».** Aparece como recomendado para Markdown, texto y código, y como opción para cualquier otro archivo, que se abre en el visor. No le saca a nadie el programa por defecto: cuando Windows te pregunte con qué abrir un archivo, MahzzTerm está en la lista. Se apaga en Ajustes → General → **Integración con Windows** y el desinstalador lo borra.

### Cambiado
- Mahzz-AI ya no usa un modelo provisorio: solo responde con el modelo propio instalado o con la API que configures.

## [0.6.1] - 2026-11-22

### Cambiado
- **Mahzz-AI ahora es una ventanita flotante.** Aparece chica abajo a la derecha: se mueve arrastrándola del encabezado y se agranda o achica desde cualquier borde o esquina. Con el botón del encabezado (o doble clic en él) se ancla al costado derecho y vuelve a flotar. Recuerda el modo, la posición y el tamaño.

### Corregido
- El panel de Mahzz-AI aparecía a la izquierda de la terminal en vez de a la derecha.

## [0.6.0] - 2026-11-22

### Agregado
- **Mahzz-AI, el copiloto de MahzzTerm** (vista previa). Un panel a la derecha, con su botón en la barra o con `Ctrl+Shift+M`, para charlar con una IA que corre en tu PC con Ollama. Ve el último comando de la terminal (su salida y su código de error) si dejás prendido el chip **Último comando**, así le podés preguntar por qué falló algo sin copiar nada. Las respuestas aparecen mientras las escribe, con su razonamiento plegable, y cada bloque de código trae **Copiar** y **A la terminal** (lo escribe sin ejecutarlo).
- El modelo de Mahzz-AI todavía no se puede descargar: si no está instalado, el panel lo avisa y lleva a la página de Mahzz-AI en mahzzterm.xyz.

## [0.5.2] - 2026-11-21

### Cambiado
- **Instalador con la identidad de MahzzTerm**: panel lateral y encabezado propios con el logo, ícono de MahzzTerm y textos en español (o en inglés, según el idioma de Windows).
- **Datos del ejecutable**: en Propiedades → Detalles y en "Aplicaciones instaladas" ahora figuran el nombre, la descripción, el autor, el copyright y la web.

## [0.5.1] - 2026-11-21

### Cambiado
- **Aviso de actualizaciones más cómodo.** MahzzTerm busca versiones nuevas al abrirse y **cada 6 horas** mientras está abierta. Cuando hay una, avisa con una **notificación de Windows** (una sola vez por versión) y deja un puntito verde en el botón de Ajustes, sin cartel que interrumpa. En Ajustes → General aparece **Actualizar a X**, que la instala y reinicia la app.

## [0.5.0] - 2026-11-20

### Agregado
- **Instalador y actualizaciones automáticas.** MahzzTerm se instala con `MahzzTerm-setup.exe` desde los releases de GitHub. Al abrirse se fija si hay una versión nueva y ofrece instalarla; también se puede buscar desde Ajustes → General. Las actualizaciones vienen firmadas y la app rechaza las que no coinciden con su clave.
- **Tareas en paralelo para agentes (worktrees).** Desde el panel de agentes (✦), "Nueva tarea en paralelo" crea una copia de trabajo de git aparte con su propia rama (`mahzz/<nombre>`), abre una pestaña ahí y arranca al agente con las instrucciones. Varias tareas pueden avanzar a la vez sin pisarse. Cada tarea se puede abrir, **unir** a tu rama (guarda lo que dejó el agente en un commit) o **descartar**.
- **Búsqueda en todos los logs** (`Ctrl+Shift+F`): busca en los comandos y en sus salidas de cualquier pestaña, de los últimos 30 días, con filtro de solo errores.
- **Los bloques sobreviven al reabrir**: al restaurar o reanudar una sesión, cada panel vuelve con sus últimos 30 bloques.
- Herramientas MCP nuevas: `buscar_logs`, `nueva_tarea`, `listar_tareas`, `unir_tarea` y `descartar_tarea`.

## [0.4.0] - 2026-11-20

### Agregado
- **MCP para que una IA controle la terminal.** `MahzzTerm.exe --mcp` es un servidor MCP: Claude Code (u otra IA compatible) puede ver las pestañas y paneles, leer los bloques con su salida y código de error, leer la pantalla en vivo (logs de un servidor, la pantalla de otro agente), ejecutar comandos y recibir el resultado, mandar teclas a programas interactivos, abrir, dividir, cerrar y renombrar pestañas, ver el estado de los agentes, leer el historial y abrir archivos en el visor. Si MahzzTerm no está abierta, la abre sola.
- En Ajustes → General: interruptor **Control por IA (MCP)** y botón **Conectar con Claude Code**, que copia el comando para registrarlo.

### Cambiado
- El nombre pasa a ser **MahzzTerm** (antes MazzTerm).

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
- **La sesión de Google se perdía al cerrar la app o reiniciar la PC.** Los datos se guardaban en una carpeta `datos` junto al ejecutable, así que cada forma de abrir MahzzTerm (desarrollo, release, instalador) tenía su propia carpeta y no veía la sesión de las otras. Ahora todo vive en `%LOCALAPPDATA%\com.mahzz.mahzzterm\datos`, y la primera vez se copia lo que había en la carpeta vieja, sin pisar nada.

## [0.1.0] - 2026-11-18

### Agregado
- Primera versión: PowerShell 7 real con bloques de comandos, editor con sintaxis y autocompletado, pestañas y paneles, SSH con bloques remotos, temas, atajos, secretos cifrados, idiomas y sincronización opcional con Google Drive.
