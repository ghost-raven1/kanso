import { exposeWorker, type WorkerContext } from '@kanso/workers/worker';

export interface SearchMatch {
  id: number;
  label: string;
}

interface SearchBatch {
  query: string;
  offset: number;
  count: number;
}

const categories = [
  'Camera',
  'Lens',
  'Tripod',
  'Microphone',
  'Light',
  'Backpack',
];

/** Search one catalog batch and yield regularly so cancellation can arrive. */
export const tasks = {
  async search(input: SearchBatch, { signal }: WorkerContext) {
    const query = input.query.trim().toLowerCase();
    const preview: SearchMatch[] = [];
    let matches = 0;

    for (
      let start = input.offset;
      start < input.offset + input.count;
      start += 500
    ) {
      signal.throwIfAborted();
      const end = Math.min(start + 500, input.offset + input.count);

      for (let id = start; id < end; id += 1) {
        const label = `${categories[id % categories.length]} · ${id + 1}`;
        if (label.toLowerCase().includes(query)) {
          matches += 1;
          if (preview.length < 3) preview.push({ id, label });
        }
      }

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    signal.throwIfAborted();
    return { processed: input.count, matches, preview };
  },
};

exposeWorker(tasks);
