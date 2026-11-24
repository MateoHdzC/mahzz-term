// En la versión final evita que se abra una consola extra junto a la ventana.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `MahzzTerm.exe --mcp` no abre ventana: es el servidor MCP para que una IA controle la terminal.
    if std::env::args().any(|argumento| argumento == "--mcp") {
        mahzzterm_lib::correr_mcp();
    } else if std::env::args().any(|argumento| argumento == "--quitar-integracion") {
        // Lo corre el desinstalador: borra "Abrir en MahzzTerm" y "Abrir con" y sale sin abrir ventana.
        mahzzterm_lib::quitar_integracion();
    } else {
        mahzzterm_lib::iniciar();
    }
}
