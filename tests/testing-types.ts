import { Portal, type JSX, type PortalProps } from '@kanso/core';
import { createTestScope, renderComponent } from '@kanso/core/testing';

function Counter(props: { step: number; title?: string }) { return props.title; }
function contracts() {
  const view = renderComponent(Counter, { props: { step: 1 } });
  view.setProps({ step: 2, title: undefined });
  // @ts-expect-error Required initial props must be provided.
  renderComponent(Counter, { props: {} });
  // @ts-expect-error Partial updates preserve the component's value types.
  view.setProps({ step: 'two' });
  // @ts-expect-error Unknown props are not accepted.
  createTestScope().renderComponent(Counter, { props: { step: 1 } }).setProps({ unknown: true });
  const props: PortalProps = { mount: () => document.body, children: 'content' };
  const element: JSX.Element = Portal(props);
  // @ts-expect-error A selector string is not a DOM target.
  Portal({ mount: '#portal' });
  return element;
}
void contracts;
