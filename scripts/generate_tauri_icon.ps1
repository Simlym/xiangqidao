param(
    [string]$OutputDirectory = "$PSScriptRoot\..\src-tauri\icons"
)

Add-Type -AssemblyName System.Drawing
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null

$bitmap = [System.Drawing.Bitmap]::new(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$graphics.Clear([System.Drawing.Color]::FromArgb(138, 90, 43))
$cream = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(244, 236, 224))
$border = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(90, 61, 34), 8)
$graphics.FillEllipse($cream, 30, 30, 196, 196)
$graphics.DrawEllipse($border, 30, 30, 196, 196)

$font = [System.Drawing.Font]::new("Microsoft YaHei", 112, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$red = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(192, 57, 43))
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString("将", $font, $red, [System.Drawing.RectangleF]::new(0, 0, 256, 250), $format)

$pngPath = Join-Path $resolvedOutput "icon.png"
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# ICO 可直接封装 PNG 图像；保留透明度与高分辨率，适合 Windows 资源文件。
$png = [System.IO.File]::ReadAllBytes($pngPath)
$icoPath = Join-Path $resolvedOutput "icon.ico"
$stream = [System.IO.File]::Create($icoPath)
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$png.Length)
$writer.Write([UInt32]22)
$writer.Write($png)
$writer.Dispose()

$format.Dispose()
$red.Dispose()
$font.Dispose()
$border.Dispose()
$cream.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "Generated $icoPath"

