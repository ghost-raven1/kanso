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

import type { DragEvent, WheelEvent, MouseEventHandler, DragEventHandler, WheelEventHandler } from '@kanso/core';
const drag: DragEventHandler<HTMLDivElement> = event => { event.dataTransfer?.getData('text/plain'); event.currentTarget.focus(); };
const wheel: WheelEventHandler<HTMLInputElement> = event => { event.currentTarget.value = String(event.deltaY); };
const click: MouseEventHandler<HTMLButtonElement> = event => { event.currentTarget.disabled = true; };
const buttonProps: ComponentProps<'button'> = { onClick: click };
const wheelProps: ComponentProps<'input'> = { onWheel: wheel };
// @ts-expect-error Native drag events do not expose React's nativeEvent wrapper.
const wrappedDrag = (event: DragEvent<HTMLDivElement>) => event.nativeEvent;
// @ts-expect-error Native wheel events do not expose SyntheticEvent.persist().
const persistentWheel = (event: WheelEvent<HTMLInputElement>) => event.persist();
// @ts-expect-error Handler currentTarget must match the destination element.
const wrongHandler: MouseEventHandler<HTMLInputElement> = click;
void [drag, buttonProps, wheelProps, wrappedDrag, persistentWheel, wrongHandler];
