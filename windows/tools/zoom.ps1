param([string]$In, [string]$Out = "$env:TEMP\dhl-zoom.png", [int]$X=740, [int]$Y=0, [int]$W=120, [int]$H=60, [int]$Scale=6)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile($In)
$crop = New-Object System.Drawing.Bitmap ($W*$Scale), ($H*$Scale)
$g = [System.Drawing.Graphics]::FromImage($crop)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 0,0,($W*$Scale),($H*$Scale)), (New-Object System.Drawing.Rectangle $X,$Y,$W,$H), [System.Drawing.GraphicsUnit]::Pixel)
$crop.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $crop.Dispose(); $src.Dispose()
Write-Host $Out
