# Kanso studio — каталог и заявка

Пример Kanso 0.5: GET-фильтры → карточка товара → серверная валидация → POST/Redirect/GET. SEO и JSON-LD находятся в исходном HTML; форма работает без JavaScript и сохраняет ввод при ошибках.

Из корня репозитория:

```sh
npm ci
npm run build
npm run build:catalog
npm run preview:catalog
# http://127.0.0.1:4175
```

Для разработки: `npm run dev:catalog`. SSR работает и в development. Пакеты в npm не опубликованы; устанавливаемость независимой копии проверяет `npm run test:web` через `npm pack` всех пяти пакетов.

Настройте `VITE_SITE_URL` перед production-сборкой. Node adapter в примере настроен на `http://127.0.0.1:$PORT`; для другого адреса задайте соответствующий origin в `scripts/serve.mjs`.

- `src/routes.tsx` — дерево и типизированные адреса.
- `src/pages/` — читаемые TSX-страницы.
- `src/handlers.server.ts` — loaders, явная валидация и redirect.
- `src/catalog/requests.server.ts` — интерфейс `RequestStore` и демонстрационная реализация в памяти.
- `src/seo.config.ts` — общая SEO-конфигурация.

Это демонстрационное хранилище: заявки исчезают при перезапуске и не отправляются по email. Для приложения замените `RequestStore` собственным постоянным хранилищем. Контактные данные не показываются по публичному URL подтверждения. Оплаты и авторизации в примере нет.
