import { createComponent, createComputed, createSignal, createUniqueId, mergeProps, onCleanup, splitProps, useContext, type JSX } from 'solid-js';
import { Dynamic, isServer } from 'solid-js/web';
import { DataContext, RouteIdContext } from './data.js';
import type { ActionResult, FormValues } from './types.js';

/** Reserved transport fields shared by native forms and enhanced submissions. */
export const FORM_ROUTE = '__kanso_route';
export const FORM_ID = '__kanso_form';
export type FormPhase = 'idle' | 'submitting' | 'revalidating';
export interface FormState<T = unknown, V extends FormValues = FormValues> {
  readonly id: string;
  readonly routeId: string;
  readonly action: string;
  readonly phase: FormPhase;
  readonly pending: boolean;
  readonly errors: Record<string, string>;
  readonly values: Partial<V>;
  readonly formError: string | undefined;
  readonly error: string | undefined;
  readonly revalidationError: Error | undefined;
  readonly data: T | undefined;
  submit: (data: FormData) => Promise<void>;
}
export interface FormOptions { routeId?: string; id?: string }

export function useForm<T = unknown>(routeId?: string): FormState<T>;
export function useForm<T = unknown, V extends FormValues = FormValues>(options: FormOptions): FormState<T, V>;
/** Submit once, then revalidate. Only explicitly returned values are restored. */
export function useForm<T = unknown, V extends FormValues = FormValues>(options?: string | FormOptions): FormState<T, V> {
  const generatedId = createUniqueId();
  const routeId = (typeof options === 'string' ? options : options?.routeId) ?? useContext(RouteIdContext);
  const id = typeof options === 'object' ? options.id ?? generatedId : generatedId;
  const context = useContext(DataContext);
  if (!routeId) throw new Error('useForm needs a route id.');
  const action = context?.snapshot()?.action;
  const initial = action?.routeId === routeId && action.formId === id ? action.result as ActionResult<T, V> : undefined;
  const [phase, setPhase] = createSignal<FormPhase>('idle');
  const [errors, setErrors] = createSignal<Record<string, string>>(initial?.errors ?? {});
  const [values, setValues] = createSignal<Partial<V>>(initial?.values ?? {});
  const [formError, setFormError] = createSignal(initial?.formError);
  const [error, setError] = createSignal<string>();
  const [data, setData] = createSignal<T | undefined>(initial?.data);
  let request: AbortController | undefined;
  let disposed = false;
  let previousUrl = context?.url();
  createComputed(() => {
    const currentUrl = context?.url();
    if (currentUrl === previousUrl) return;
    previousUrl = currentUrl;
    request?.abort(); request = undefined;
    setPhase('idle'); setErrors({}); setValues({}); setFormError(undefined); setError(undefined); setData(undefined);
  });
  onCleanup(() => { disposed = true; request?.abort(); request = undefined; });
  return {
    id, routeId,
    get action() { return context?.url() ?? (isServer ? '/' : window.location.pathname + window.location.search); },
    get phase() { return phase(); },
    get pending() { return phase() !== 'idle'; },
    get errors() { return errors(); },
    get values() { return values(); },
    get formError() { return formError(); },
    get error() { return error(); },
    get revalidationError() { return context?.revalidator.error; },
    get data() { return data(); },
    async submit(body) {
      if (disposed || isServer) return;
      request?.abort();
      const current = request = new AbortController();
      body.set(FORM_ROUTE, routeId);
      body.set(FORM_ID, id);
      setPhase('submitting'); setErrors({}); setError(undefined); setFormError(undefined);
      try {
        const response = await fetch(`/_kanso/action/${encodeURIComponent(routeId)}`, {
          method: 'POST', body, signal: current.signal,
          headers: { Accept: 'application/json', 'X-Kanso-Location': window.location.pathname + window.location.search },
        });
        if (current !== request) return;
        const redirect = response.headers.get('X-Kanso-Redirect');
        if (redirect) { window.location.assign(redirect); return; }
        const result = await response.json() as ActionResult<T, V>;
        if (current !== request) return;
        if (response.status === 422) {
          setErrors(result.errors ?? {});
          setFormError(result.formError);
          setValues(() => result.values ?? {});
          return;
        }
        if (!response.ok) throw new Error(`Submit failed: HTTP ${response.status}`);
        setValues(() => result.values ?? {});
        setData(() => result.data);
        setPhase('revalidating');
        await context?.reload();
      } catch (caught) {
        if (current === request && !current.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
      } finally { if (current === request) setPhase('idle'); }
    },
  };
}

export type FormProps = Omit<JSX.FormHTMLAttributes<HTMLFormElement>, 'action' | 'method' | 'onSubmit' | 'on:submit' | 'children'> & {
  state: FormState;
  children?: JSX.Element;
  className?: string;
  onSubmit?: (event: SubmitEvent & { currentTarget: HTMLFormElement }) => void;
};

/** A real POST form before hydration; JavaScript enhances the same action contract. */
export function Form(props: FormProps): JSX.Element {
  const [local, attributes] = splitProps(props, ['state', 'children', 'className', 'class', 'onSubmit']);
  return createComponent(Dynamic, mergeProps(attributes, {
    component: 'form', method: 'post',
    get action() { return local.state.action; },
    get class() { return local.className ?? local.class; },
    onSubmit: (event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
      local.onSubmit?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      void local.state.submit(new FormData(event.currentTarget, event.submitter));
    },
    get children() {
      return [
        createComponent(Dynamic, { component: 'input', type: 'hidden', name: FORM_ROUTE, get value() { return local.state.routeId; } }),
        createComponent(Dynamic, { component: 'input', type: 'hidden', name: FORM_ID, get value() { return local.state.id; } }),
        local.children,
      ];
    },
  }));
}
