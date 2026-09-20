/** Native DOM events with a precisely typed currentTarget; no synthetic-event runtime. */
type Targeted<E extends Event, T extends EventTarget> = Omit<E, 'currentTarget'> & { readonly currentTarget: T };
export type ChangeEvent<T extends EventTarget = Element> = Targeted<Event, T> & { readonly target: T };
export type FormEvent<T extends EventTarget = Element> = Targeted<Event, T>;
export type MouseEvent<T extends EventTarget = Element> = Targeted<globalThis.MouseEvent, T>;
export type KeyboardEvent<T extends EventTarget = Element> = Targeted<globalThis.KeyboardEvent, T>;
export type FocusEvent<T extends EventTarget = Element> = Targeted<globalThis.FocusEvent, T>;
export type PointerEvent<T extends EventTarget = Element> = Targeted<globalThis.PointerEvent, T>;
export type TouchEvent<T extends EventTarget = Element> = Targeted<globalThis.TouchEvent, T>;
export type ClipboardEvent<T extends EventTarget = Element> = Targeted<globalThis.ClipboardEvent, T>;
