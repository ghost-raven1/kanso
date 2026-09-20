# Подготовка сложных приложений к миграции

Этот документ разделяет готовые контракты и предстоящую работу. Пакеты Kanso исполняются на Solid; совместимость с React runtime и React-библиотеками не добавляется. Полная миграция приложения включает портирование его UI и проверку поведения.

## Готово в 0.6.1

- Аудит нескольких entries/configs, цепочек Vite re-exports и локальных ESM source packages; явный отчёт охвата и блокировка записи при неполном анализе.
- Точные диагностики React-классов и изменений одного состояния; исправление namespace JSX tags.
- Сброс поддерева через явный key, raw HTML в SSR и клиенте, диагностика известных конфликтов.
- Регрессии компилятора/мигратора и браузерный сценарий SSR → ввод до JS → гидратация → обновление → cleanup.

## Добавлено в 0.7.0

- `useStore` с selector/equality, реактивной заменой источника, server snapshot и автоматической отпиской.
- `defineService` / `useService`: отдельный scope на приложение и SSR-запрос; общий доступ из loaders/actions; явные JSON-снимки для гидратации и навигации; отмена и cleanup.
- Изолированный пример с настоящим `zustand/vanilla`, установка из npm pack, TypeScript, SSR, browser navigation и HMR потребителей. [Контракты и ограничения](services.md).

## Добавлено в 0.7.2

- Проверка runtime entries пакетов с optional React peers: проверенный vanilla subpath проходит `migrate` / `doctor`, React entry блокирует запись.
- Общий resolver исходников, обход условных exports, статических ESM/CommonJS imports и browser replacements; непроверяемый граф остаётся ошибкой.
- Изолированный packed-сценарий с Zustand: миграция без ручной правки исходников, идемпотентность, установка, TypeScript, production build и блокировка корневого React entry. [Границы аудита](migration.md#vanilla-dependencies).

## Следующие этапы

| Приоритет | Что подготовить | Проверяемый результат |
| --- | --- | --- |
| P0.2 | Layout effects, component/callback refs, imperative handles, DOM event types и optional initial ref | DOM ref доступен в нужный момент; нет эффектов на сервере; очистка при unmount; типы currentTarget без any; совместимость с HMR проверена |
| P0.2 | Чистые вычисления и destructuring в map callbacks | Замена объектов с прежними ключами обновляет строки; состояние/фокус сохраняются; неизвестная чистота по-прежнему диагностируется |
| P0.3 | Необязательная Solid UI-основа: темы через CSS variables, Portal, доступные overlay primitives | SSR, обе темы, keyboard/focus trap/return, scroll lock, touch; без скрытого React и без обещания MUI clone |
| P0.3 | Тестовый harness: render/cleanup, reactive props, router/services providers | Одни сценарии запускаются до и после переноса; queries и browser tests сохраняются; React act не имитируется |
| P1 | History/search/scroll и dirty navigation guard; контроллер форм для существующего HTTP API | Back/forward и replace сохраняют ожидаемый URL/state; draft не теряется; validation/reset, upload progress/cancel и частичные ошибки проверены |
| P1 | Внешняя invalidation HTML-кеша и прикладные cancellable subscriptions | Событие backend сбрасывает нужный кеш; поздний результат не восстанавливает закрытую страницу; cookie/session state остаётся в request scope |
| P1 | Инструменты портирования federation exposes/shared contracts и расширения native Service Worker events | Старый документ использует закреплённый выпуск; обновление не теряет draft; retry/rollback не исполняет action другой версии |
| P2 | Обёртки editor/motion и оставшиеся специализированные UI-контракты | Реальные пользовательские операции, cleanup, accessibility и формат данных сохраняются |

Это очередь разработки, а не доступные API. Имена будущих lifecycle/UI функций нужно закреплять исполнимой спецификацией перед реализацией. Существующий `createStore` сохраняет контракт Solid; стороннее хранилище подключается отдельным binding. Политику auth, прав доступа, replay offline-мутаций и транспорт backend определяет приложение.

## Первая вертикальная приёмка

Подготовить нейтральный SSR-пример «список публикаций → статья» с loader, SEO, общими settings, изображениями и независимым remote. Затем добавить каталог и форму с незавершённым draft. Большой редактор не должен быть первым проверочным приложением.

Для каждого примера: исходный HTML с данными/SEO, empty/error/404/redirect, back/forward, сохранение DOM и ввода при гидратации, отсутствие повторного initial loader, изоляция параллельных запросов, отмена подписок и поздних ответов. Remote A/B/rollback проверяются без пересборки оболочки. Установка выполняется из npm pack вне workspace; TypeScript, production build и Chromium/Firefox/WebKit обязательны. Оценки производительности публикуются только после измерения.

Первый этап не требует переноса конкретного стороннего приложения. Материалы частных обследований, исходники и предметные данные в публичные fixtures не включаются.
