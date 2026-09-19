export default function LazyPage() {
  return <article className="panel compact"><span className="tag">SEPARATE CHUNK</span><h2>This route arrived on demand.</h2><p>Код маршрута отделён от начальной клиентской сборки. Сервер может отрендерить его при прямом открытии.</p><div className="lazy-symbol" aria-hidden="true">↗</div></article>;
}
