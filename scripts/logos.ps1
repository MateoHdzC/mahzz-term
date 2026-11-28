param([Parameter(Mandatory)] [string] $Origen)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName PresentationCore, WindowsBase, System.Xaml

Add-Type -ReferencedAssemblies PresentationCore, WindowsBase, System.Xaml -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

public static class Logos {
    static byte[] Leer(string ruta, out int ancho, out int alto, out bool tieneAlfa) {
        var decodificador = BitmapDecoder.Create(new Uri(ruta), BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
        var cuadro = decodificador.Frames[0];
        tieneAlfa = cuadro.Format == PixelFormats.Bgra32 || cuadro.Format == PixelFormats.Pbgra32;
        var bgra = new FormatConvertedBitmap(cuadro, PixelFormats.Bgra32, null, 0);
        ancho = bgra.PixelWidth; alto = bgra.PixelHeight;
        var pixeles = new byte[ancho * alto * 4];
        bgra.CopyPixels(pixeles, ancho * 4, 0);
        return pixeles;
    }

    static void SacarFondoNegro(byte[] p, int ancho, int alto) {
        const int Negro = 10, Limite = 48;
        var visto = new bool[ancho * alto];
        var cola = new Queue<int>();
        for (int x = 0; x < ancho; x++) { cola.Enqueue(x); cola.Enqueue((alto - 1) * ancho + x); }
        for (int y = 0; y < alto; y++) { cola.Enqueue(y * ancho); cola.Enqueue(y * ancho + ancho - 1); }
        while (cola.Count > 0) {
            int i = cola.Dequeue();
            if (visto[i]) continue;
            int m = Math.Max(p[i * 4], Math.Max(p[i * 4 + 1], p[i * 4 + 2]));
            if (m > Limite) continue;
            visto[i] = true;
            int alfa = m <= Negro ? 0 : (m - Negro) * 255 / (Limite - Negro);
            for (int c = 0; c < 3; c++) p[i * 4 + c] = (byte)(alfa == 0 ? 0 : Math.Min(255, p[i * 4 + c] * 255 / Math.Max(alfa, 1)));
            p[i * 4 + 3] = (byte)alfa;
            int x = i % ancho, y = i / ancho;
            if (x > 0) cola.Enqueue(i - 1);
            if (x < ancho - 1) cola.Enqueue(i + 1);
            if (y > 0) cola.Enqueue(i - ancho);
            if (y < alto - 1) cola.Enqueue(i + ancho);
        }
    }

    static Int32Rect LimpiarManchas(byte[] p, int ancho, int alto) {
        const int Umbral = 24;
        var grupo = new int[ancho * alto];
        int mejor = 0, tamanoMejor = 0, siguiente = 0;
        var cola = new Queue<int>();
        for (int inicio = 0; inicio < grupo.Length; inicio++) {
            if (grupo[inicio] != 0 || p[inicio * 4 + 3] <= Umbral) continue;
            siguiente++;
            int tamano = 0;
            grupo[inicio] = siguiente;
            cola.Enqueue(inicio);
            while (cola.Count > 0) {
                int i = cola.Dequeue(); tamano++;
                int x = i % ancho, y = i / ancho;
                foreach (int v in new[] { x > 0 ? i - 1 : -1, x < ancho - 1 ? i + 1 : -1, y > 0 ? i - ancho : -1, y < alto - 1 ? i + ancho : -1 }) {
                    if (v < 0 || grupo[v] != 0 || p[v * 4 + 3] <= Umbral) continue;
                    grupo[v] = siguiente;
                    cola.Enqueue(v);
                }
            }
            if (tamano > tamanoMejor) { tamanoMejor = tamano; mejor = siguiente; }
        }
        int minX = ancho, minY = alto, maxX = 0, maxY = 0;
        for (int i = 0; i < grupo.Length; i++) {
            if (grupo[i] != mejor) continue;
            int x = i % ancho, y = i / ancho;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        int margen = 24;
        for (int i = 0; i < grupo.Length; i++) {
            int x = i % ancho, y = i / ancho;
            bool afuera = x < minX - margen || x > maxX + margen || y < minY - margen || y > maxY + margen;
            bool otraMancha = grupo[i] != 0 && grupo[i] != mejor;
            if (afuera || otraMancha) p[i * 4 + 3] = 0;
        }
        return new Int32Rect(minX, minY, maxX - minX + 1, maxY - minY + 1);
    }

    public static void Preparar(string origen, string destino, int lado) {
        int ancho, alto; bool tieneAlfa;
        var p = Leer(origen, out ancho, out alto, out tieneAlfa);
        if (!tieneAlfa) SacarFondoNegro(p, ancho, alto);
        var caja = LimpiarManchas(p, ancho, alto);

        var completa = BitmapSource.Create(ancho, alto, 96, 96, PixelFormats.Bgra32, null, p, ancho * 4);
        double ladoCaja = Math.Max(caja.Width, caja.Height) * 1.08;
        double cx = caja.X + caja.Width / 2.0, cy = caja.Y + caja.Height / 2.0;
        var visual = new DrawingVisual();
        RenderOptions.SetBitmapScalingMode(visual, BitmapScalingMode.HighQuality);
        using (var dibujo = visual.RenderOpen()) {
            double escala = lado / ladoCaja;
            dibujo.PushTransform(new ScaleTransform(escala, escala));
            dibujo.PushTransform(new TranslateTransform(ladoCaja / 2 - cx, ladoCaja / 2 - cy));
            dibujo.DrawImage(completa, new Rect(0, 0, ancho, alto));
        }
        var salida = new RenderTargetBitmap(lado, lado, 96, 96, PixelFormats.Pbgra32);
        salida.Render(visual);
        var codificador = new PngBitmapEncoder();
        codificador.Frames.Add(BitmapFrame.Create(salida));
        using (var archivo = File.Create(destino)) codificador.Save(archivo);
    }
}
'@

$nombres = @("azul", "oceano", "esmeralda", "hielo", "aurora")
$carpeta = Join-Path $PSScriptRoot "..\public\logos"
New-Item -ItemType Directory -Force $carpeta | Out-Null
for ($i = 0; $i -lt $nombres.Count; $i++) {
    $entrada = Get-ChildItem $Origen -Filter "opc$($i + 1).*" | Select-Object -First 1
    if (-not $entrada) { throw "Falta opc$($i + 1) en $Origen" }
    $salida = Join-Path $carpeta "$($nombres[$i]).png"
    [Logos]::Preparar($entrada.FullName, (Resolve-Path $carpeta).Path + "\$($nombres[$i]).png", 256)
    Write-Host "$($entrada.Name) -> logos\$($nombres[$i]).png"
}
