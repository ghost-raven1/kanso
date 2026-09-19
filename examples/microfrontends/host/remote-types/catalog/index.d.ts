export interface Contract {
  components: {
    "ProductCard": typeof import("./src/ProductCard").default;
  };
  routes: typeof import("./src/routes").routes;
}
