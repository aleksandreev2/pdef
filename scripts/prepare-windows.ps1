$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $projectDir 'tools'
$licenseDir = Join-Path $toolsDir 'licenses'
$calibreDir = Join-Path $toolsDir 'calibre'
$portableDir = Join-Path $env:USERPROFILE '.pdfmaker\Calibre Portable\Calibre'
$sourceArchive = Join-Path $licenseDir 'calibre-9.15.0.tar.xz'
New-Item -ItemType Directory -Path $licenseDir -Force | Out-Null

function Receive-VerifiedFile($url, $destination, $expectedHash) {
    if (!(Test-Path -LiteralPath $destination -PathType Leaf) -or
        (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $expectedHash) {
        Write-Output "Загрузка: $url"
        Invoke-WebRequest -Uri $url -OutFile $destination -UseBasicParsing
    }
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $expectedHash) {
        throw "Контрольная сумма не совпадает: $destination"
    }
}

# Reuse the official portable installation, or obtain it with hash/signature checks.
if (!(Test-Path -LiteralPath (Join-Path $portableDir 'ebook-convert.exe') -PathType Leaf)) {
    & (Join-Path $PSScriptRoot 'setup-kindle.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось подготовить Calibre Portable.' }
}
$converter = Join-Path $portableDir 'ebook-convert.exe'
$signature = Get-AuthenticodeSignature -FilePath $converter
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*CN=Kovid Goyal*') {
    throw 'Цифровая подпись встроенного конвертера Calibre не подтверждена.'
}
$version = (& $converter --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $version -notmatch '\b9\.15\.0\b') { throw "Ожидался Calibre 9.15.0: $version" }

Receive-VerifiedFile 'https://download.calibre-ebook.com/9.15.0/calibre-9.15.0.tar.xz' $sourceArchive '9F02D36DECAF46B176A1BEF74349232508BCC2B4B06D1662BBD1FD426C57D559'
New-Item -ItemType Directory -Path $calibreDir -Force | Out-Null
# Keep the complete official runtime: Python, Qt, DLLs and conversion plugins.
Copy-Item -Path (Join-Path $portableDir '*') -Destination $calibreDir -Recurse -Force
Copy-Item -LiteralPath (Join-Path $portableDir 'LICENSE') -Destination (Join-Path $licenseDir 'Calibre-GPL.txt') -Force
Copy-Item -LiteralPath (Join-Path $projectDir 'assets\fonts\OFL-PTSerif.txt') -Destination $licenseDir -Force
Copy-Item -LiteralPath (Join-Path $projectDir 'assets\fonts\OFL-PTSans.txt') -Destination $licenseDir -Force
Write-Output 'Комплект готов: встроенный Calibre 9.15.0, исходный архив и лицензии шрифтов.'
