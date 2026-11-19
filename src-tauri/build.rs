use std::fs;

fn main() {
    // La credencial vive en un archivo local que nunca se publica en el repositorio.
    println!("cargo:rerun-if-changed=credenciales/google.json");
    if let Some(datos) = fs::read_to_string("credenciales/google.json")
        .ok()
        .and_then(|texto| serde_json::from_str::<serde_json::Value>(&texto).ok())
    {
        let instalada = &datos["installed"];
        if let (Some(cliente), Some(clave)) = (instalada["client_id"].as_str(), instalada["client_secret"].as_str()) {
            println!("cargo:rustc-env=MAZZ_GOOGLE_ID={cliente}");
            println!("cargo:rustc-env=MAZZ_GOOGLE_SECRET={clave}");
        }
    }
    tauri_build::build()
}
