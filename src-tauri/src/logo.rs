// Logo elegible de MahzzTerm (Ajustes → Apariencia → Logo). Cambia el icono de todas las
// ventanas, que es el que muestran la barra de tareas y Alt+Tab. El logo de adentro de la app
// lo cambia la interfaz con los mismos archivos de public/logos.

use tauri::{image::Image, AppHandle, Manager};

// Los PNG van dentro del ejecutable: no dependen de archivos sueltos.
fn bytes_del_logo(logo: &str) -> &'static [u8] {
    match logo {
        "azul" => include_bytes!("../../public/logos/azul.png"),
        "oceano" => include_bytes!("../../public/logos/oceano.png"),
        "esmeralda" => include_bytes!("../../public/logos/esmeralda.png"),
        "hielo" => include_bytes!("../../public/logos/hielo.png"),
        "aurora" => include_bytes!("../../public/logos/aurora.png"),
        // "clasico" o cualquier nombre desconocido: el icono de siempre.
        _ => include_bytes!("../icons/128x128@2x.png"),
    }
}

#[tauri::command]
pub fn aplicar_logo(app: AppHandle, logo: String) -> Result<(), String> {
    for ventana in app.webview_windows().values() {
        let imagen = Image::from_bytes(bytes_del_logo(&logo)).map_err(|error| error.to_string())?;
        ventana
            .set_icon(imagen)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn todos_los_logos_son_png_validos() {
        for logo in ["clasico", "azul", "oceano", "esmeralda", "hielo", "aurora"] {
            let imagen = Image::from_bytes(bytes_del_logo(logo)).expect(logo);
            assert_eq!((imagen.width(), imagen.height()), (256, 256), "{logo}");
        }
    }

    #[test]
    fn un_logo_desconocido_usa_el_clasico() {
        assert_eq!(bytes_del_logo("no existe"), bytes_del_logo("clasico"));
    }
}
