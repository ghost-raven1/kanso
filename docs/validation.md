# Проверка реализации — 20 сентября 2026

Версия Kanso 0.5.0. Исходники опубликованы в [публичном репозитории](https://github.com/ghost-raven1/kanso), основная ветка — main. Пакеты в npm не опубликованы, production-сервер не развёртывался. [GitHub Actions](https://github.com/ghost-raven1/kanso/actions/workflows/ci.yml) запускает контракты, production SSR, Chromium/Firefox/WebKit и проверку миграции/HMR на Ubuntu; результат каждого запуска привязан к SHA коммита.

## Веб-приложения 0.5

- `npm run test:web` упаковывает все пять пакетов, устанавливает их в отдельную копию каталога и выполняет TypeScript и production build без workspace symlinks.
- Chromium и WebKit на macOS прошли каталог с JavaScript, без JavaScript и с задержанной гидратацией: GET-фильтры, история, SEO/JSON-LD, 422, восстановление полей и checkbox, submitter, PRG и отсутствие повторного POST при обновлении подтверждения.
- Проверены конкурирующие переходы, отклонение устаревших данных, ошибка revalidation с сохранением страницы, повторное обновление и мобильная ширина 390 px. Отчёт: `output/web/results.json`.
- Упакованный SSR-шаблон проверяется в dev и production: native 422/200, JS validation, сохранённая action при ошибке revalidation и retry без повторного POST. Отчёт: `output/dx/results.json`.
- Vitest проверяет серверный POST с params/query, несколько форм и генерируемые ID, escaping, cookies/redirect, HEAD, изоляцию запросов, отсутствие POST-кеша и его инвалидацию только после успеха. DOM-контракты проверяют pending/phase, retry, поздние ответы после cleanup и смену параметров без повторного setup.
- TypeScript проверяет route IDs, вложенные параметры, splats, inferred handlers и результаты без Response. Форматирование примеров и исходников шаблонов проверяется отдельным `check:format`.
- CI выполняет новые и прежние сценарии в Chromium, Firefox и WebKit. Статус конкретного выпуска подтверждается зелёным запуском для его SHA, а не только локальным результатом. Firefox для 0.5 проверяется в Linux CI; локальные наблюдения macOS ниже не заменяют этот запуск.

## Подтверждённые результаты

- npm run check: сборка пяти пакетов, TypeScript, **74/74 Vitest**, клиентская и серверная production-сборки, аудит lockfile — успешно.
- В lockfile проверены 228 записей: React, React DOM, reconciler и React Compiler отсутствуют. Маркеры server-only implementation и Kanso HMR отсутствуют в production-чанках.
- npm run test:tooling: собственный React+Vite fixture мигрирован, результат идемпотентен; выполнены npm install, TypeScript, production build, HMR компонента и пользовательских hooks из отдельных .ts/.js-файлов. Проверены переэкспорт, alias и вложенный JavaScript-hook. Попытка импортировать .server.ts в браузер блокирует сборку.
- Chromium и WebKit прошли проверки на macOS. Для предыдущего выпуска 0.4 все три движка прошли production-набор в Linux-контейнере: chromium 153.0.8010.12, firefox 155.0, webkit 26.6.
- Для каждого браузера проверены: сохранение DOM при hydration; ввод до JavaScript; отсутствие повторного initial loader; точечные обновления; ключи, состояние и фокус; cleanup; validation/action/revalidation; lazy route и direct SSR; mobile overflow; сохранение HTML при недоступном JS.

Firefox на macOS 27 не стартовал через subprocess из-за [известной проблемы Mozilla](https://bugzilla.mozilla.org/show_bug.cgi?id=2060476). Проверка выполнена на настоящем Firefox в официальном Linux-образе Playwright. WebKit означает движок Playwright, а не проверку установленного Safari.

## Миграция и разработка 0.4

- `npm run test:dx` выполняет пользовательские сценарии трёх React + Vite приложений: профиль (Context, формы, refs, useId), каталог (вложенные props, rest, фильтр и ключи), custom hooks (aliases, переэкспорты и вложенные вызовы). Затем применяет миграцию, проверяет её идемпотентность и повторяет сценарии после установки, TypeScript и production build.
- Пять пакетов проверяются через `npm pack` и установку tarballs в изолированные приложения. React устанавливается только в fixtures; после миграции его нет в lockfile этих приложений. Упакованные CSR/SSR-шаблоны проходят doctor, typecheck и build.
- SSR-шаблон проверяется в development и production: HTML и SEO без JavaScript, сохранение DOM input, значения и ID при гидратации, отсутствие повторного loader-запроса. Проверены реальные exit codes doctor: 0, 2, 1.
- `npm run test:hmr` проверяет отдельное состояние экземпляров и keyed-строк, JSX и custom hooks, новую реализацию reducer, refs, useId, cleanup, несовместимую сигнатуру, восстановление после ошибки без reload и удаление состояния при unmount. Отдельно проверяются `remount` и отключённый HMR.
- Контракты Vitest включают shadowed bindings, вложенные patterns/defaults/rest, primitive/object Context, статические aliases, унаследованный JSX config, исходные позиции диагностик и отказ от записи при несовместимости. TypeScript дополнительно проверяет тип DOM refs, включая ожидаемую ошибку несовместимого элемента.
- Команды сохраняют отчёты в `output/dx/results.json` и `output/hmr/results.json`; GitHub Actions прикладывает их к запуску. Dockerfile.test запускает production-браузеры, HMR и DX в Chromium, Firefox и WebKit.

## SEO 0.3

- Проверены metadata merge/null, шаблоны, canonical, OG images, hreflang, безопасный JSON-LD, наследование route/JSX и disposal ошибочной SSR-ветки.
- Параллельный lazy SSR сохраняет раздельные заголовки и JSON-LD. Robots и sitemap не вызывают loaders; проверены 50 001 URL, поколения частей, forced noindex, HEAD, таймаут и восстановление provider.
- npm run test:seo проверяет пять production-страниц, sitemap и реальные CLI exit codes: ошибки — 2, предупреждения — 0, сбой команды — 1.
- Браузерные сценарии дополнены принятием SSR head-узлов, реактивным SEO, JSON-LD cleanup, параметрами маршрута, историей назад/вперёд и отклонением устаревшего ответа.

## Production benchmark — исходная версия 0.1.0

Среда: Apple M1 Pro, darwin 27.0.0, Node v20.19.5, Chromium 153.0.8010.12. Solid 1.9.15, React 19.3.0, React Compiler 1.0.0. Запись: 2026-09-19T07:43:25.292Z.

Пять свежих browser contexts на вариант, 500 виджетов, 100 обновлений одного значения родительского состояния, влияющего на одну строку. DOM и переходы состояния эквивалентны. Все сборки minified production. React установлен только во внешнем fixture, с отдельными package.json, lockfile и node_modules. Проверено, что вариант React Compiler действительно содержит compiler-runtime и скомпилированный кеш.

| Вариант | JS gzip, KiB | Script CPU за 100 обновлений, ms | p95 click → DOM, ms | FCP / LCP, ms |
| --- | ---: | ---: | ---: | ---: |
| kanso | 5.75 | 1.24 | 0.10 | 32 / 32 |
| solid | 5.76 | 1.05 | 0.10 | 32 / 32 |
| react | 67.82 | 19.45 | 0.40 | 56 / 56 |
| react-memo | 67.82 | 14.80 | 0.40 | 60 / 60 |
| react-compiler | 68.09 | 20.85 | 0.40 | 52 / 52 |

В таблице медианы пяти прогонов. CPU — разность CDP ScriptDuration до/после серии; TaskDuration также сохранён в JSON. Latency измерена от программного click до DOM mutation, без ожидания paint. Это не field INP. Значения меньше разрешения браузерного таймера могут округляться до нуля, поэтому не трактуются как нулевая стоимость.

FCP/LCP измерены для этих небольших CSR-эталонов на локальном HTTP без CPU/network throttling. Это лабораторные paint observations, не Lighthouse и не сравнение SSR/реальных приложений. Порядок вариантов фиксирован; абсолютные числа чувствительны к среде. Один workload не доказывает универсальное ускорение. Здесь Kanso близок к Solid, а React Compiler не устраняет всю работу выбранного обновления родителя со списком.

Исходные, преобразованные и production benchmark-файлы, все samples и версии сохраняются командой npm run bench в output/benchmark/. Полная лаборатория с router/forms/SSR имеет другой размер, чем эти небольшие эталоны.

## Граница готовности

Доступна версия 0.5 с перечисленными контрактами, HMR, CSR/SSR-шаблонами и проверяемым мигратором. Это не утверждение о полной совместимости произвольного React-кода или всей экосистемы. Ограничения hooks, типов, map callback, управления потоком и границ HMR перечислены в semantics.md, migration.md и dx.md. При обновлении родителя HMR может пересоздать дочернее поддерево; сохранение DOM и фокуса при HMR не гарантируется.
