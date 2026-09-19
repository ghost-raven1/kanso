import {
  defineRoutes,
  Form,
  useForm,
  useLoaderData,
  useRouteUrl,
} from '@kanso/app';
import { Seo } from '@kanso/app/seo';

function Catalog() {
  const data = useLoaderData<{ name: string; user: string; release: string }>();
  const form = useForm({ id: 'catalog-note' });
  const href = useRouteUrl(routes);

  return (
    <section className="remote-page">
      <Seo
        title={data.name}
        description="Независимо выпущенная страница каталога с серверными данными."
      />
      <span className="eyebrow">REMOTE PAGE · {data.release}</span>
      <h1>{data.name}</h1>
      <p data-user>Данные запроса: {data.user}</p>
      <a href={href('product', { id: 'camera' })}>Открыть камеру</a>
      <Form state={form}>
        <label htmlFor="note">Сохранить заметку</label>
        <input id="note" name="note" required />
        <button disabled={form.pending}>Сохранить</button>
        <p role="status">
          {form.pending ? 'Сохраняем…' : form.data ? 'Заметка сохранена' : ''}
        </p>
      </Form>
    </section>
  );
}

export const routes = defineRoutes([
  { id: 'index', path: '/', component: Catalog, sitemap: true },
  { id: 'product', path: '/product/:id', component: Catalog },
]);
