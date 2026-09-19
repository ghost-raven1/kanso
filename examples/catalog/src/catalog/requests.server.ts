export interface CatalogRequest {
  id: string;
  productId: string;
  name: string;
  email: string;
  message: string;
  interests: string[];
  intent: string;
}
export interface RequestStore {
  save(input: Omit<CatalogRequest, 'id'>): Promise<CatalogRequest>;
  find(id: string): Promise<CatalogRequest | undefined>;
}

/** Demo only: replace this store with a persistent service before deploying. */
export function createDemoRequestStore(): RequestStore {
  const requests = new Map<string, CatalogRequest>();
  return {
    async save(input) {
      const record = { ...input, id: crypto.randomUUID() };
      requests.set(record.id, record);
      return record;
    },
    async find(id) {
      return requests.get(id);
    },
  };
}
