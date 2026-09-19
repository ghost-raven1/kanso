import type { RouteHandlers } from '@kanso/app';

const handler: RouteHandlers<{ user: string }> = {
  loader: ({ params, context }) => ({
    name: params.id ? `Product: ${params.id}` : 'Independent catalog',
    user: context.user,
    release: import.meta.env.VITE_RELEASE,
  }),
  action: async ({ request }) => {
    const note = (await request.formData()).get('note');
    return typeof note === 'string' && note.trim()
      ? { data: { saved: note, release: import.meta.env.VITE_RELEASE } }
      : { errors: { note: 'Введите заметку' } };
  },
};
export const handlers = { index: handler, product: handler };
