import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  Button,
  Progress,
  SearchFilter,
  Select,
  SelectFilter,
} from '@dcaldeira/design-system';
import { ConversationDrawer } from './components/ConversationDrawer.jsx';
import { ArrowUpRight, Mark } from './components/Icons.jsx';
import { ReleaseDate, ReleaseHub } from './components/ReleaseHub.jsx';
import { api } from './lib/api.js';
import { portugueseDate } from './lib/topics.js';
import { usePolling, useReview } from './hooks.js';

// Every app gets its own colour; the whole page re-tints when you switch.
const ACCENTS = ['#c8ff3d', '#ff7a59', '#4cc9ff', '#ff5fa2', '#ffc233', '#3dffb0', '#b794ff'];

const githubUrl = (url) =>
  typeof url === 'string' && url.startsWith('https://github.com/') ? url : undefined;

/** Counts up to `value` once it changes, unless the visitor prefers reduced motion. */
function useCountUp(value) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (typeof value !== 'number' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      from.current = value;
      return undefined;
    }
    const start = typeof from.current === 'number' ? from.current : 0;
    const t0 = performance.now();
    let frame;
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / 900);
      const eased = 1 - Math.pow(1 - t, 4);
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}

function ToolingValue({ tooling }) {
  const labels = {
    'not-adopted': 'Não utilizado',
    unresolved: 'Por resolver',
    unknown: 'Indisponível',
  };
  return (
    <div>
      <span className="value">{tooling.version ?? labels[tooling.status] ?? 'Indisponível'}</span>
      {tooling.revision ? (
        <small className="detail mono">{tooling.revision.slice(0, 7)}</small>
      ) : null}
    </div>
  );
}

const versionLabel = (app) =>
  app?.version ?? (app?.status === 'unavailable' ? 'Indisponível' : 'Sem publicações');

function Ticker({ apps }) {
  const recent = apps
    .filter((app) => app.version && app.releasedAt)
    .sort((a, b) => Date.parse(b.releasedAt) - Date.parse(a.releasedAt));
  if (!recent.length) return null;
  const row = (hidden) => (
    <ul className="ticker-row" aria-hidden={hidden || undefined}>
      {recent.map((app) => (
        <li key={app.repository}>
          <span className="ticker-emoji">{app.emoji ?? '📦'}</span>
          <strong>{app.name}</strong>
          <span className="mono">{app.version}</span>
          <ReleaseDate value={app.releasedAt} />
        </li>
      ))}
    </ul>
  );
  return (
    <div className="ticker" role="group" aria-label="Publicações recentes">
      <div className="ticker-track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

function AppTabs({ apps, selected, onSelect }) {
  const nav = useRef(null);
  // Keep the chosen app visible in the scrolling strip (matters on phones).
  useEffect(() => {
    const tab = nav.current?.querySelector('[aria-pressed="true"]');
    if (!tab || !nav.current) return;
    const strip = nav.current;
    strip.scrollTo({
      left: tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2,
      behavior: 'smooth',
    });
  }, [selected]);
  return (
    <nav ref={nav} id="app-nav" className="app-tabs" aria-label="Escolher uma aplicação">
      {apps.map((app, index) => (
        <button
          key={app.repository}
          type="button"
          className="app-choice"
          style={{ '--tab': ACCENTS[index % ACCENTS.length] }}
          aria-pressed={app.repository === selected}
          onClick={() => onSelect(app.repository)}
        >
          <span className="choice-emoji" aria-hidden="true">
            {app.emoji ?? '📦'}
          </span>
          <span className="choice-name">{app.name}</span>
          <span className="choice-version mono">{app.version ?? '—'}</span>
        </button>
      ))}
    </nav>
  );
}

function Bento({ app, review }) {
  const repository = app?.repository;
  const loaded = review.isLoaded(repository);
  let total = 0;
  let validated = 0;
  let open = 0;
  for (const release of app?.releases ?? []) {
    const context = (item) => ({
      repository,
      version: release.version,
      item: item.id,
      text: item.text,
    });
    for (const item of release.items ?? []) {
      total++;
      if (review.stateOf(context(item)).validated) validated++;
    }
    for (const item of [
      ...(release.items ?? []),
      ...(release.technicalItems ?? []),
      { id: 'release', text: '' },
    ]) {
      const state = review.stateOf(context(item));
      if (state.count && !state.closed) open++;
    }
  }
  const caption = loaded
    ? `${validated} de ${total} novidades validadas`
    : review.hasError(repository)
      ? 'Revisão indisponível de momento'
      : 'A carregar a revisão…';
  const percent = loaded && total ? Math.round((validated / total) * 100) : null;
  const pShown = useCountUp(percent);
  const tShown = useCountUp(total);
  const pendingShown = useCountUp(loaded ? total - validated : null);
  const openShown = useCountUp(loaded ? open : null);
  return (
    <section className="bento" aria-label="Aplicação selecionada">
      <div className="tile tile-name">
        <div className="selected-app-heading">
          <span className="selected-emoji" aria-hidden="true">
            {app?.emoji ?? '📦'}
          </span>
          <span className="selected-label">A acontecer em</span>
        </div>
        <div className="selected-name">
          <h2>{app?.name ?? 'Escolha uma aplicação'}</h2>
        </div>
        {githubUrl(app?.repositoryUrl) ? (
          <a className="tile-link" href={app.repositoryUrl}>
            Ver no GitHub <ArrowUpRight />
          </a>
        ) : null}
      </div>
      <dl className="selected-metrics">
        <div className="tile tile-version">
          <dt>Última versão</dt>
          <dd className="metric-version">{versionLabel(app)}</dd>
        </div>
        <div className="tile tile-date">
          <dt>Última publicação</dt>
          <dd>
            <ReleaseDate value={app?.releasedAt} />
          </dd>
        </div>
        <div className="tile tile-tooling">
          <dt>Tooling atual</dt>
          <dd>
            <ToolingValue tooling={app?.tooling ?? { status: 'unknown' }} />
          </dd>
        </div>
      </dl>
      <div className="tile tile-score review-overview" aria-label="Estado de revisão">
        <span className="review-percent" aria-hidden="true">
          {pShown ?? '—'}
          {percent === null ? null : <small>%</small>}
        </span>
        <span className="review-score-label">validado</span>
      </div>
      <div className="tile tile-stats">
        <div className="review-stats">
          <div className="stat">
            <span className="stat-label">Novidades</span>
            <strong className="stat-value">{tShown}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Por validar</span>
            <strong className="stat-value">{pendingShown ?? '—'}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Conversas em aberto</span>
            <strong className="stat-value">{openShown ?? '—'}</strong>
          </div>
        </div>
        <div className="review-completion">
          <span className="progress-caption">{caption}</span>
          <Progress variant="primary" size="md" value={validated} max={total || 1} label={caption} />
        </div>
      </div>
    </section>
  );
}

function Portfolio({ apps, snapshot, onSelect }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('latest');
  const [open, setOpen] = useState(false);
  const released = apps.filter((app) => app.version).length;
  const unreleased = apps.filter((app) => app.status === 'unreleased').length;
  const adopted = apps.filter((app) => app.tooling.version).length;
  const percent = apps.length ? Math.round((adopted / apps.length) * 100) : 0;
  useEffect(() => {
    const show = () => {
      if (location.hash === '#apps') setOpen(true);
    };
    show();
    window.addEventListener('hashchange', show);
    return () => window.removeEventListener('hashchange', show);
  }, []);
  const visible = useMemo(() => {
    const term = query.toLocaleLowerCase('pt-PT').trim();
    return apps
      .filter(
        (app) =>
          `${app.name} ${app.repository}`.toLocaleLowerCase('pt-PT').includes(term) &&
          (filter === 'all' ||
            (filter === 'released' ? Boolean(app.version) : app.status === 'unreleased')),
      )
      .sort(
        sort === 'name'
          ? (a, b) => a.name.localeCompare(b.name, 'pt-PT')
          : (a, b) => (Date.parse(b.releasedAt) || 0) - (Date.parse(a.releasedAt) || 0),
      );
  }, [apps, query, filter, sort]);
  const recent = apps
    .filter((app) => app.version && app.releasedAt)
    .sort((a, b) => Date.parse(b.releasedAt) - Date.parse(a.releasedAt));
  const filters = [
    ['all', 'Todas', apps.length],
    ['released', 'Publicadas', released],
    ['unreleased', 'Por publicar', unreleased],
  ];
  return (
    <div id="apps" className="portfolio">
      <Accordion
        type="multiple"
        items={[
          {
            id: 'apps',
            header: (
              <span className="portfolio-heading">
                <span>Visão geral das aplicações</span>
                <span className="portfolio-hint">Versões e tooling</span>
              </span>
            ),
            content: (
              <div className="portfolio-body">
                <div className="stats" aria-label="Visão geral das aplicações">
                  {[
                    [apps.length, 'Aplicações'],
                    [released, 'Com versões publicadas'],
                    [adopted, 'Com tooling partilhado'],
                  ].map(([value, label]) => (
                    <div key={label} className="stat-block">
                      <strong>{value}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div className="section-heading">
                  <h2>
                    Todas as aplicações <span className="count">{apps.length}</span>
                  </h2>
                  <SearchFilter
                    id="search"
                    label="Pesquisar aplicações"
                    placeholder="Pesquisar aplicações…"
                    value={query}
                    onChange={setQuery}
                  />
                </div>
                <div className="collection-controls">
                  <div className="filters" role="group" aria-label="Filtrar aplicações">
                    {filters.map(([id, label, count]) => (
                      <Button
                        key={id}
                        variant={filter === id ? 'secondary' : 'ghost'}
                        size="sm"
                        aria-pressed={filter === id}
                        onClick={() => setFilter(id)}
                      >
                        {`${label} ${count}`}
                      </Button>
                    ))}
                  </div>
                  <div className="sort">
                    <Select
                      id="sort"
                      label="Ordenar aplicações"
                      value={sort}
                      onChange={setSort}
                      options={[
                        { value: 'latest', label: 'Publicação mais recente' },
                        { value: 'name', label: 'Nome A–Z' },
                      ]}
                    />
                  </div>
                </div>
                <p role="status" aria-live="polite" className="portfolio-message">
                  {!visible.length
                    ? 'Nenhuma aplicação corresponde aos filtros.'
                    : apps.some((app) => app.status === 'unavailable')
                      ? 'Algumas aplicações estão indisponíveis. Verifique o acesso aos repositórios.'
                      : ''}
                </p>
                <div className="ledger">
                  <div className="ledger-head" aria-hidden="true">
                    <span>Aplicação</span>
                    <span>Versão</span>
                    <span>Tooling atual</span>
                    <span>Publicação</span>
                    <span />
                  </div>
                  {visible.map((app) => (
                    <article key={app.repository} className="app-card">
                      <div className="identity">
                        <span className="app-icon">{app.emoji ?? '📦'}</span>
                        <h3>
                          <button
                            type="button"
                            className="app-card-button"
                            onClick={() => onSelect(app.repository)}
                          >
                            {app.name}
                          </button>
                        </h3>
                      </div>
                      <p className={`app-version${app.version ? ' mono' : ' is-empty'}`}>
                        {app.version ?? 'Sem versão publicada'}
                      </p>
                      <dl className="card-metrics">
                        <div>
                          <dt>Tooling atual</dt>
                          <dd>
                            <ToolingValue tooling={app.tooling} />
                          </dd>
                        </div>
                        <div>
                          <dt>Publicação</dt>
                          <dd>
                            <ReleaseDate value={app.releasedAt} />
                          </dd>
                        </div>
                      </dl>
                      {githubUrl(app.repositoryUrl) ? (
                        <a
                          className="app-card-github"
                          href={app.repositoryUrl}
                          aria-label={`${app.name} no GitHub`}
                        >
                          GitHub <ArrowUpRight />
                        </a>
                      ) : (
                        <span />
                      )}
                    </article>
                  ))}
                </div>
                <div className="workspace-details">
                  <section>
                    <h2>Publicações recentes</h2>
                    {recent.length ? (
                      <ol className="release-list">
                        {recent.map((app) => (
                          <li key={app.repository}>
                            <strong>{app.name}</strong>
                            {githubUrl(app.releaseUrl) ? (
                              <a className="activity-version mono" href={app.releaseUrl}>
                                {app.version}
                              </a>
                            ) : (
                              <span className="activity-version mono">{app.version}</span>
                            )}
                            <ReleaseDate value={app.releasedAt} />
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p>Ainda não há versões publicadas.</p>
                    )}
                  </section>
                  <section>
                    <h2>Tooling partilhado</h2>
                    <p className="adoption">
                      <strong>{percent}%</strong> das aplicações têm a versão de tooling
                      identificada.
                    </p>
                    <Progress
                      variant="primary"
                      value={percent}
                      max={100}
                      label="Aplicações com tooling partilhado"
                    />
                    <p>{`${adopted} de ${apps.length} aplicações têm uma versão de tooling identificada no ramo predefinido.`}</p>
                  </section>
                </div>
              </div>
            ),
          },
        ]}
        value={open ? ['apps'] : []}
        onChange={(value) => setOpen([value].flat().includes('apps'))}
      />
      <span hidden>{snapshot.generatedAt}</span>
    </div>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState('');
  const [conversation, setConversation] = useState(null);
  const review = useReview();
  const drafts = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    let loading = false;
    let initialized = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (loading || cancelled) return;
      loading = true;
      try {
        const response = await fetch('/api/releases', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (data.schemaVersion !== 1 || !Array.isArray(data.apps)) throw new Error();
        if (cancelled) return;
        const params = new URLSearchParams(location.search);
        const apps = data.apps;
        setSnapshot(data);
        setFailed(false);
        setSelected((current) =>
          apps.some((app) => app.repository === current)
            ? current
            : (apps.find((app) => app.repository === params.get('app'))?.repository ??
              apps.find((app) => app.repository === data.defaultApp)?.repository ??
              apps[0]?.repository ??
              ''),
        );
        if (initialized) return;
        initialized = true;
        // A shared link opens the conversation it points at.
        const app = apps.find((entry) => entry.repository === params.get('app'));
        const release = app?.releases.find((entry) => entry.version === params.get('release'));
        const item = params.get('item');
        let entry = [...(release?.items ?? []), ...(release?.technicalItems ?? [])].find(
          (candidate) => candidate.id === item,
        );
        if (!entry && release && item?.startsWith('reported-')) {
          const shared = await api({ repository: app.repository, view: 'summary' });
          if (cancelled) return;
          entry = shared.reportedItems?.[release.version]?.find(
            (candidate) => candidate.id === item,
          );
        }
        if (release && (item === 'release' || entry))
          setConversation({
            repository: app.repository,
            version: release.version,
            item,
            appName: app.name,
            text: entry?.text ?? 'Conversa sobre esta versão e novas descobertas',
            technical: Boolean(entry?.id?.startsWith('technical-')),
            reported: Boolean(entry?.reported),
          });
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        loading = false;
      }
    };
    const whenVisible = () => {
      if (!document.hidden) refresh();
    };
    refresh();
    const interval = setInterval(whenVisible, 30_000);
    document.addEventListener('visibilitychange', whenVisible);
    window.addEventListener('focus', whenVisible);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', whenVisible);
      window.removeEventListener('focus', whenVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selected) review.refresh(selected);
  }, [selected, review.refresh]);

  usePolling(() => review.refresh(selected), 30_000, Boolean(selected));

  const apps = snapshot?.apps ?? [];
  const chooseApp = (repository) => {
    setSelected(repository);
    requestAnimationFrame(() =>
      document
        .getElementById('release-notes')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };
  const app = apps.find((entry) => entry.repository === selected);
  const updated = failed
    ? 'Informação indisponível'
    : snapshot
      ? portugueseDate(snapshot.generatedAt) +
        (Date.now() - Date.parse(snapshot.generatedAt) > 120000 ? ' · Atualização em atraso' : '')
      : 'A carregar as versões…';

  const stale = Boolean(snapshot) && Date.now() - Date.parse(snapshot.generatedAt) > 120000;
  const accentIndex = Math.max(
    0,
    apps.findIndex((entry) => entry.repository === selected),
  );
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', ACCENTS[accentIndex % ACCENTS.length]);
  }, [accentIndex]);
  return (
    <>
      <a className="skip" href="#release-notes">
        Saltar para as novidades
      </a>
      <header className="site-header">
        <div className="header-content">
          <a href="./" className="brand">
            <Mark />
            <span className="brand-name">tooling</span>
          </a>
          <div className="header-end">
            <span className={`header-status${stale || failed ? ' is-stale' : ''}`}>
              <i className="live-dot" aria-hidden="true" />
              {failed ? 'Sem ligação' : stale ? 'Em atraso' : snapshot ? 'Em direto' : 'A ligar…'}
            </span>
            <a className="header-link" href="#apps">
              Visão geral
            </a>
            <a className="header-link" href="https://github.com/DuarteCaldeira/tooling">
              GitHub <ArrowUpRight />
            </a>
          </div>
        </div>
      </header>
      {snapshot ? <AppTabs apps={apps} selected={selected} onSelect={setSelected} /> : null}
      <main className="workspace">
        <div className="main-area">
          <h1 className="visually-hidden">Novidades</h1>
          {failed ? (
            <p role="status" id="release-refresh-error">
              Não foi possível carregar as versões. Tente novamente dentro de instantes.
            </p>
          ) : null}
          {!snapshot && !failed ? (
            <p className="loading" role="status">
              A carregar as versões…
            </p>
          ) : snapshot ? (
            <>
              <Ticker apps={apps} />
              <Bento app={app} review={review} />
              <ReleaseHub apps={apps} app={app} review={review} onOpen={setConversation} />
              <Portfolio apps={apps} snapshot={snapshot} onSelect={chooseApp} />
            </>
          ) : null}
          <footer>
            <span>Atualizado: {updated}</span>
            <span>
              Hora de Portugal continental <span aria-hidden="true">·</span>{' '}
              <a href="/api/releases">Dados das versões</a>
            </span>
          </footer>
        </div>
      </main>
      <ConversationDrawer
        context={conversation}
        onClose={() => setConversation(null)}
        review={review}
        onReported={(item) =>
          setConversation({
            repository: item.repository,
            version: item.version,
            item: item.id,
            text: item.text,
            appName: conversation.appName,
            reported: true,
          })
        }
        drafts={drafts}
      />
    </>
  );
}

