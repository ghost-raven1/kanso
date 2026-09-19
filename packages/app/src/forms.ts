import { createComponent, createSignal, onCleanup, useContext, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { DataContext, RouteIdContext } from './data.js';
import type { ActionResult } from './types.js';

export interface FormState<T> {
  readonly pending: boolean; readonly errors: Record<string, string>;
  readonly error: string | undefined; readonly data: T | undefined;
  submit: (data: FormData) => Promise<void>;
}

/** Submit, expose field errors, and revalidate loaders after a successful action. */
export function useForm<T = unknown>(routeId?: string): FormState<T> {
  const id = routeId ?? useContext(RouteIdContext);
  const context = useContext(DataContext);
  if (!id) throw new Error('useForm needs a route id.');
  const [pending, setPending] = createSignal(false);
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [error, setError] = createSignal<string>();
  const [data, setData] = createSignal<T>();
  let request: AbortController | undefined;
  onCleanup(() => request?.abort());
  return {
    get pending() { return pending(); }, get errors() { return errors(); },
    get error() { return error(); }, get data() { return data(); },
    async submit(body) {
      request?.abort();
      const current = request = new AbortController();
      setPending(true); setErrors({}); setError(undefined);
      try {
        const response = await fetch(`/_kanso/action/${encodeURIComponent(id)}`, {
          method: 'POST', body, signal: current.signal, headers: { Accept: 'application/json', 'X-Kanso-Location': window.location.pathname + window.location.search },
        });
        if (current !== request) return;
        const redirect = response.headers.get('X-Kanso-Redirect');
        if (redirect) { window.location.assign(redirect); return; }
        const result = await response.json() as ActionResult<T>;
        if (current !== request) return;
        if (result.errors) { setErrors(result.errors); return; }
        if (!response.ok) throw new Error(`Submit failed: HTTP ${response.status}`);
        setData(() => result.data); context?.reload();
      } catch (caught) {
        if (!current.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
      } finally { if (current === request) setPending(false); }
    },
  };
}

export function Form(props: { state: FormState<unknown>; children?: JSX.Element; class?: string }): JSX.Element {
  return createComponent(Dynamic, {
    component: 'form', method: 'post', get class() { return props.class; },
    onSubmit: (event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
      event.preventDefault(); void props.state.submit(new FormData(event.currentTarget, event.submitter));
    },
    get children() { return props.children; },
  });
}
