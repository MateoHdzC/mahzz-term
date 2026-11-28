#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|argumento| argumento == "--mcp") {
        mahzzterm_lib::correr_mcp();
    } else if std::env::args().any(|argumento| argumento == "--quitar-integracion") {
        mahzzterm_lib::quitar_integracion();
    } else {
        mahzzterm_lib::iniciar();
    }
}
