$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:USERPROFILE '.pdfmaker'
$portableDir = Join-Path $installRoot 'Calibre Portable'
$converter = Join-Path $portableDir 'Calibre\ebook-convert.exe'
if (Test-Path -LiteralPath $converter -PathType Leaf) {
    Write-Output "Конвертер Kindle уже установлен: $converter"
    exit 0
}
if ($portableDir.Length -gt 58) {
    throw 'Путь профиля слишком длинный для Calibre Portable. Установите обычный Calibre: https://calibre-ebook.com/download_windows'
}
if (Test-Path -LiteralPath $portableDir) {
    throw "Найдена неполная установка: $portableDir. Установите обычный Calibre с calibre-ebook.com."
}
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
$installer = Join-Path $installRoot 'calibre-portable-installer-9.15.0.exe'
$downloadUrl = 'https://github.com/kovidgoyal/calibre/releases/download/v9.15.0/calibre-portable-installer-9.15.0.exe'
Write-Output 'Загрузка официального Calibre Portable 9.15.0 (около 196 МБ)...'
Invoke-WebRequest -Uri $downloadUrl -OutFile $installer -UseBasicParsing
$expectedHash = '55A8C89BC0739A2DC6D496742EA625FCCC6DFDEC1413EB805805A28E7227536C'
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $expectedHash) {
    throw 'Контрольная сумма Calibre не совпадает. Установка отменена.'
}
$signature = Get-AuthenticodeSignature -FilePath $installer
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*CN=Kovid Goyal*') {
    throw 'Цифровая подпись Calibre не подтверждена. Установка отменена.'
}
$job = Start-Process -FilePath $installer -ArgumentList ('"{0}"' -f $installRoot) -WindowStyle Hidden -Wait -PassThru
if ($job.ExitCode -ne 0 -or !(Test-Path -LiteralPath $converter -PathType Leaf)) {
    throw 'Calibre не удалось распаковать. Установите обычный Calibre с calibre-ebook.com.'
}
Remove-Item -LiteralPath $installer
Write-Output "Экспорт MOBI и AZW3 готов: $converter"
