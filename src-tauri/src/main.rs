// En la versión final evita que se abra una consola extra junto a la ventana.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mahzzterm_lib::iniciar();
}
