import {
  Form,
  Link,
  useForm,
  useLoaderData,
  type LoaderData,
} from '@kanso/app';
import { JsonLd, Seo } from '@kanso/app/seo';
import { useId } from '@kanso/core';
import type { productLoader } from '../handlers.server';

type RequestValues = {
  name: string;
  email: string;
  message: string;
  interests: string[];
};

/** Native validation, server field errors and hydration share the same form. */
export function Product() {
  const { product, canonical, jsonLd } =
    useLoaderData<LoaderData<typeof productLoader>>();
  const form = useForm<never, RequestValues>({ id: 'product-request' });
  const id = useId();

  return (
    <>
      <Seo
        title={product.name}
        description={product.summary}
        canonical={canonical}
        image={product.image}
      />
      <JsonLd id="product" data={jsonLd} />
      <Link href="/" class="back-link">
        ← В каталог
      </Link>
      <div className="detail-grid">
        <section>
          <div className={'product-art detail-art art-' + product.category}>
            <img src={product.image} alt="" />
          </div>
          <h1>{product.name}</h1>
          <p>{product.detail}</p>
        </section>
        <section className="request-panel">
          <span className="eyebrow">ДАВАЙТЕ ОБСУДИМ</span>
          <h2>Оставить заявку</h2>
          <p>
            Без оплаты и обязательств. Все поля остаются на странице при ошибке.
          </p>
          <Form
            state={form}
            className="request-form"
            aria-label="Заявка на товар"
            aria-busy={form.pending}
          >
            {form.formError && <p role="alert">{form.formError}</p>}
            <label htmlFor={id + '-name'}>Имя</label>
            <input
              id={id + '-name'}
              name="name"
              autocomplete="name"
              required
              value={form.values.name ?? ''}
              aria-invalid={!!form.errors.name}
              aria-describedby={id + '-name-error'}
            />
            <span id={id + '-name-error'} className="field-error">
              {form.errors.name}
            </span>

            <label htmlFor={id + '-email'}>Email</label>
            <input
              id={id + '-email'}
              name="email"
              type="email"
              autocomplete="email"
              required
              value={form.values.email ?? ''}
              aria-invalid={!!form.errors.email}
              aria-describedby={id + '-email-error'}
            />
            <span id={id + '-email-error'} className="field-error">
              {form.errors.email}
            </span>

            <label htmlFor={id + '-message'}>Что хотите узнать?</label>
            <textarea
              id={id + '-message'}
              name="message"
              rows={4}
              required
              value={form.values.message ?? ''}
              aria-invalid={!!form.errors.message}
              aria-describedby={id + '-message-error'}
            />
            <span id={id + '-message-error'} className="field-error">
              {form.errors.message}
            </span>

            <fieldset>
              <legend>Интересуют</legend>
              <label className="check">
                <input
                  type="checkbox"
                  name="interests"
                  value="details"
                  checked={form.values.interests?.includes('details') ?? false}
                />
                Характеристики
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  name="interests"
                  value="availability"
                  checked={
                    form.values.interests?.includes('availability') ?? false
                  }
                />
                Наличие
              </label>
            </fieldset>
            {form.error && <p role="alert">{form.error}</p>}
            <div className="form-actions">
              <button
                name="intent"
                value="request"
                type="submit"
                disabled={form.pending}
              >
                {form.pending ? 'Отправляем…' : 'Оставить заявку'}
              </button>
              <button
                name="intent"
                value="question"
                type="submit"
                className="secondary"
                disabled={form.pending}
              >
                Задать вопрос
              </button>
            </div>
          </Form>
        </section>
      </div>
    </>
  );
}
