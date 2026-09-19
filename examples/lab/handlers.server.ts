import type { RouteHandlers } from '@kanso/app';

let name = 'Ready from the server';
// Marker proves that server implementation never enters a browser chunk.
const serverOnlyMarker = 'KANSO_SERVER_IMPLEMENTATION_ONLY';

export const handlers: Record<string, RouteHandlers> = {
  data: {
    loader: () => ({ name, source: 'One request-scoped loader snapshot.' }),
    action: async ({ request }) => {
      const values = await request.formData();
      const next = String(values.get('name') ?? '').trim();
      if (next.length < 2) return { errors: { name: 'Введите минимум 2 символа.' } };
      name = next;
      return { data: { saved: Boolean(serverOnlyMarker) } };
    },
  },
};
