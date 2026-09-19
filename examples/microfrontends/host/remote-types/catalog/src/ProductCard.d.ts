import { type Context } from '@kanso/core';
export default function ProductCard(props: {
    productId: string;
    settings: Context<{
        step: number;
    }>;
}): import("solid-js").JSX.Element;
