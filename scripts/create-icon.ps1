$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) 'assets'
New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null
$bitmap = [System.Drawing.Bitmap]::new(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)
$blue = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#3564DD'))
$graphics.FillEllipse($blue, 6, 6, 244, 244)
$pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 12)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$leaf = [System.Drawing.Drawing2D.GraphicsPath]::new()
$leaf.AddBezier(184, 66, 98, 46, 58, 104, 78, 151)
$leaf.AddBezier(78, 151, 112, 216, 200, 165, 184, 66)
$graphics.DrawPath($pen, $leaf)
$graphics.DrawLine($pen, 72, 190, 154, 105)
$pngPath = Join-Path $assetDirectory 'icon.png'
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes = [System.IO.File]::ReadAllBytes($pngPath)
$stream = [System.IO.File]::Create((Join-Path $assetDirectory 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$bytes.Length); $writer.Write([uint32]22)
$writer.Write($bytes)
$writer.Dispose(); $leaf.Dispose(); $pen.Dispose(); $blue.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
