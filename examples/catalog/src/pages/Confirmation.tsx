import { Link, useLoaderData } from '@kanso/app';

export function Confirmation() {
  const { requestId, productName, intent, interests } = useLoaderData<{
    requestId: string;
    productName: string;
    intent: string;
    interests: string[];
  }>();
  return (
    <section className="confirmation">
      <span className="eyebrow">ГОТОВО</span>
      <h1>Заявка принята.</h1>
      <p>
        Вы выбрали: <strong>{productName}</strong>
      </p>
      <p>
        Номер заявки: <code id="request-id">{requestId}</code>
      </p>
      <p data-intent={intent}>
        Тип обращения: {intent === 'question' ? 'Вопрос' : 'Заявка'}
      </p>
      <p data-interests={interests.join(',')}>
        Темы: {interests.join(', ') || 'Общие вопросы'}
      </p>
      <p>Это демонстрация: сообщение никуда не отправлено.</p>
      <Link href="/">Вернуться в каталог →</Link>
    </section>
  );
}
