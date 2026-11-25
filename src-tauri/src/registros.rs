// Registro de todos los bloques terminados, para buscar en los logs de cualquier pestaña y día.
// Un archivo JSONL por día en datos/logs. Se guardan 30 días.
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, SystemTime},
};

use serde_json::{json, Value};
use tauri::{async_runtime::spawn_blocking, AppHandle, State};

use crate::datos::carpeta_datos;

const DIAS_GUARDADOS: u64 = 30;
const MAXIMO_TEXTO: usize = 200_000;
const CONTEXTO: usize = 160;

#[derive(Default)]
pub struct Registros {
    // Evita que dos bloques que terminan juntos mezclen sus líneas en el archivo.
    escritura: Mutex<()>,
    podado: Mutex<bool>,
}

fn carpeta_logs(app: &AppHandle) -> Result<PathBuf, String> {
    let carpeta = carpeta_datos(app)?.join("logs");
    fs::create_dir_all(&carpeta).map_err(|error| error.to_string())?;
    Ok(carpeta)
}

fn podar(carpeta: &PathBuf) {
    let limite = SystemTime::now() - Duration::from_secs(DIAS_GUARDADOS * 24 * 60 * 60);
    let Ok(entradas) = fs::read_dir(carpeta) else {
        return;
    };
    for entrada in entradas.flatten() {
        let viejo = entrada
            .metadata()
            .and_then(|datos| datos.modified())
            .is_ok_and(|fecha| fecha < limite);
        if viejo {
            let _ = fs::remove_file(entrada.path());
        }
    }
}

fn recortar_texto(texto: &str) -> String {
    if texto.len() <= MAXIMO_TEXTO {
        return texto.to_string();
    }
    let mut corte = texto.len() - MAXIMO_TEXTO;
    while !texto.is_char_boundary(corte) {
        corte += 1;
    }
    format!("…[recortado]\n{}", &texto[corte..])
}

#[tauri::command]
pub fn guardar_registro(
    app: AppHandle,
    registros: State<'_, Registros>,
    entrada: Value,
    dia: String,
) -> Result<(), String> {
    if dia.len() != 10
        || !dia
            .chars()
            .all(|caracter| caracter.is_ascii_digit() || caracter == '-')
    {
        return Err("Día inválido".to_string());
    }
    let carpeta = carpeta_logs(&app)?;
    if let Ok(mut podado) = registros.podado.lock() {
        if !*podado {
            podar(&carpeta);
            *podado = true;
        }
    }
    let mut entrada = entrada;
    if let Some(texto) = entrada["texto"].as_str() {
        entrada["texto"] = json!(recortar_texto(texto));
    }
    let _cerrojo = registros
        .escritura
        .lock()
        .map_err(|error| error.to_string())?;
    let mut archivo = OpenOptions::new()
        .create(true)
        .append(true)
        .open(carpeta.join(format!("{dia}.jsonl")))
        .map_err(|error| error.to_string())?;
    writeln!(archivo, "{entrada}").map_err(|error| error.to_string())
}

// Un pedazo del texto alrededor de la coincidencia, para mostrar en la lista de resultados.
fn fragmento(texto: &str, posicion: usize, largo: usize) -> String {
    let mut inicio = posicion.saturating_sub(CONTEXTO);
    while !texto.is_char_boundary(inicio) {
        inicio -= 1;
    }
    let mut fin = (posicion + largo + CONTEXTO).min(texto.len());
    while !texto.is_char_boundary(fin) {
        fin += 1;
    }
    let mut resultado = texto[inicio..fin].replace(['\r', '\n'], " ⏎ ");
    if inicio > 0 {
        resultado.insert(0, '…');
    }
    if fin < texto.len() {
        resultado.push('…');
    }
    resultado
}

// Busca en los logs, del más nuevo al más viejo. Sin consulta devuelve los últimos bloques.
// `solo_errores` deja solo los que terminaron con código distinto de 0.
#[tauri::command]
pub async fn buscar_registros(
    app: AppHandle,
    consulta: String,
    limite: Option<usize>,
    solo_errores: Option<bool>,
) -> Result<Vec<Value>, String> {
    let carpeta = carpeta_logs(&app)?;
    spawn_blocking(move || {
        let limite = limite.unwrap_or(50).clamp(1, 500);
        let buscada = consulta.trim().to_lowercase();
        let mut archivos: Vec<PathBuf> = fs::read_dir(&carpeta)
            .map_err(|error| error.to_string())?
            .flatten()
            .map(|entrada| entrada.path())
            .filter(|ruta| {
                ruta.extension()
                    .is_some_and(|extension| extension == "jsonl")
            })
            .collect();
        archivos.sort();
        archivos.reverse();

        let mut resultados = Vec::new();
        for archivo in archivos {
            let Ok(contenido) = fs::read_to_string(&archivo) else {
                continue;
            };
            for linea in contenido.lines().rev() {
                let Ok(mut entrada) = serde_json::from_str::<Value>(linea) else {
                    continue;
                };
                if solo_errores == Some(true) && entrada["codigo"].as_i64().unwrap_or(0) == 0 {
                    continue;
                }
                let comando = entrada["comando"].as_str().unwrap_or("").to_string();
                let texto = entrada["texto"].as_str().unwrap_or("").to_string();
                if !buscada.is_empty() {
                    let en_comando = comando.to_lowercase().contains(&buscada);
                    let en_texto = texto.to_lowercase().find(&buscada);
                    if !en_comando && en_texto.is_none() {
                        continue;
                    }
                    if let Some(posicion) = en_texto {
                        // to_lowercase puede cambiar largos con algunos caracteres: se ajusta al texto real.
                        let posicion = posicion.min(texto.len());
                        entrada["fragmento"] = json!(fragmento(&texto, posicion, buscada.len()));
                    }
                }
                resultados.push(entrada);
                if resultados.len() >= limite {
                    return Ok(resultados);
                }
            }
        }
        Ok(resultados)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn fragmento_respeta_caracteres() {
        let texto = "ñandú ".repeat(100) + "ERROR acá" + &" fin".repeat(80);
        let posicion = texto.find("ERROR").unwrap();
        let resultado = fragmento(&texto, posicion, 5);
        assert!(resultado.contains("ERROR acá"));
        assert!(resultado.starts_with('…') && resultado.ends_with('…'));
        assert!(recortar_texto(&"á".repeat(MAXIMO_TEXTO)).starts_with("…[recortado]"));
    }
}
