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
export type DragEvent<T extends EventTarget = Element> = Targeted<globalThis.DragEvent, T>;
export type WheelEvent<T extends EventTarget = Element> = Targeted<globalThis.WheelEvent, T>;

/** Handler aliases use the native event contract and preserve target type checking. */
export type ChangeEventHandler<T extends EventTarget = Element> = (event: ChangeEvent<T>) => void;
export type FormEventHandler<T extends EventTarget = Element> = (event: FormEvent<T>) => void;
export type MouseEventHandler<T extends EventTarget = Element> = (event: MouseEvent<T>) => void;
export type KeyboardEventHandler<T extends EventTarget = Element> = (event: KeyboardEvent<T>) => void;
export type FocusEventHandler<T extends EventTarget = Element> = (event: FocusEvent<T>) => void;
export type PointerEventHandler<T extends EventTarget = Element> = (event: PointerEvent<T>) => void;
export type TouchEventHandler<T extends EventTarget = Element> = (event: TouchEvent<T>) => void;
export type ClipboardEventHandler<T extends EventTarget = Element> = (event: ClipboardEvent<T>) => void;
export type DragEventHandler<T extends EventTarget = Element> = (event: DragEvent<T>) => void;
export type WheelEventHandler<T extends EventTarget = Element> = (event: WheelEvent<T>) => void;
