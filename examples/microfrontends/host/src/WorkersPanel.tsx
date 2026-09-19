import { useEffect, useId, useMemo, useRef, useState } from '@kanso/core';
import { createWorker } from '@kanso/workers';
import {
  createServiceWorker,
  type ServiceWorkerStatus,
} from '@kanso/workers/service';
import { serviceWorkerUrl } from 'virtual:kanso/service-worker';
import type { SearchMatch, tasks } from './search.worker';
import styles from './WorkersPanel.module.css';

const catalogSize = 240_000;
const batchSize = 4_000;

const serviceLabels: Record<ServiceWorkerStatus, string> = {
  disabled: 'Отключён в development',
  unsupported: 'Недоступен в этом браузере',
  idle: 'Не зарегистрирован',
  registering: 'Регистрация…',
  installing: 'Установка…',
  ready: 'Готов',
  'update-available': 'Доступна новая версия',
  activating: 'Активация…',
  error: 'Ошибка регистрации',
  disposed: 'Контроллер остановлен',
};

/** Browser tasks are lazy and owned by this panel; SSR starts neither worker. */
export default function WorkersPanel() {
  const searchId = useId();
  const search = useMemo(
    () =>
      createWorker<typeof tasks>(
        () =>
          new Worker(new URL('./search.worker.ts', import.meta.url), {
            type: 'module',
            name: 'kanso-catalog-search',
          }),
      ),
    [],
  );
  const service = useMemo(() => createServiceWorker(serviceWorkerUrl), []);
  const activeSearch = useRef<AbortController | null>(null);
  const [query, setQuery] = useState('camera');
  const [pending, setPending] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [matches, setMatches] = useState(0);
  const [preview, setPreview] = useState<SearchMatch[]>([]);
  const [searchStatus, setSearchStatus] = useState('Готов к поиску');
  const [clicks, setClicks] = useState(0);
  const [serviceStatus, setServiceStatus] =
    useState<ServiceWorkerStatus>('idle');
  const [serviceError, setServiceError] = useState('');
  const progress = Math.round((processed / catalogSize) * 100);

  useEffect(() => {
    const unsubscribe = service.subscribe(state => {
      setServiceStatus(state.status);
      if (state.error)
        setServiceError(
          state.error instanceof Error
            ? state.error.message
            : String(state.error),
        );
    });

    return () => {
      activeSearch.current?.abort();
      activeSearch.current = null;
      search.terminate();
      unsubscribe();
      service.dispose();
    };
  }, []);

  async function runSearch() {
    activeSearch.current?.abort();
    const controller = new AbortController();
    activeSearch.current = controller;
    const currentQuery = query;
    setPending(true);
    setProcessed(0);
    setMatches(0);
    setPreview([]);
    setSearchStatus('Обрабатываем каталог в отдельном потоке…');

    try {
      for (let offset = 0; offset < catalogSize; offset += batchSize) {
        const result = await search.call(
          'search',
          {
            query: currentQuery,
            offset,
            count: Math.min(batchSize, catalogSize - offset),
          },
          { signal: controller.signal },
        );

        if (activeSearch.current !== controller) return;
        setProcessed(value => value + result.processed);
        setMatches(value => value + result.matches);
        setPreview(result.preview);
      }
      setSearchStatus('Поиск завершён');
    } catch (error) {
      if (activeSearch.current !== controller) return;
      setSearchStatus(
        controller.signal.aborted
          ? 'Поиск отменён'
          : error instanceof Error
            ? error.message
            : String(error),
      );
    } finally {
      if (activeSearch.current === controller) {
        activeSearch.current = null;
        setPending(false);
      }
    }
  }

  async function runServiceCommand(command: () => Promise<unknown>) {
    setServiceError('');
    try {
      await command();
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className={styles.section} aria-labelledby="workers-heading">
      <div className={styles.heading}>
        <span className="eyebrow">NATIVE WORKERS · YOUR RULES</span>
        <h2 id="workers-heading">Потоки под вашим контролем.</h2>
        <p>
          Тяжёлые вычисления уходят в фон. Кеш и обновления включаются по вашему
          решению.
        </p>
      </div>

      <div className={styles.grid}>
        <article className={styles.panel}>
          <span className={styles.tag}>WEB WORKER</span>
          <h3>240 000 товаров. Свободный интерфейс.</h3>
          <p>
            Поиск выполняется порциями в отдельном потоке. Прогресс отражает уже
            обработанные записи.
          </p>

          <form
            className={styles.search}
            onSubmit={event => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <label htmlFor={searchId}>Что найти</label>
            <input
              id={searchId}
              value={query}
              onChange={event => setQuery(event.currentTarget.value)}
              placeholder="camera, lens, tripod…"
            />
            <div className={styles.actions}>
              <button id="worker-start" type="submit" disabled={pending}>
                Найти в worker
              </button>
              <button
                id="worker-cancel"
                type="button"
                disabled={!pending}
                onClick={() => activeSearch.current?.abort()}
              >
                Отменить
              </button>
            </div>
          </form>

          <progress
            className={styles.progress}
            max={catalogSize}
            value={processed}
            aria-label="Прогресс поиска"
          />
          <div className={styles.metrics}>
            <span id="worker-progress">{progress}%</span>
            <span id="worker-matches">Найдено: {matches}</span>
          </div>
          <p id="worker-status" className={styles.status} role="status">
            {searchStatus}
          </p>
          <ul className={styles.preview}>
            {preview.map(item => (
              <li key={item.id}>{item.label}</li>
            ))}
          </ul>
          <button
            id="worker-ui"
            className={styles.probe}
            onClick={() => setClicks(value => value + 1)}
          >
            Интерфейс отвечает: {clicks}
          </button>
        </article>

        <article className={styles.panel}>
          <span className={styles.tag}>SERVICE WORKER</span>
          <h3>Обновление — когда вы готовы.</h3>
          <p>
            Кешируем статические файлы оболочки. HTML, запросы данных, формы и
            манифесты идут в сеть.
          </p>
          <div className={styles.serviceState}>
            <span>Состояние</span>
            <strong id="service-status">{serviceLabels[serviceStatus]}</strong>
          </div>
          <div className={styles.actions}>
            <button
              id="service-register"
              disabled={serviceStatus !== 'idle' && serviceStatus !== 'error'}
              onClick={() => runServiceCommand(() => service.register())}
            >
              Зарегистрировать
            </button>
            <button
              id="service-update"
              disabled={
                serviceStatus !== 'ready' &&
                serviceStatus !== 'update-available'
              }
              onClick={() => runServiceCommand(() => service.update())}
            >
              Проверить обновление
            </button>
            <button
              id="service-activate"
              disabled={serviceStatus !== 'update-available'}
              onClick={() => service.activateUpdate()}
            >
              Активировать версию
            </button>
            <button
              id="service-unregister"
              disabled={
                serviceStatus !== 'ready' &&
                serviceStatus !== 'update-available'
              }
              onClick={() => runServiceCommand(() => service.unregister())}
            >
              Удалить регистрацию
            </button>
          </div>
          {serviceError && (
            <p className={styles.error} role="alert">
              {serviceError}
            </p>
          )}
          <p className={styles.note}>
            Регистрация, проверка и активация выполняются только по кнопке.
            Открытая страница не перезагружается.
          </p>
        </article>
      </div>
    </section>
  );
}
