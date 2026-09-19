import {
  Link,
  routeUrl,
  useLoaderData,
  useLocation,
  useRevalidator,
  type LoaderData,
} from '@kanso/app';
import type { catalogLoader } from '../handlers.server';
import { routes } from '../routes';

/** GET filters remain shareable and work before JavaScript loads. */
export function Catalog() {
  const { items, query, category } =
    useLoaderData<LoaderData<typeof catalogLoader>>();
  const location = useLocation();
  const revalidator = useRevalidator();
  const refresh = () => {
    void revalidator.revalidate();
  };

  return (
    <>
      <section className="intro">
        <span className="eyebrow">МЕНЬШЕ ЛИШНЕГО</span>
        <h1>
          Вещи, с которыми
          <br />
          приятно каждый день.
        </h1>
        <p>
          Небольшая коллекция для рабочего стола. Выберите предмет — мы ответим
          на вопросы и уточним наличие.
        </p>
      </section>

      <form
        method="get"
        action="/"
        className="filters"
        aria-label="Фильтры каталога"
      >
        <label>
          Поиск
          <input name="q" value={query} placeholder="Например, лампа" />
        </label>
        <label>
          Категория
          <select name="category" value={category}>
            <option value="">Все предметы</option>
            <option value="light">Свет</option>
            <option value="stationery">Бумага</option>
            <option value="ceramics">Керамика</option>
          </select>
        </label>
        <button type="submit">Найти</button>
        <Link href="/">Сбросить</Link>
      </form>

      <div className="results-heading">
        <p aria-live="polite">
          Найдено: <strong id="result-count">{items.length}</strong>
        </p>
        <button
          type="button"
          className="text-button"
          onClick={refresh}
          disabled={revalidator.pending}
        >
          Обновить каталог
        </button>
      </div>
      {revalidator.error && (
        <p role="alert">
          Не удалось обновить каталог. Показаны последние данные. Попробуйте ещё
          раз.
        </p>
      )}
      <div className="products" data-search={location.search}>
        {items.map(product => (
          <article key={product.id} className="product-card">
            <Link href={routeUrl(routes, 'product', { productId: product.id })}>
              <div className={'product-art art-' + product.category}>
                <img src={product.image} alt="" />
              </div>
              <div className="product-copy">
                <h2>{product.name}</h2>
                <p>{product.summary}</p>
                <span>Подробнее ↗</span>
              </div>
            </Link>
          </article>
        ))}
      </div>
      {items.length === 0 && (
        <p className="empty">Ничего не найдено. Попробуйте другой запрос.</p>
      )}
    </>
  );
}
