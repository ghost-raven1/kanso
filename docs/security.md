# Границы безопасности

## Запросы и actions

`nodeHandler(handler, origin)` использует явно настроенный HTTP(S) origin.
Host, Forwarded и абсолютный request-target не заменяют его. Настройте внешний
origin при работе через reverse proxy; сам прокси должен ограничивать допустимые hosts.

Перед разбором POST и вызовом Context/handlers Kanso проверяет источник:

- `Sec-Fetch-Site: cross-site` отклоняется;
- переданный `Origin` должен точно совпасть с origin запроса, `null` отклоняется;
- при отсутствии Origin проверяется Referer, затем `Sec-Fetch-Site: same-origin`;
- cookie-запрос без подтверждённого same-origin и `same-site` без Origin/Referer отклоняются;
- серверный клиент без cookies и browser-origin заголовков может выполнить POST.

Это защита браузерного транспорта, не аутентификация и не проверка прав. Каждый action
по-прежнему должен проверять пользователя, доступ к объекту и поля ввода. CORS или знание
build ID не дают право на действие. Методика — [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

`createRequestHandler({ maxBodyBytes })` ограничивает POST до разбора multipart/formData,
включая chunked-поток. По умолчанию 1 MiB; превышение возвращает 413. Для файлов задайте
нужный конечный лимит явно или используйте отдельный upload endpoint. Лимит действует
на байты тела, не является антивирусной проверкой и не заменяет rate limits на сервере.
`timeoutMs` ограничивает ожидание. Обработчики должны учитывать `signal` при внешнем I/O.

`redirect()` и native/enhanced transport принимают относительные пути и HTTP(S) URL без
credentials; активные схемы вроде `javascript:` отклоняются. Внешние HTTP redirects
поддерживаются для авторизации/платежей. Если адрес поступает от пользователя, приложение
должно дополнительно разрешать только нужные origins и пути.

## HTML, данные и кеш

Bootstrap и JSON-LD экранируются для `<script>`, SEO-текст и атрибуты — для HTML.
Loader data, возвращённые action values и service snapshots **публичны для браузера**:
не помещайте туда секреты, session tokens или приватную серверную конфигурацию.
`dangerouslySetInnerHTML` намеренно не санитизирует HTML. Для недоверенного rich text
нужен санитайзер приложения; обычные значения выводите через JSX text bindings.
Недоверенные `href`/`src` также требуют проверки схем и допустимых ресурсов приложением.

Общий HTML-кеш включается только явным `cache.public`, исключает Cookie/Authorization,
разделяется по origin, пути/query, build/release и `vary` заголовкам. Не объявляйте public
страницы с данными пользователя. Другие признаки персонализации (например, собственный
tenant header) должны входить в `vary`. Ошибки loaders/redirects не сохраняются в HTML-кеше.

CSP, frame-ancestors, HTTPS, cookies и rate limiting задаются сервером приложения/edge.
Kanso пока не предоставляет общий nonce API для hydration script: строгую CSP нужно
проверять с фактическим HTML выбранной сборки. Не отключайте CSP ради стороннего кода.
Наличие этих защит на production-серверах не следует из локальных проверок фреймворка.

## Микрофронты, workers и зависимости

Удалённые модули доверенные: server remote выполняется с правами процесса оболочки,
client remote — с правами origin. Совместимость версии и закрепление релиза не являются
песочницей или криптографической проверкой издателя. Размещайте manifests/artifacts на
контролируемых адресах, используйте HTTPS, сохраняйте неизменяемые releases. Клиентские
pins выбирают build ID только внутри настроенных источников; не передавайте пользовательские
URL в конфигурацию источников. CLI проверяет пути деклараций и symlinks до записи.

Worker RPC исполняет только собственные именованные handlers. Входные данные задач
валидирует приложение. Service Worker по умолчанию обходит mutations, HTML, JSON,
защищённые endpoints и непубличные ответы. Пользовательский `onMessage` требует собственной
проверки формата и полномочий отправителя. Обновление SW активируется явно.

На 20 сентября 2026 Module Federation DTS plugin закрепляет `adm-zip@0.6.0` с известными
[уязвимостями обработки ZIP](https://github.com/advisories/GHSA-7q85-xj36-vmfc).
Kanso отключает federation DTS (`dts: false`) и получает типы через собственный JSON
transport. Workspace и новые CLI-шаблоны закрепляют исправление через root override:

```json
{
  "overrides": {
    "@module-federation/dts-plugin": { "adm-zip": "0.6.1" }
  }
}
```

Overrides библиотеки не наследуются потребителем. Для существующего проекта добавьте
это поле в его корневой package.json, обновите lockfile и выполните `npm audit`.
Не используйте автоматический downgrade federation, предложенный audit, без проверки SSR.
