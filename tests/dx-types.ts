import type { JSX, ComponentProps, CSSProperties, RefObject } from '@kanso/core';
const input: RefObject<HTMLInputElement | null> = { current: null };
const props: ComponentProps<'input'> = { ref: input, value: 'typed', style: { padding: 4 } };
const css: CSSProperties = { opacity: 0.5, '--color': 'blue' };
const element: JSX.IntrinsicElements['input'] = props;
const custom: ComponentProps<(props: { name: string }) => JSX.Element> = { name: 'Kanso' };
// @ts-expect-error An input ref cannot point at a textarea.
const incorrect: ComponentProps<'input'> = { ref: { current: document.createElement('textarea') } };
void [css, element, custom, incorrect];

import { forwardRef, useRef, useImperativeHandle } from '@kanso/core';
import type { Ref, ChangeEvent, KeyboardEvent } from '@kanso/core';
const optional = useRef<number>();
optional.current = undefined;
const domRef = useRef<HTMLInputElement>(null);
const callbackRef: Ref<HTMLInputElement> = element => { element?.focus(); };
const Field = forwardRef<HTMLInputElement, { label: string }>((props, ref) => {
  useImperativeHandle(ref, () => document.createElement('input'), []);
  return props.label;
});
const fieldProps: ComponentProps<typeof Field> = { label: 'Name', ref: domRef };
const change = (event: ChangeEvent<HTMLInputElement>) => event.currentTarget.value;
const keydown = (event: KeyboardEvent<HTMLInputElement>) => event.key;
// @ts-expect-error Native events do not expose React SyntheticEvent.persist().
const synthetic = (event: ChangeEvent<HTMLInputElement>) => event.persist();
// @ts-expect-error A component ref must match the forwarded element.
const wrongField: ComponentProps<typeof Field> = { label: 'Bad', ref: { current: document.createElement('textarea') } };
void [callbackRef, fieldProps, change, keydown, synthetic, wrongField];
