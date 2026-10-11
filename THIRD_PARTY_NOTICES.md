# Сторонние компоненты

Лицензия [MIT](LICENSE) относится к коду PDFMaker Mobile. Сторонние компоненты
сохраняют приведённые ниже лицензии и авторские уведомления.

| Компонент | Лицензия и авторство | Где находится полный текст |
| --- | --- | --- |
| PT Serif, PT Sans | SIL Open Font License 1.1; © 2010 ParaType Ltd. | [PT Serif](assets/fonts/OFL-PTSerif.txt), [PT Sans](assets/fonts/OFL-PTSans.txt) |
| Calibre 9.15.0 | GNU GPL v3; Kovid Goyal и участники проекта | В Windows-сборке: `resources/licenses/Calibre-GPL.txt` и архив исходников `calibre-9.15.0.tar.xz` |
| Схема FictionBook | BSD-2-Clause; © 2004 Dmitry Gribov | [Лицензия схемы FB2](assets/schemas/fb2/LICENSE.md) |
| Electron и Chromium | Лицензия Electron и уведомления компонентов Chromium | В установленной программе: `LICENSE.electron.txt`, `LICENSES.chromium.html` |
| Библиотеки JavaScript и нативные модули | Собственные лицензии пакетов | Файлы LICENSE / NOTICE соответствующих пакетов в `node_modules`, в сборке — внутри `resources/app.asar` или `app.asar.unpacked` |

Calibre используется как отдельный локальный конвертер. Windows-установщик
включает официальный runtime без изменений, его лицензии и соответствующий
архив исходников. Собственные уведомления библиотек Calibre находятся в
`resources/calibre`. Скрипт подготовки проверяет контрольные суммы загрузок
и цифровую подпись конвертера.

Источники: [Calibre](https://calibre-ebook.com/),
[официальный выпуск Calibre 9.15.0](https://download.calibre-ebook.com/9.15.0/),
[Google Fonts — PT Serif](https://github.com/google/fonts/tree/main/ofl/ptserif),
[Google Fonts — PT Sans](https://github.com/google/fonts/tree/main/ofl/ptsans),
[схема FictionBook](https://github.com/gribuser/fb2).

Версии зависимостей закреплены в [package-lock.json](package-lock.json).
В комплект установщика также входит [уведомление о стороннем ПО](build/THIRD-PARTY-NOTICES.txt).
