declare function Catalog(): import("solid-js").JSX.Element;
export declare const routes: [{
    readonly id: "index";
    readonly path: "/";
    readonly component: typeof Catalog;
    readonly sitemap: true;
}, {
    readonly id: "product";
    readonly path: "/product/:id";
    readonly component: typeof Catalog;
}];
export {};
