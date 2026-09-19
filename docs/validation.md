# Проверка реализации — 19 сентября 2026

Версия Kanso 0.2.0. Исходники опубликованы в [публичном репозитории](https://github.com/ghost-raven1/kanso), основная ветка — main. Пакеты в npm не опубликованы, production-сервер не развёртывался. [GitHub Actions](https://github.com/ghost-raven1/kanso/actions/workflows/ci.yml) запускает контракты, production SSR, Chromium/Firefox/WebKit и проверку миграции/HMR на Ubuntu; результат каждого запуска привязан к SHA коммита.

## Подтверждённые результаты

- npm run check: сборка пяти пакетов, TypeScript, **36/36 Vitest**, клиентская и серверная production-сборки, аудит lockfile — успешно.
- В lockfile проверены 217 записей: React, React DOM, reconciler и React Compiler отсутствуют. Маркер server-only implementation отсутствует в клиентских чанках.
- npm run test:tooling: собственный React+Vite fixture мигрирован, результат идемпотентен; выполнены npm install, TypeScript, production build, HMR компонента и пользовательских hooks из отдельных .ts/.js-файлов. Проверены переэкспорт, alias и вложенный JavaScript-hook. Попытка импортировать .server.ts в браузер блокирует сборку.
- Chromium и WebKit прошли проверки на macOS. Все три движка прошли тот же production-набор в Linux-контейнере: chromium 153.0.8010.12, firefox 155.0, webkit 26.6.
- Для каждого браузера проверены: сохранение DOM при hydration; ввод до JavaScript; отсутствие повторного initial loader; точечные обновления; ключи, состояние и фокус; cleanup; validation/action/revalidation; lazy route и direct SSR; mobile overflow; сохранение HTML при недоступном JS.

Firefox на macOS 27 не стартовал через subprocess из-за [известной проблемы Mozilla](https://bugzilla.mozilla.org/show_bug.cgi?id=2060476). Проверка выполнена на настоящем Firefox в официальном Linux-образе Playwright. WebKit означает движок Playwright, а не проверку установленного Safari.

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

Доступна работающая версия 0.2 с перечисленными контрактами, пользовательскими hooks и проверяемым мигратором. Это не утверждение о полной совместимости произвольного React-кода или всей экосистемы. Ограничения форм параметров/возврата hooks, Context, типов, map callback и управления потоком перечислены в semantics.md и migration.md.
