import { Form, useForm, useLoaderData } from '@kanso/app';

export default function Data() {
  const data = useLoaderData<{ name: string; source: string }>();
  const form = useForm<{ saved: boolean }>();
  return (
    <div className="grid">
      <article className="panel compact">
        <span className="tag">REQUEST → HTML → HYDRATION</span>
        <h2>Data arrives with the page.</h2>
        <p>
          Данные loader передаются в HTML. Гидратация использует тот же снимок.
        </p>
        <div className="data-output">
          <span>SERVER VALUE</span>
          <output id="server-name">{data.name}</output>
        </div>
        <small>{data.source}</small>
      </article>
      <article className="panel compact">
        <span className="tag">SERVER ACTION</span>
        <h2>A form with a full lifecycle.</h2>
        <Form state={form}>
          <label for="name">Display name</label>
          <input
            id="name"
            name="name"
            value={form.values.name ?? ''}
            placeholder="Например, Алексей"
            aria-invalid={!!form.errors.name}
            aria-describedby="name-error"
          />
          <p role="alert" id="name-error">
            {form.errors.name || form.error || ''}
          </p>
          <button className="primary" type="submit" disabled={form.pending}>
            {form.pending ? 'Saving…' : 'Save name →'}
          </button>
          <p role="status">
            {form.data?.saved ? 'Saved. Loader refreshed.' : ''}
          </p>
        </Form>
      </article>
    </div>
  );
}
