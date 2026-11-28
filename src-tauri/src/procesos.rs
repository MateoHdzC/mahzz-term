use std::mem::size_of;

use windows::{
    Wdk::System::Threading::{NtQueryInformationProcess, ProcessCommandLineInformation},
    Win32::{
        Foundation::{CloseHandle, UNICODE_STRING},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
        },
    },
};

pub struct Proceso {
    pid: u32,
    padre: u32,
    nombre: String,
}

const AGENTES_NODE: &[(&str, &str)] = &[
    ("@anthropic-ai/claude-code", "claude"),
    ("@openai/codex", "codex"),
    ("@google/gemini-cli", "gemini"),
    ("@qwen-code/qwen-code", "qwen"),
    ("@github/copilot", "copilot"),
    ("@sourcegraph/amp", "amp"),
    ("@charmland/crush", "crush"),
    ("opencode-ai", "opencode"),
];

pub fn listar() -> Vec<Proceso> {
    let mut procesos = Vec::new();
    unsafe {
        let Ok(foto) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return procesos;
        };
        let mut entrada = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(foto, &mut entrada).is_ok() {
            loop {
                let largo = entrada
                    .szExeFile
                    .iter()
                    .position(|caracter| *caracter == 0)
                    .unwrap_or(entrada.szExeFile.len());
                procesos.push(Proceso {
                    pid: entrada.th32ProcessID,
                    padre: entrada.th32ParentProcessID,
                    nombre: String::from_utf16_lossy(&entrada.szExeFile[..largo]),
                });
                if Process32NextW(foto, &mut entrada).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(foto);
    }
    procesos
}

fn es_interno(nombre: &str) -> bool {
    nombre.eq_ignore_ascii_case("conhost.exe") || nombre.eq_ignore_ascii_case("openconsole.exe")
}

fn primer_hijo(pid: u32, procesos: &[Proceso]) -> Option<&Proceso> {
    procesos
        .iter()
        .find(|proceso| proceso.padre == pid && !es_interno(&proceso.nombre))
}

fn linea_de_comandos(pid: u32) -> Option<String> {
    unsafe {
        let proceso = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut largo = 0u32;
        let _ = NtQueryInformationProcess(
            proceso,
            ProcessCommandLineInformation,
            std::ptr::null_mut(),
            0,
            &mut largo,
        );
        let mut linea = None;
        if largo as usize >= size_of::<UNICODE_STRING>() {
            let mut buffer = vec![0u64; (largo as usize).div_ceil(8)];
            let estado = NtQueryInformationProcess(
                proceso,
                ProcessCommandLineInformation,
                buffer.as_mut_ptr().cast(),
                largo,
                &mut largo,
            );
            let texto = &*buffer.as_ptr().cast::<UNICODE_STRING>();
            if estado.is_ok() && !texto.Buffer.is_null() && texto.Length > 0 {
                let caracteres =
                    std::slice::from_raw_parts(texto.Buffer.0, texto.Length as usize / 2);
                linea = Some(String::from_utf16_lossy(caracteres));
            }
        }
        let _ = CloseHandle(proceso);
        linea
    }
}

fn agente_node(linea: &str) -> Option<&'static str> {
    let linea = linea.replace('\\', "/").to_ascii_lowercase();
    AGENTES_NODE
        .iter()
        .find(|(paquete, _)| linea.contains(&format!("node_modules/{paquete}/")))
        .map(|(_, agente)| *agente)
}

pub fn programa_de(pid_shell: u32, procesos: &[Proceso]) -> Option<String> {
    let mut actual = primer_hijo(pid_shell, procesos)?;
    if actual.nombre.eq_ignore_ascii_case("cmd.exe") {
        if let Some(hijo) = primer_hijo(actual.pid, procesos) {
            actual = hijo;
        }
    }
    let nombre = actual.nombre.as_str();
    let sin_extension = nombre
        .strip_suffix(".exe")
        .or_else(|| nombre.strip_suffix(".EXE"))
        .unwrap_or(nombre);
    if sin_extension.eq_ignore_ascii_case("node") {
        if let Some(agente) = linea_de_comandos(actual.pid).and_then(|linea| agente_node(&linea)) {
            return Some(agente.to_string());
        }
    }
    Some(sin_extension.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconoce_agentes_instalados_con_npm() {
        let claude = r#""C:\Program Files\nodejs\node.exe" C:\Users\ana\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js --continue"#;
        assert_eq!(agente_node(claude), Some("claude"));

        let codex =
            r#"node "C:\Users\ana\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js""#;
        assert_eq!(agente_node(codex), Some("codex"));

        let gemini = r"node C:\Users\ana\AppData\Local\npm-cache\_npx\4f2a\node_modules\@google\gemini-cli\dist\index.js";
        assert_eq!(agente_node(gemini), Some("gemini"));
    }

    #[test]
    fn no_confunde_otros_programas_de_node() {
        assert_eq!(
            agente_node(r"node C:\proyecto\node_modules\vite\bin\vite.js"),
            None
        );
        assert_eq!(agente_node("node servidor.js"), None);
        assert_eq!(
            agente_node(r"node C:\x\node_modules\@openai\codex-tools\index.js"),
            None
        );
    }

    #[test]
    fn lee_la_linea_de_comandos_de_este_proceso() {
        let linea = linea_de_comandos(std::process::id()).expect("debería poder leerse");
        assert!(!linea.is_empty());
    }

    #[test]
    fn reconoce_un_agente_node_que_esta_corriendo() {
        let carpeta = std::env::temp_dir().join(format!("mahzz-agente-{}", std::process::id()));
        let script = carpeta.join(r"node_modules\@openai\codex\bin\codex.js");
        std::fs::create_dir_all(script.parent().unwrap()).unwrap();
        std::fs::write(&script, "setTimeout(() => {}, 30000);").unwrap();

        let Ok(mut node) = std::process::Command::new("node").arg(&script).spawn() else {
            eprintln!("node no está instalado: se saltea la prueba");
            let _ = std::fs::remove_dir_all(&carpeta);
            return;
        };
        let linea = linea_de_comandos(node.id());
        let _ = node.kill();
        let _ = node.wait();
        let _ = std::fs::remove_dir_all(&carpeta);

        assert_eq!(linea.as_deref().and_then(agente_node), Some("codex"));
    }
}
