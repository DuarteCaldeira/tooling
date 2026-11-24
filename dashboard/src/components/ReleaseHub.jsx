import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  Badge,
  Button,
  SearchFilter,
  SelectFilter,
  Tag,
} from '@dcaldeira/design-system';
import { itemTopics, normalize, portugueseDate } from '../lib/topics.js';
import { ArrowUpRight, Bug, Chat, Check, Filter, Refresh } from './Icons.jsx';

const FILTER_KEYS = [
  'notes-search',
  'review-filter',
  'discussion-filter',
  'content-filter',
  'topic-filter',
];
const DEFAULTS = {
  'notes-search': '',
  'review-filter': 'all',
  'discussion-filter': 'all',
  'content-filter': 'all',
  'topic-filter': 'all',
};
const PAGE = 10;

export function ReleaseDate({ value }) {
  if (!value) return <span className="value muted">Sem publicação</span>;
  return (
    <time className="value" dateTime={value} title="Hora de Portugal continental · Europe/Lisbon">
      {portugueseDate(value)}
    </time>
  );
}

const githubUrl = (url) =>
  typeof url === 'string' && url.startsWith('https://github.com/') ? url : undefined;

function ChangeItem({ context, review, onOpen, onTopic, activeTopic }) {
  const state = review.stateOf(context);
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState(false);
  const { text, technical, areaLabel, reported } = context;
  const canValidate = !technical && !reported;
  const split = text.indexOf(': ');
  const repeated =
    split > 0 && areaLabel && normalize(text.slice(0, split)) === normalize(areaLabel);
  const tags = reported ? [] : itemTopics(text, technical).filter((topic) => topic.kind !== 'area');

  async function toggleValidation() {
    setPending(true);
    setFeedback('');
    try {
      await review.setField(context, 'validated', !state.validated);
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setPending(false);
    }
  }

  const status = reported
    ? 'is-reported'
    : technical
      ? 'is-technical'
      : state.validated
        ? 'is-validated'
        : 'is-pending';
  return (
    <li className={`change-item ${status}${state.count && !state.closed ? ' has-open' : ''}`}>
      {canValidate ? (
        <span className="check-wrap">
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={state.validated}
            aria-label={(state.validated ? 'Retirar validação: ' : 'Validar: ') + text}
            disabled={pending || !review.isLoaded(context.repository)}
            onClick={toggleValidation}
          >
            <Check />
          </Button>
        </span>
      ) : null}
      <div className="item-main">
        <button
          type="button"
          className="item-trigger"
          aria-label={`Abrir conversa: ${text}`}
          onClick={() => onOpen(context)}
        >
          <span className="change-copy">
            {repeated ? (
              text.slice(split + 2)
            ) : split > 0 && split < 45 ? (
              <>
                <strong>{text.slice(0, split + 1)}</strong>
                {text.slice(split + 1)}
              </>
            ) : (
              text
            )}
          </span>
        </button>
        <div className="item-meta">
          {tags.length || reported ? (
            <div className="item-topics">
              {reported ? <span className="comment-kind comment-kind--issue">Problema</span> : null}
              {tags.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  className="tag-button"
                  aria-label={`Filtrar por ${topic.label}`}
                  aria-pressed={activeTopic === topic.id}
                  onClick={() => onTopic(topic.id)}
                >
                  <Tag size="sm">{topic.label}</Tag>
                </button>
              ))}
            </div>
          ) : null}
          <div className="item-actions">
            <Button variant="ghost" size="sm" onClick={() => onOpen(context)}>
              <Chat />
              {state.count
                ? `${state.count} · ${state.closed ? 'Resolvida' : 'Em aberto'}`
                : reported
                  ? state.closed
                    ? 'Resolvido'
                    : 'Em aberto'
                  : 'Comentar'}
            </Button>
          </div>
        </div>
      </div>
      {feedback ? (
        <p className="item-feedback" role="status">
          {feedback}
        </p>
      ) : null}
    </li>
  );
}

function AreaGroups({ items, technical, release, app, review, onOpen, onTopic, topic }) {
  const groups = new Map();
  for (const item of items) {
    const area = itemTopics(item.text, technical).find((entry) => entry.kind === 'area') ?? {
      id: technical ? 'manutencao' : 'geral',
      label: technical ? 'Manutenção' : 'Geral',
      emoji: technical ? '🛠️' : '📦',
    };
    if (!groups.has(area.id)) groups.set(area.id, { area, items: [] });
    groups.get(area.id).items.push(item);
  }
  const ordered = [...groups.values()].sort(
    (a, b) =>
      (a.area.id === 'geral') - (b.area.id === 'geral') ||
      a.area.label.localeCompare(b.area.label, 'pt-PT'),
  );
  const context = (item, areaLabel) => ({
    repository: app.repository,
    version: release.version,
    item: item.id,
    text: item.text,
    appName: app.name,
    technical,
    areaLabel,
  });
  return ordered.map(({ area, items: group }) => (
    <section className="release-area" key={area.id} aria-label={area.label}>
      <header className="release-area-heading">
        <h3>{area.label}</h3>
        <span>{group.length === 1 ? '1 alteração' : `${group.length} alterações`}</span>
      </header>
      <ul className="change-list" lang={release.language ?? 'pt-PT'}>
        {group.map((item) => (
          <ChangeItem
            key={item.id}
            context={context(item, area.label)}
            review={review}
            onOpen={onOpen}
            onTopic={onTopic}
            activeTopic={topic}
          />
        ))}
      </ul>
    </section>
  ));
}

export function ReleaseHub({ apps, app, review, onOpen }) {
  const [filters, setFilters] = useState(() => {
    const params = new URLSearchParams(location.search);
    return Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? DEFAULTS[key]]));
  });
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const repository = app?.repository;
  const loaded = review.isLoaded(repository);
  const search = normalize(filters['notes-search'].trim());
  const {
    'review-filter': filter,
    'discussion-filter': conversation,
    'content-filter': content,
  } = filters;
  const topic = filters['topic-filter'];

  // Changing app resets paging, filters and open state, like a fresh page.
  const previous = useRef(repository);
  useEffect(() => {
    if (previous.current === repository) return;
    previous.current = repository;
    setLimit(PAGE);
    setExpanded({});
    setFilters(DEFAULTS);
  }, [repository]);

  const update = (key, value) => {
    setLimit(PAGE);
    setExpanded({});
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === 'content-filter' && value === 'technical') next['review-filter'] = 'all';
      return next;
    });
  };
  const clear = () => {
    setLimit(PAGE);
    setExpanded({});
    setFilters(DEFAULTS);
  };

  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set('app', repository ?? '');
    for (const key of FILTER_KEYS) {
      if (filters[key] && filters[key] !== 'all') url.searchParams.set(key, filters[key]);
      else url.searchParams.delete(key);
    }
    url.searchParams.delete('release');
    url.searchParams.delete('item');
    url.hash = 'release-notes';
    history.replaceState(null, '', url);
  }, [filters, repository]);

  const filtering = Boolean(
    search || filter !== 'all' || conversation !== 'all' || content !== 'all' || topic !== 'all',
  );
  const needsState = filter !== 'all' || conversation !== 'all';
  const all = app?.releases ?? [];
  const context = (release, id, text) => ({
    repository,
    version: release.version,
    item: id,
    text,
    appName: app.name,
  });

  const topics = useMemo(() => {
    const available = new Map();
    for (const release of all)
      for (const item of [...(release.items ?? []), ...(release.technicalItems ?? [])])
        for (const entry of itemTopics(item.text, item.id.startsWith('technical-')))
          available.set(entry.id, entry);
    return [...available.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-PT'));
  }, [all]);

  const matchesText = (text) => search.split(/\s+/).every((term) => normalize(text).includes(term));
  const matchesConversation = (state) =>
    conversation === 'all' ||
    (loaded && state.count > 0 && (conversation === 'open' ? !state.closed : state.closed));
  const itemMatches = (release, item, technical = false) => {
    if ((technical || item.reported) && filter !== 'all') return false;
    if (item.reported && topic !== 'all') return false;
    const entries = itemTopics(item.text, technical);
    if (topic !== 'all' && !entries.some((entry) => entry.id === topic)) return false;
    const state = review.stateOf(context(release, item.id, item.text));
    return (
      matchesText(
        `${release.version} ${portugueseDate(release.releasedAt)} ${item.text} ${entries
          .map((entry) => entry.label)
          .join(' ')}`,
      ) &&
      matchesConversation(state) &&
      (filter === 'all' || (loaded && (filter === 'pending' ? !state.validated : state.validated)))
    );
  };
  const matches = all
    .map((release) => {
      const reported =
        content === 'technical'
          ? []
          : review
              .reportedItemsOf(repository, release.version)
              .filter((item) => itemMatches(release, item));
      const items =
        content === 'technical'
          ? []
          : (release.items ?? []).filter((item) => itemMatches(release, item));
      const technical =
        content === 'product'
          ? []
          : (release.technicalItems ?? []).filter((item) => itemMatches(release, item, true));
      const releaseState = review.stateOf(context(release, 'release', ''));
      const releaseMatch =
        topic === 'all' &&
        content === 'all' &&
        filter === 'all' &&
        conversation !== 'all' &&
        matchesConversation(releaseState) &&
        matchesText(`${release.version} ${release.summaryContext ?? ''}`);
      const sourceNotes =
        !needsState &&
        topic === 'all' &&
        content === 'all' &&
        !release.items?.length &&
        release.originalNotes?.trim() &&
        matchesText(`${release.version} ${release.originalNotes}`)
          ? release.originalNotes
          : '';
      const emptyMatch =
        !needsState &&
        topic === 'all' &&
        content === 'all' &&
        !release.items?.length &&
        !release.technicalItems?.length &&
        matchesText(`${release.version} ${release.summaryContext ?? ''}`);
      return {
        release,
        items,
        technical,
        reported,
        sourceNotes,
        visible:
          items.length ||
          technical.length ||
          reported.length ||
          sourceNotes ||
          releaseMatch ||
          emptyMatch,
      };
    })
    .filter((entry) => entry.visible);
  const resultCount = matches.reduce(
    (count, entry) => count + entry.items.length + entry.technical.length + entry.reported.length,
    0,
  );
  const shown = matches.slice(0, limit);

  const releaseId = (release) => `${repository}/${release.version}`;
  const entryOpen = (entry) => {
    const product = entry.release.items ?? [];
    const checked = product.filter(
      (item) => review.stateOf(context(entry.release, item.id, item.text)).validated,
    ).length;
    const fully = loaded && product.length > 0 && checked === product.length;
    return {
      product,
      checked,
      fully,
      open:
        expanded[releaseId(entry.release)] ??
        (filtering ||
          (!fully && product.length > 0) ||
          (entry.release === all[0] && Boolean(entry.sourceNotes)) ||
          entry.reported.some(
            (item) => !review.stateOf(context(entry.release, item.id, item.text)).closed,
          )),
    };
  };
  const states = shown.map((entry) => ({ entry, ...entryOpen(entry) }));
  const setOpen = (ids, openIds) =>
    setExpanded((current) => {
      const next = { ...current };
      for (const id of ids) next[id] = openIds.includes(id);
      return next;
    });
  const message =
    app?.status === 'unavailable'
      ? 'Não foi possível consultar esta aplicação.'
      : !all.length
        ? 'Ainda não há versões publicadas. As novidades vão aparecer aqui.'
        : needsState && !loaded
          ? review.hasError(repository)
            ? 'Não foi possível carregar os estados. Tente atualizar a revisão.'
            : 'A carregar validações e conversas…'
          : !matches.length
            ? 'Nenhuma alteração corresponde aos filtros. Experimente limpar os filtros.'
            : '';

  const accordionItems = states.map(({ entry, product, checked, fully }) => {
    const { release, items, technical, reported, sourceNotes } = entry;
    const key = releaseId(release);
    const technicalKey = `${key}/technical`;
    const notesStatus = release.originalNotes?.trim()
      ? 'Changelog disponível'
      : release.technicalItems?.length
        ? 'Detalhes técnicos'
        : 'Sem notas publicadas';
    const technicalOpen =
      expanded[technicalKey] ??
      (content === 'technical' || conversation !== 'all' || Boolean(search));
    const groupProps = {
      release,
      app,
      review,
      onOpen,
      topic,
      onTopic: (id) => update('topic-filter', id),
    };
    return {
      id: key,
      header: (
        <span className="release-heading">
          <span className="release-identity">
            <span className="release-version">{release.version}</span>
            {release === all[0] ? <Badge variant="success" size="sm" text="Mais recente" /> : null}
            {release.prerelease ? (
              <Badge variant="neutral" size="sm" text="Pré-lançamento" />
            ) : null}
          </span>
          <span className="release-meta">
            <ReleaseDate value={release.releasedAt} />
            <span className={`release-review${fully ? ' complete' : ''}`}>
              <i className="status-dot" aria-hidden="true" />
              {!product.length
                ? notesStatus
                : loaded
                  ? fully
                    ? 'Tudo validado'
                    : `${checked}/${product.length} validadas`
                  : review.hasError(repository)
                    ? 'Revisão indisponível'
                    : 'A carregar revisão…'}
            </span>
          </span>
        </span>
      ),
      content: (
        <div className="release-body">
          {items.length ? (
            <div className="area-groups">
              <AreaGroups items={items} technical={false} {...groupProps} />
            </div>
          ) : sourceNotes ? (
            <section className="release-area">
              <header className="release-area-heading">
                <h3>Changelog</h3>
              </header>
              <pre className="source-note source-changelog">{sourceNotes}</pre>
            </section>
          ) : !technical.length && !reported.length && !needsState ? (
            <p className="source-note">
              {release.summaryContext ?? 'Esta versão não tem novidades de produto descritas.'}
            </p>
          ) : null}
          {reported.length ? (
            <section className="release-area" aria-label="Problemas reportados">
              <header className="release-area-heading">
                <h3>Problemas reportados</h3>
              </header>
              <ul className="change-list">
                {reported.map((item) => (
                  <ChangeItem
                    key={item.id}
                    context={{ ...context(release, item.id, item.text), reported: true }}
                    review={review}
                    onOpen={onOpen}
                    onTopic={(id) => update('topic-filter', id)}
                    activeTopic={topic}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {technical.length ? (
            <Accordion
              type="multiple"
              items={[
                {
                  id: technicalKey,
                  header: (
                    <span className="area-heading">
                      Detalhes técnicos <span className="count">{technical.length}</span>
                    </span>
                  ),
                  content: (
                    <div className="area-groups">
                      <AreaGroups items={technical} technical {...groupProps} />
                    </div>
                  ),
                },
              ]}
              value={technicalOpen ? [technicalKey] : []}
              onChange={(value) => setOpen([technicalKey], [value].flat())}
            />
          ) : null}
          <div className="release-footer">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                onOpen({
                  ...context(release, 'release', 'Conversa sobre esta versão e novas descobertas'),
                  report: true,
                })
              }
            >
              <Bug /> Reportar bug
            </Button>
            {githubUrl(release.url) ? (
              <a className="text-link" href={release.url}>
                Ver no GitHub <ArrowUpRight />
              </a>
            ) : null}
          </div>
        </div>
      ),
    };
  });

  return (
    <section id="release-notes" aria-labelledby="notes-title">
      <div className="notes-heading">
        <h2 id="notes-title">Histórico de versões</h2>
        <div className="feed-toolbar">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setOpen(
                states.map(({ entry }) => releaseId(entry.release)),
                states.map(({ entry }) => releaseId(entry.release)),
              )
            }
          >
            Expandir tudo
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setOpen(
                states.map(({ entry }) => releaseId(entry.release)),
                [],
              )
            }
          >
            Recolher tudo
          </Button>
        </div>
      </div>
      <div className="filter-panel" role="group" aria-label="Filtrar alterações">
        <SearchFilter
          id="notes-search"
          label="Pesquisar novidades"
          placeholder="Pesquisar uma novidade, tema ou versão…"
          value={filters['notes-search']}
          onChange={(value) => update('notes-search', value)}
        />
        <Button
          variant="secondary"
          size="sm"
          className="filters-toggle"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((value) => !value)}
        >
          <Filter /> Filtros
          {filtering ? <span className="count">ativos</span> : null}
        </Button>
        <div className={`review-controls${filtersOpen ? ' is-open' : ''}`}>
          <SelectFilter
            id="topic-filter"
            label="Tema"
            value={topics.some((entry) => entry.id === topic) ? topic : 'all'}
            options={[
              { value: 'all', label: 'Todos' },
              ...topics.map((entry) => ({
                value: entry.id,
                label: entry.label,
              })),
            ]}
            onChange={(value) => update('topic-filter', value)}
          />
          <SelectFilter
            id="content-filter"
            label="Conteúdo"
            value={content}
            options={[
              { value: 'all', label: 'Tudo' },
              { value: 'product', label: 'Só produto' },
              { value: 'technical', label: 'Só técnica' },
            ]}
            onChange={(value) => update('content-filter', value)}
          />
          <SelectFilter
            id="review-filter"
            label="Validação"
            value={filter}
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'pending', label: 'Por validar' },
              { value: 'validated', label: 'Validadas' },
            ]}
            onChange={(value) => update('review-filter', value)}
          />
          <SelectFilter
            id="discussion-filter"
            label="Conversas"
            value={conversation}
            options={[
              { value: 'all', label: 'Todas' },
              { value: 'open', label: 'Em aberto' },
              { value: 'resolved', label: 'Resolvidas' },
            ]}
            onChange={(value) => update('discussion-filter', value)}
          />
        </div>
        <div className="filter-footer">
          <span id="filter-results" role="status" aria-live="polite">
            {`${resultCount} ${resultCount === 1 ? 'alteração' : 'alterações'} · ${matches.length} ${matches.length === 1 ? 'versão' : 'versões'}`}
          </span>
          {filtering ? (
            <Button variant="ghost" size="sm" onClick={clear}>
              Limpar filtros
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => review.refresh(repository)}>
            <Refresh /> Atualizar
          </Button>
        </div>
      </div>
      <p id="notes-message" role="status" aria-live="polite">
        {message}
      </p>
      {accordionItems.length ? (
        <div className="release-feed">
          <Accordion
            type="multiple"
            items={accordionItems}
            value={states
              .filter((state) => state.open)
              .map(({ entry }) => releaseId(entry.release))}
            onChange={(value) =>
              setOpen(
                states.map(({ entry }) => releaseId(entry.release)),
                [value].flat(),
              )
            }
          />
        </div>
      ) : null}
      {matches.length > limit ? (
        <div className="load-more">
          <Button variant="pill" onClick={() => setLimit(limit + PAGE)}>
            Mostrar versões anteriores
          </Button>
        </div>
      ) : null}
    </section>
  );
}
