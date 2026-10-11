# Baixa um build do FFmpeg para Windows e copia ffmpeg.exe/ffprobe.exe para resources\bin,
# para que o instalador (npm run dist:win) já venha com o FFmpeg.
# NÃO TESTADO AINDA (escrito num ambiente Linux). Revise antes de usar.
# Licença: o build "essentials" do gyan.dev é GPL (inclui libx264). Ao distribuir o instalador
# com ele, você precisa cumprir a GPL (informar a licença e oferecer o código-fonte do FFmpeg).
param(
  [string]$Url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root "resources\bin"
$tmp = Join-Path $env:TEMP ("bigloop-ffmpeg-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp, $bin | Out-Null
try {
  $zip = Join-Path $tmp "ffmpeg.zip"
  Write-Host "Baixando $Url ..."
  Invoke-WebRequest -Uri $Url -OutFile $zip
  Write-Host "SHA256 do arquivo baixado (compare com o publicado no site):"
  (Get-FileHash $zip -Algorithm SHA256).Hash
  Expand-Archive -Path $zip -DestinationPath $tmp
  foreach ($exe in "ffmpeg.exe", "ffprobe.exe") {
    $found = Get-ChildItem -Path $tmp -Recurse -Filter $exe | Select-Object -First 1
    if (-not $found) { throw "$exe não encontrado no zip." }
    Copy-Item $found.FullName (Join-Path $bin $exe) -Force
  }
  $license = Get-ChildItem -Path $tmp -Recurse -Filter "LICENSE*" | Select-Object -First 1
  if ($license) { Copy-Item $license.FullName (Join-Path $bin "FFMPEG-LICENSE.txt") -Force }
  & (Join-Path $bin "ffmpeg.exe") -version | Select-Object -First 1
  Write-Host "Pronto: $bin"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
