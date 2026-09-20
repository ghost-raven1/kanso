import { afterEach, expect, it } from 'vitest';
import { fireEvent, within } from '@testing-library/dom';
import {
  createContext, useContext, useState, Portal, createServiceScope,
  defineService, ServiceProvider, useService, onCleanup,
} from '@kanso/core';
import { createTestScope } from '@kanso/core/testing';
import { useParams } from '@kanso/app';
import { MemoryRouter, Route, createMemoryHistory } from '@kanso/app/solid-router';

const scope = createTestScope();
afterEach(scope.cleanup);
const Theme = createContext('light');

function Counter({ step }: { step: number }) {
  const [count, setCount] = useState(0);
  const theme = useContext(Theme);
  return (
    <Portal>
      <button onClick={() => setCount(value => value + step)}>
        {theme}: {count}
      </button>
    </Portal>
  );
}

it('uses compiled hooks, live props and provider Context with ordinary DOM queries', () => {
  const view = scope.renderComponent(Counter, {
    props: { step: 1 },
    wrapper: props => <Theme.Provider value="dark">{props.children}</Theme.Provider>,
  });
  const query = within(view.baseElement);
  fireEvent.click(query.getByRole('button', { name: 'dark: 0' }));
  view.setProps({ step: 2 });
  fireEvent.click(query.getByRole('button', { name: 'dark: 1' }));
  expect(query.getByRole('button', { name: 'dark: 3' })).toBeTruthy();
  expect(view.container.querySelector('button')).toBeNull();
});

it('leaves no portal from the preceding test', () => {
  expect(document.querySelectorAll('button')).toHaveLength(0);
});

it('composes a memory router with request-style service ownership', async () => {
  const history = createMemoryHistory();
  history.set({ value: '/items/first' });
  let cleanups = 0;
  const settings = defineService({
    id: 'test.settings',
    create({ onCleanup }) {
      onCleanup(() => cleanups++);
      return { label: 'Item' };
    },
  });
  function Page() {
    const params = useParams<{ id: string }>();
    const service = useService(settings);
    return <output>{service.label}: {params.id}</output>;
  }
  function Services(props: { children?: import('@kanso/core').JSX.Element }) {
    const services = createServiceScope();
    onCleanup(() => services.dispose());
    return <ServiceProvider scope={services}>{props.children}</ServiceProvider>;
  }
  const view = scope.render(() => (
    <MemoryRouter history={history} root={Services}>
      <Route path="/items/:id" component={Page} />
    </MemoryRouter>
  ));
  expect(view.container.textContent).toBe('Item: first');
  history.set({ value: '/items/second' });
  await import('@testing-library/dom').then(({ waitFor }) => waitFor(() => {
    expect(view.container.textContent).toBe('Item: second');
  }));
  view.unmount();
  expect(cleanups).toBe(1);
});
