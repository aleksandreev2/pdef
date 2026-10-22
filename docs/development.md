# Разработка и сборка

[← На главную](../README.md) · [Как участвовать](../CONTRIBUTING.md)

## Запуск

Нужны Git и Node.js 20 или новее. Проверенная платформа установщика — Windows
10 / 11 x64. Разработка на других платформах требует отдельной проверки;
готовый установщик предназначен для Windows.

```bash
git clone https://github.com/aleksandreev2/pdef.git
cd pdef
npm ci
npm run fonts
npm start
```

`npm run dev` открывает приложение с DevTools. Шрифты PT Serif и PT Sans
скачиваются из Google Fonts вместе с лицензиями OFL. Если шрифты не подготовлены,
приложение использует системные кириллические шрифты и сообщает об этом в отчёте.

## Конвертер Kindle

При запуске из исходников MOBI и AZW3 требуют Calibre. На Windows можно подготовить
официальный переносимый конвертер:

```bash
npm run kindle-tools
```

Скрипт загружает Calibre Portable 9.15.0, проверяет SHA-256 и цифровую подпись
Kovid Goyal, распаковывает в `%USERPROFILE%\.pdfmaker`. Дальнейшая конвертация
не требует интернета. Другой вариант — установить
[Calibre](https://calibre-ebook.com/download_windows).

Для нестандартного расположения задайте `PDFMAKER_CALIBRE` с полным путём к
`ebook-convert.exe` (на Linux / macOS — `ebook-convert`). FB2 и TXT создаются
самим приложением и не требуют Calibre.

## Сборка установщика

Команда выполняется на Windows:

```bash
npm run dist
```

Сборка готовит шрифты с лицензиями, полный runtime Calibre 9.15.0, текст GPL
и соответствующий архив исходников. Загрузки проверяются по закреплённым
контрольным суммам; конвертер также проверяется по цифровой подписи.

Результат: **`dist/PDFMaker-Mobile-3.3.2-Setup.exe`**. Приложение устанавливается
для текущего пользователя, создаёт ярлыки и сохраняет данные настроек при обновлении.
Встроенный конвертер находится в `resources/calibre`; лицензии и исходники
Calibre — в `resources/licenses`. В пользовательский релиз входят установщик
и файл `SHA256SUMS.txt`.

Архив исходников без `node_modules`, готовых книг и скачанного runtime Calibre:

```bash
npm run pack -- --out output
npm run pack -- --no-fonts --out output
```

## Проверки

```bash
npm test
npx electron scripts/audit-smoke.js
npx electron scripts/updates-smoke.js
```

Автоматические тесты проверяют импорт, экспорт, оформление, иллюстрации,
предупреждения и обновления. Сценарии Electron используют скрытые окна:
аудит проверяется с реальными исходниками, обновления — с имитацией ответа
GitHub и запуска установщика.

Полный сценарий интерфейса с образцом книги:

```bash
npx electron scripts/smoke.js --in "папка с главами" --out output/smoke --shots output/screenshots
```

Проверка распакованной Windows-сборки с отдельным профилем и экспортом всех
шести форматов:

```powershell
& '.\dist\win-unpacked\PDFMaker Mobile.exe' --installation-check 'C:\полный\путь\к\папке\проверки'
```

Результат — `installation-check.json`, предпросмотр и тестовая книга в указанной
папке. Этот режим не использует пользовательские исходники и настройки.

Образцы жанров и отрисовка страниц PDF:

```bash
node scripts/genre-samples.js --out output/genre-samples
npx electron scripts/preview.js --pdf "книга.pdf" --out output/preview --pages 2,3,14
```

## Командная строка

CLI использует тот же пайплайн, что и приложение:

```bash
node scripts/cli.js --in "папка с главами" --out output --title "Название книги"
```

По умолчанию сохраняются PDF и EPUB. `--only` принимает `pdf`, `epub`, `fb2`,
`mobi`, `azw3`, `txt` или `all`. Оформление задаётся через `--genre`:
`fantasy`, `dark-fantasy`, `horror`, `sci-fi`, `litrpg`, `romance`, `historical`,
`thriller`, `cultivation`, `regression`, `erotica`.

Две версии книги со сжатыми иллюстрациями:

```bash
node scripts/cli.js --in "главы.zip" --out output --title "Название" --illustrations both --image-compression balanced
```

`--illustrations`: `with`, `without`, `both`. `--image-compression`: `off`,
`balanced`, `strong`. Обложка сохраняется по умолчанию;
`--no-cover` отключает её в версии без изображений.

## Устройство кода

```text
src/main/         окно Electron, диалоги, IPC, настройки и обновления
src/renderer/     интерфейс и PDF-предпросмотр
src/core/
  import/         чтение исходных файлов, книг, папок и ZIP
  parse/          нормализация текста, заголовки и системные блоки
  audit.js        аудит состава книги
  illustrations.js  варианты издания и сжатие ресурсов
  genres.js       жанровые профили
  artwork/        векторные орнаменты
  pdf/            набор, разметка и отрисовка PDF
  epub/           XHTML, CSS и упаковка EPUB 3
  export/         FB2, TXT и конвертация Kindle
  qa/             проверка готовых файлов
  pipeline.js     единая модель книги и сборка выбранных форматов
tests/            автоматические проверки
scripts/          CLI, сборка, подготовка ресурсов и проверки интерфейса
```

Книга разбирается один раз в общую модель. Все форматы используют выбранный
порядок разделов. Конвертация MOBI и AZW3 выполняется последовательно,
чтобы не удваивать потребление памяти на длинных книгах.

## Выпуск новой версии

1. Обновите версию в `package.json` и `package-lock.json`, CHANGELOG и документацию.
2. Выполните тесты и проверку интерфейса, соберите и проверьте Windows-установщик.
3. Рассчитайте SHA-256 установщика и создайте `SHA256SUMS.txt`.
4. Создайте стабильный GitHub Release с тегом `vX.Y.Z` и прикрепите установщик,
   контрольную сумму и архив исходников.

Обновление в приложении использует публичный endpoint
[`releases/latest`](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
репозитория `aleksandreev2/pdef`. Черновики и предварительные релизы пользователям
не предлагаются. Имя установщика должно быть `PDFMaker-Mobile-X.Y.Z-Setup.exe`;
для его загрузки приложение требует размер и SHA-256 в метаданных asset GitHub.
Одного файла контрольных сумм без `digest` в API недостаточно.
