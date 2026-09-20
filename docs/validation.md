# Проверка реализации — 20 сентября 2026

Версия Kanso 0.8.0. Исходники опубликованы в [публичном репозитории](https://github.com/ghost-raven1/kanso), основная ветка — main. Пакеты в npm не опубликованы, production-сервер не развёртывался. [GitHub Actions](https://github.com/ghost-raven1/kanso/actions/workflows/ci.yml) запускает контракты, production SSR, Chromium/Firefox/WebKit и проверку миграции/HMR на Ubuntu; результат каждого запуска привязан к SHA коммита.

## Lifecycle, миграция и восстановление 0.8.0

`npm run check`: 298/298 Vitest, TypeScript, production-сборки и проверка отсутствия React и лишнего runtime. Новые проверки покрывают layout timing, очистку object/callback refs, imperative handles с одинаковыми зависимостями, именованные forwardRef-компоненты, вложенный setup строк, затенённые функции, безопасные config helpers и отказ от записи при source mappings.

Локально Chromium/WebKit проходят лабораторию (включая ввод до гидратации и восстановление маршрута), формы с включённым/выключенным/отложенным JavaScript, SSR stores/services, HMR refs/эффектов/нескольких экземпляров, JSX compatibility, миграцию React fixtures, packed CSR/SSR templates и независимые выпуски/откат микрофронтов. В React profile fixture теперь используются настоящие forwardRef/useImperativeHandle/useLayoutEffect до и после миграции. Ошибка смены выпуска проверяется без повторного POST и без удаления ввода; шаблон SSR отклоняет старую сборку preview и возобновляет ответы после восстановления manifest.

Firefox локально не запускается из-за ошибки установленного браузера `Could not find profile folder`; это не успешный результат браузерных сценариев. Все три движка остаются обязательными в Linux CI, включая новые проверки в существующих командах `test:browser`, `test:hmr` и `test:dx`.

## Аудит vanilla entries 0.7.2

`tests/dependency-audit.test.ts` закрепляет aliases/barrels, optional и обязательные peers, runtime/type-only imports, ESM/CommonJS и package imports, условные exports, browser replacements, вложенные установки, циклы и блокировку неполного графа. Локально `npm run check` прошёл: 281/281 Vitest, TypeScript, production builds и отсутствие React/federation/HMR в обычном production-графе.

`test:services` теперь устанавливает также упакованные CLI/Vite. На настоящем Zustand 5.0.15 проходят `migrate --check`, `--apply`, повторный apply без diff, `doctor`, новая установка, TypeScript и Vite build. Замена импорта на React entry даёт exit code 2 в обеих командах; package.json остаётся неизменным. После этого прежние packed SSR/hydration/navigation/cleanup сценарии проходят в Chromium и WebKit локально; Firefox включён в тот же сценарий CI. Отчёт с отдельной записью `packed-vanilla-audit` сохраняется в `output/services/results.json` и CI artifact.

## Исправление навигации 0.7.1

Дополнительная проверка обнаружила гонку, отсутствовавшую в приёмке 0.7.0: revalidation во время подготовки маршрута отменяла переход, а во время ожидания его данных могла запрашивать прежний URL. `tests/navigation.test.ts` воспроизводит первый случай; packed browser-сценарий в `test:services` — второй. Обновление данных теперь сохраняет намерение навигации и использует URL назначения. Локально прошли 245/245 Vitest, TypeScript, production builds и браузерные сценарии stores/web/lab в Chromium и WebKit, включая обе новые регрессии.

Зелёный CI подтверждает перечисленные сценарии, а не полную совместимость любого приложения. Отдельно проверяется рабочий браузер: старый Service Worker на повторно использованном локальном origin может подменять HTML и chunks даже при корректном сервере. Для такого случая лаборатория запускается на отдельном origin; инструкции приведены в README.

## Внешние stores и сервисы 0.7

`tests/external-store.test.ts`, `tests/services.test.ts`, `tests/services-server.test.ts` и type fixtures закрепляют selector/equality, замену источника, race при регистрации, изоляцию, явную сериализацию, зависимости, disposal, native actions, lazy SSR, HEAD/redirect/error/timeout и отсутствие кеширования при ошибке cleanup.

`npm run test:services` устанавливает tarballs Kanso и Zustand 5.0.15 вне workspace, без React в lockfile. Проверяет TypeScript, production SSR, server snapshot, исходный DOM/ввод, отсутствие повторного initial loader, общие экземпляры, back/forward, revalidation и устаревшие ответы. Отчёт — `output/services/results.json`; сценарий входит в `test:compatibility`, которую запускают CI и Dockerfile.test. Копия результата сохраняется в существующий CI artifact `output/browser/services-results.json`. HMR suite дополнительно проверяет сохранение внешнего сервиса при правке потребителя и снятие его подписки при unmount.

Локально прошли `npm run check` (244/244 Vitest, TypeScript, production builds, dependency audit), stores/lab/compatibility/HMR/web в Chromium и WebKit и SEO CLI. Все три браузера проверяет отдельный CI-запуск для SHA выпуска.

API описано в [руководстве](services.md). Поддержка runtime не означает автоматической миграции React hooks Zustand; проверка vanilla entries расширена в 0.7.2.

## Подготовка миграции 0.6.1

`tests/migration-precision.test.ts`, `tests/migration-graph.test.ts` и `tests/jsx-compatibility.test.ts` проверяют классы/bindings, несколько entries/configs, статические переэкспорты, source packages, no-write/idempotence, key reset и raw HTML. `npm run test:compatibility` собирает независимые серверный и клиентский outputs и проверяет исходный HTML, DOM identity, ввод до гидратации, useId, соседние экземпляры и cleanup в Chromium/Firefox/WebKit. Этот сценарий включён в CI.

Оставшиеся контракты отделены от реализованных в [плане подготовки](migration-readiness.md). Наличие отчёта полного охвата графа не означает, что приложение прошло проверку совместимости.

## Микрофронты и workers 0.6

- Финальный локальный `npm run check` проверяет семь пакетов: сборка, TypeScript, **207/207 Vitest**, production-сборки лаборатории и каталога, форматирование 62 файлов примеров. Аудит 247 записей lockfile не обнаружил React или React DOM.
- `npm run test:microfrontends` собирает оболочку и два remote на разных origins. Проверяет SSR/SEO, Context, useId, исходный DOM и ввод, loaders, enhanced/native forms, версии A/B, откат и восстановление загрузки.
- `npm run test:microfrontends-dev` проверяет SSR development и HMR двух экземпляров: сохранение состояния, новые обработчики, Context, сброс при смене hooks и исправление ошибки компиляции.
- `npm run test:microfrontends-dx` устанавливает tarball-пакеты в изолированные проекты обоих новых шаблонов. Проверяет TypeScript, клиентскую/серверную сборку, контракты и разделение публичных и приватных файлов.
- `npm run test:workers` проверяет RPC, concurrent calls, cancellation, transferables, ошибки и terminate в браузерах. `npm run test:service-workers` проверяет явную регистрацию и активацию, версии кеша, offline fallback и исключение приватных данных/форм из кеша.
- Локальные browser-прогоны выполнены в Chromium и WebKit на macOS. Linux-контейнер дополнительно прошёл 11 production-сценариев микрофронтов и development/HMR в Chromium, Firefox и WebKit. Полный CI проверяется отдельно для SHA выпуска.
- Обычные приложения не включают federation runtime; production/SSR не включают Kanso HMR. React-зависимости миграционных эталонов остаются вне lockfile фреймворка.

## Веб-приложения 0.5

- `npm run test:web` упаковывает все семь пакетов, устанавливает их в отдельную копию каталога и выполняет TypeScript и production build без workspace symlinks.
- Chromium и WebKit на macOS прошли каталог с JavaScript, без JavaScript и с задержанной гидратацией: GET-фильтры, история, SEO/JSON-LD, 422, восстановление полей и checkbox, submitter, PRG и отсутствие повторного POST при обновлении подтверждения.
- Проверены конкурирующие переходы, отклонение устаревших данных, ошибка revalidation с сохранением страницы, повторное обновление и мобильная ширина 390 px. Отчёт: `output/web/results.json`.
- Упакованный SSR-шаблон проверяется в dev и production: native 422/200, JS validation, сохранённая action при ошибке revalidation и retry без повторного POST. Отчёт: `output/dx/results.json`.
- Vitest проверяет серверный POST с params/query, несколько форм и генерируемые ID, escaping, cookies/redirect, HEAD, изоляцию запросов, отсутствие POST-кеша и его инвалидацию только после успеха. DOM-контракты проверяют pending/phase, retry, поздние ответы после cleanup и смену параметров без повторного setup.
- TypeScript проверяет route IDs, вложенные параметры, splats, inferred handlers и результаты без Response. Форматирование примеров и исходников шаблонов проверяется отдельным `check:format`.
- CI выполняет новые и прежние сценарии в Chromium, Firefox и WebKit. Статус конкретного выпуска подтверждается зелёным запуском для его SHA, а не только локальным результатом. Firefox для 0.5 проверяется в Linux CI; локальные наблюдения macOS ниже не заменяют этот запуск.

## Исторические результаты до расширения 0.4–0.6

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

Доступна версия 0.7 с перечисленными контрактами, HMR, CSR/SSR-шаблонами и проверяемым мигратором. Это не утверждение о полной совместимости произвольного React-кода или всей экосистемы. Ограничения hooks, типов, map callback, управления потоком и границ HMR перечислены в semantics.md, migration.md и dx.md. При обновлении родителя HMR может пересоздать дочернее поддерево; сохранение DOM и фокуса при HMR не гарантируется.
