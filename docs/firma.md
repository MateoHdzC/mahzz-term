# Firmar MahzzTerm con SignPath Foundation

Sin firma, Defender puede marcar el instalador como `Trojan:Win32/Bearfoos.A!ml` (un falso positivo por ser un programa nuevo sin firma) y SmartScreen muestra "Windows protegió tu PC". SignPath Foundation firma gratis proyectos open source como este.

## Cómo funciona

El workflow [`release.yml`](../.github/workflows/release.yml) se corre a mano desde GitHub (Actions → **Release** → **Run workflow**):

1. Compila el `.exe` en un runner de Windows de GitHub.
2. Lo manda a SignPath para firmarlo. **Vos aprobás el pedido** en signpath.io.
3. Arma el instalador NSIS con ese `.exe` firmado y lo manda a firmar (segundo pedido para aprobar).
4. Rehace la firma de actualización (`.sig`) sobre el instalador firmado y arma `latest.json` con `publicar.ps1 -SinCompilar`.
5. Deja el release **en borrador**. Lo revisás y lo publicás vos.

Sin las variables de SignPath, hace lo mismo pero sin firmar. Sirve para probar el workflow ya.

## 1. Lo que hacés una sola vez (vos)

1. **Autenticación en dos pasos (MFA)** en tu cuenta de GitHub. SignPath la exige para todo el equipo.
2. **Secretos del repo** (GitHub → Settings → Secrets and variables → Actions → *Secrets*). Con `gh`, desde tu PC:

   ```powershell
   gh secret set TAURI_SIGNING_PRIVATE_KEY -R MateoHdzC/mahzz-term < "$HOME\.tauri\mahzzterm.key"
   ```
   ```powershell
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R MateoHdzC/mahzz-term --body '""'
   ```
   ```powershell
   gh secret set GOOGLE_CREDENCIALES_JSON -R MateoHdzC/mahzz-term < src-tauri\credenciales\google.json
   ```

   La contraseña de la clave es literalmente `""` (dos comillas), igual que en `publicar.ps1`.
3. **Probá el workflow sin firma:** Actions → Release → Run workflow. Tiene que terminar con un borrador de release. Borralo después si no lo vas a usar.

## 2. Pedir el alta en SignPath Foundation (vos)

- Formulario: https://signpath.org/apply
- Condiciones que ya cumple MahzzTerm: licencia MIT, código propio, mantenido, releases publicados, funciones descritas en la web, desinstalador, política de privacidad (en el README).
- La integración con el Explorador ahora se pregunta en el primer uso y viene apagada, porque las condiciones prohíben cambios en el sistema sin avisar.
- La revisión es a criterio de ellos y no dicen cuánto tarda.

## 3. Cuando te acepten

1. En SignPath: creá el proyecto (por ejemplo `mahzzterm`), conectalo con GitHub como *trusted build system* y creá una política de firma (por ejemplo `release-signing`) con aprobación manual.
2. Creá dos **artifact configurations**. Esto es un **borrador**: revisalo con el editor y la documentación de SignPath antes de usarlo.

   `exe`:
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="MahzzTerm.exe" product-name="MahzzTerm" product-version="${version}">
         <authenticode-sign />
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

   `instalador`:
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="MahzzTerm-setup.exe" product-name="MahzzTerm" product-version="${version}">
         <authenticode-sign />
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

   El workflow manda el parámetro `version` (por ejemplo `0.6.2`). SignPath pide que nombre y versión del producto estén fijados en cada firma.
3. Creá un API token con permiso de *submitter* y guardalo como secreto `SIGNPATH_API_TOKEN`.
4. **Variables del repo** (Settings → Secrets and variables → Actions → *Variables*): `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` (`mahzzterm`) y `SIGNPATH_SIGNING_POLICY_SLUG` (`release-signing`). Con la primera cargada, el workflow empieza a firmar.
5. En el README, reemplazá la línea "está en trámite" por la frase que piden, con sus links:
   "Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org)".

## Mientras tanto

Cada versión nueva se puede reportar a Microsoft como falso positivo: https://www.microsoft.com/en-us/wdsi/filesubmission (Software developer → Incorrectly detected).
