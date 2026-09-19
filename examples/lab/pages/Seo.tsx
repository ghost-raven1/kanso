import { useState, useEffect } from '@kanso/core';
import { Seo, JsonLd, articleJsonLd } from '@kanso/app/seo';
import { Link, useLoaderData } from '@kanso/app';

function HeadPreview() {
  const [head, setHead] = useState({ title: '', description: '', canonical: '', tags: 'Metadata is present in the HTML. The live inspector starts after hydration.' });
  useEffect(() => {
    const read = () => setHead({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
      tags: [...document.head.querySelectorAll('[data-kanso-head]')].map(node => node.outerHTML).join('\n'),
    });
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.head, { subtree: true, childList: true, attributes: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return <article className="panel compact"><span className="tag">LIVE HEAD → SOCIAL CARD</span><div className="social-preview"><img src="/og.png" alt="Kanso laboratory"/><div><small>{head.canonical}</small><h3 id="seo-preview-title">{head.title}</h3><p>{head.description}</p></div></div><details className="seo-details"><summary>Итоговые теги в document.head</summary><pre>{head.tags}</pre></details></article>;
}

export default function SeoPage() {
  const [title, setTitle] = useState('SEO that ships with HTML');
  const [description, setDescription] = useState('Один конфиг, привычный JSX и метаданные, доступные до загрузки JavaScript.');
  return <>
    <Seo title={title} description={description} openGraph={{ type: 'article' }}/>
    <JsonLd id="article" data={articleJsonLd({ headline: title, description })}/>
    <div className="grid"><article className="panel compact"><span className="tag">04 / SEARCH & SHARING</span><h2>SEO belongs to the page.</h2><p>Изменяй текст: заголовок вкладки, карточка ссылки и JSON-LD обновляются вместе. Тело страницы не перезапускается.</p><div className="seo-fields"><label htmlFor="seo-title">Заголовок</label><input id="seo-title" value={title} onChange={event => setTitle(event.currentTarget.value)}/><label htmlFor="seo-description">Описание</label><textarea id="seo-description" value={description} onChange={event => setDescription(event.currentTarget.value)}/></div><p className="seo-links"><a href="/robots.txt">robots.txt ↗</a><a href="/sitemap.xml">sitemap.xml ↗</a></p><p><Link href="/seo/example/first">Страница из loader →</Link></p></article><HeadPreview/></div>
  </>;
}

export function SeoExample() {
  const data = useLoaderData<{ name: string; description: string }>();
  return <article className="panel compact"><span className="tag">LOADER → ROUTE SEO</span><h2 id="seo-example-name">{data.name}</h2><p>{data.description}</p><p><Link href="/seo/example/first">First</Link> · <Link href="/seo/example/second">Second</Link> · <Link href="/seo">Редактор SEO</Link></p></article>;
}
