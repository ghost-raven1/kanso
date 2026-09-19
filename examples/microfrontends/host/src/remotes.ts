import { defineRemote } from '@kanso/microfrontends';
import type { Contract as CatalogContract } from '../remote-types/catalog';
import type { Contract as PromotionContract } from '../remote-types/promotion';

export const catalog = defineRemote<CatalogContract>({
  name: 'catalog',
  manifest: `${import.meta.env.VITE_CATALOG_ORIGIN ?? 'http://127.0.0.1:4201'}/kanso-remote.json`,
  contract: '^1.0.0',
});
export const promotion = defineRemote<PromotionContract>({
  name: 'promotion',
  manifest: `${import.meta.env.VITE_PROMOTION_ORIGIN ?? 'http://127.0.0.1:4202'}/kanso-remote.json`,
  contract: '^1.0.0',
});
export const microfrontends = [catalog, promotion];
