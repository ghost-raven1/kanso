import type { JSX, ComponentProps, CSSProperties, RefObject } from '@kanso/core';
const input: RefObject<HTMLInputElement | null> = { current: null };
const props: ComponentProps<'input'> = { ref: input, value: 'typed', style: { padding: 4 } };
const css: CSSProperties = { opacity: 0.5, '--color': 'blue' };
const element: JSX.IntrinsicElements['input'] = props;
const custom: ComponentProps<(props: { name: string }) => JSX.Element> = { name: 'Kanso' };
// @ts-expect-error An input ref cannot point at a textarea.
const incorrect: ComponentProps<'input'> = { ref: { current: document.createElement('textarea') } };
void [css, element, custom, incorrect];
