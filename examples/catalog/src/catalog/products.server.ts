/** Seed facts are demo content, not a database or a pricing feed. */
export const products = [
  {
    id: 'akari',
    name: 'Лампа Akari',
    category: 'light',
    summary: 'Мягкий свет для рабочего стола.',
    detail:
      'Бумажный абажур, деревянное основание. Уточним размеры и наличие в ответе на заявку.',
    image: '/lamp.svg',
  },
  {
    id: 'midori',
    name: 'Блокнот Midori',
    category: 'stationery',
    summary: 'Место для идей и хорошего кода.',
    detail:
      'Плотная бумага и раскрытие на 180 градусов. Подберём формат под ваши задачи.',
    image: '/notebook.svg',
  },
  {
    id: 'sora',
    name: 'Чашка Sora',
    category: 'ceramics',
    summary: 'Небольшая пауза среди больших дел.',
    detail:
      'Керамическая чашка с матовой глазурью. Цвет и объём уточняются при подтверждении.',
    image: '/cup.svg',
  },
];
export type Product = (typeof products)[number];
