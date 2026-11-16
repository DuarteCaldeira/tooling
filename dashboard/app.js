import { createDiscussions, portugueseDate } from './discussions.js';

const discussions = createDiscussions();
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function githubLink(text, url, className) {
  const link = element('a', text, className);
  if (typeof url === 'string' && url.startsWith('https://github.com/')) link.href = url;
  return link;
}
function releaseDate(value) {
  if (!value) return element('span', 'Sem publicação', 'value muted');
  const time = element('time', portugueseDate(value), 'value');
  time.dateTime = value;
  time.title = 'Hora de Portugal continental · Europe/Lisbon';
  return time;
}
function toolingValue(tooling) {
  const block = element('div');
  const labels = {
    'not-adopted': 'Não utilizado',
    unresolved: 'Por resolver',
    unknown: 'Indisponível',
  };
  block.append(
    element('span', tooling.version ?? labels[tooling.status] ?? 'Indisponível', 'value'),
  );
  if (tooling.revision) block.append(element('small', tooling.revision.slice(0, 7), 'detail mono'));
  return block;
}
function renderCards(apps) {
  const cards = document.querySelector('#cards');
  cards.replaceChildren();
  for (const app of apps) {
    const card = element('article', undefined, 'app-card');
    const identity = element('div', undefined, 'identity');
    const heading = element('h3');
    heading.append(githubLink(app.name, app.repositoryUrl));
    identity.append(element('span', app.emoji ?? '📦', 'app-icon'), heading);
    card.append(identity, element('p', app.version ?? 'Sem versão publicada', 'app-version mono'));
    const metrics = element('dl', undefined, 'card-metrics');
    for (const [label, value] of [
      ['🧰 Tooling', toolingValue(app.tooling)],
      ['🗓️ Publicação', releaseDate(app.releasedAt)],
    ]) {
      const field = element('div');
      const data = element('dd');
      data.append(value);
      field.append(element('dt', label), data);
      metrics.append(field);
    }
    card.append(metrics);
    cards.append(card);
  }
}
function renderActivity(apps) {
  const releases = apps
    .filter((app) => app.version && app.releasedAt)
    .sort((a, b) => Date.parse(b.releasedAt) - Date.parse(a.releasedAt));
  const list = document.querySelector('#release-list');
  list.replaceChildren();
  for (const app of releases) {
    const item = element('li');
    item.append(
      element('strong', app.name),
      githubLink(app.version, app.releaseUrl, 'activity-version'),
      releaseDate(app.releasedAt),
    );
    list.append(item);
  }
  document.querySelector('#activity-empty').hidden = releases.length > 0;
}
function setupReleaseHub(apps, defaultApp) {
  const selection = document.querySelector('#release-app');
  const query = new URLSearchParams(location.search).get('app');
  for (const app of apps) {
    const option = element('option', app.name);
    option.value = app.repository;
    selection.append(option);
    const choice = element('button', undefined, 'app-choice');
    choice.type = 'button';
    choice.dataset.app = app.repository;
    const text = element('span');
    text.append(
      element('span', app.name, 'choice-name'),
      element(
        'span',
        app.version ?? (app.status === 'unavailable' ? 'Indisponível' : 'Sem publicações'),
        'choice-version',
      ),
    );
    choice.append(element('span', app.emoji ?? '📦', 'choice-emoji'), text);
    choice.addEventListener('click', () => {
      selection.value = app.repository;
      selection.dispatchEvent(new Event('change'));
    });
    document.querySelector('#app-nav').append(choice);
  }
  selection.value =
    apps.find((app) => app.repository === query)?.repository ??
    apps.find((app) => app.repository === defaultApp)?.repository ??
    apps[0]?.repository ??
    '';
  let limit = 10;
  const context = (app, release, item, text) => ({
    repository: app.repository,
    version: release.version,
    item,
    text,
    appName: app.name,
  });
  const expanded = new Map();
  const completed = new Map();
  const normalize = (text) =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-PT');
  const filterIds = ['notes-search', 'review-filter', 'discussion-filter', 'content-filter'];
  const initial = new URLSearchParams(location.search);
  for (const id of filterIds) {
    const input = document.getElementById(id);
    const value = initial.get(id);
    if (
      value &&
      (id === 'notes-search' || [...input.options].some((option) => option.value === value))
    )
      input.value = value;
  }
  function updateHistory() {
    const focusKey = document.activeElement?.dataset.focusKey;
    const app = apps.find((app) => app.repository === selection.value);
    document.querySelector('#selected-emoji').textContent = app?.emoji ?? '📦';
    document.querySelector('#selected-app-name').textContent = app?.name ?? 'Escolha uma aplicação';
    document.querySelector('#selected-version').textContent =
      app?.version ?? (app?.status === 'unavailable' ? 'Indisponível' : 'Sem publicações');
    document.querySelector('#selected-date').replaceChildren(releaseDate(app?.releasedAt));
    document
      .querySelector('#selected-tooling')
      .replaceChildren(toolingValue(app?.tooling ?? { status: 'unknown' }));
    for (const choice of document.querySelectorAll('[data-app]'))
      choice.setAttribute('aria-pressed', String(choice.dataset.app === selection.value));
    const feed = document.querySelector('#release-feed');
    feed.replaceChildren();
    const all = app?.releases ?? [];
    const search = normalize(document.querySelector('#notes-search').value.trim());
    const filter = document.querySelector('#review-filter').value;
    const conversation = document.querySelector('#discussion-filter').value;
    const content = document.querySelector('#content-filter').value;
    const loaded = discussions.isLoaded(app?.repository);
    const filtering = Boolean(
      search || filter !== 'all' || conversation !== 'all' || content !== 'all',
    );
    const needsState = filter !== 'all' || conversation !== 'all';
    const matchesText = (text) =>
      search.split(/\s+/).every((term) => normalize(text).includes(term));
    const matchesConversation = (state) =>
      conversation === 'all' ||
      (loaded && state.count > 0 && (conversation === 'open' ? !state.closed : state.closed));
    const itemMatches = (release, item, technical = false) => {
      if (technical && filter !== 'all') return false;
      const state = discussions.state(context(app, release, item.id, item.text));
      return (
        matchesText(`${release.version} ${portugueseDate(release.releasedAt)} ${item.text}`) &&
        matchesConversation(state) &&
        (filter === 'all' ||
          (loaded && (filter === 'pending' ? !state.validated : state.validated)))
      );
    };
    const matches = all
      .map((release) => {
        const items =
          content === 'technical'
            ? []
            : (release.items ?? []).filter((item) => itemMatches(release, item));
        const technical =
          content === 'product'
            ? []
            : (release.technicalItems ?? []).filter((item) => itemMatches(release, item, true));
        const releaseState = discussions.state(context(app, release, 'release', ''));
        const releaseMatch =
          content === 'all' &&
          filter === 'all' &&
          conversation !== 'all' &&
          matchesConversation(releaseState) &&
          matchesText(`${release.version} ${release.summaryContext ?? ''}`);
        const emptyMatch =
          !needsState &&
          content === 'all' &&
          !release.items?.length &&
          !release.technicalItems?.length &&
          matchesText(`${release.version} ${release.summaryContext ?? ''}`);
        return {
          release,
          items,
          technical,
          visible: items.length || technical.length || releaseMatch || emptyMatch,
        };
      })
      .filter((entry) => entry.visible);
    const totalItems = all.flatMap((release) => release.items ?? []);
    let validated = 0,
      open = 0;
    for (const release of all) {
      for (const item of release.items ?? []) {
        if (discussions.state(context(app, release, item.id, item.text)).validated) validated++;
      }
      for (const item of [
        ...(release.items ?? []),
        ...(release.technicalItems ?? []),
        { id: 'release', text: '' },
      ]) {
        const state = discussions.state(context(app, release, item.id, item.text));
        if (state.count && !state.closed) open++;
      }
    }
    document.querySelector('#review-total').textContent = totalItems.length;
    document.querySelector('#review-pending').textContent = loaded
      ? totalItems.length - validated
      : '—';
    document.querySelector('#review-open').textContent = loaded ? open : '—';
    const progress = document.querySelector('#review-progress');
    progress.value = validated;
    progress.max = totalItems.length || 1;
    document.querySelector('#review-caption').textContent = loaded
      ? `${validated} de ${totalItems.length} novidades validadas`
      : 'A carregar a revisão…';
    document.querySelector('#notes-context').textContent = `${all.length} versões publicadas`;
    const resultCount = matches.reduce(
      (count, entry) => count + entry.items.length + entry.technical.length,
      0,
    );
    document.querySelector('#filter-results').textContent =
      `${resultCount} ${resultCount === 1 ? 'alteração' : 'alterações'} · ${matches.length} ${matches.length === 1 ? 'versão' : 'versões'}`;
    document.querySelector('#clear-filters').hidden = !filtering;
    document.querySelector('#review-filter').disabled = content === 'technical';
    document.querySelector('#notes-message').textContent =
      app?.status === 'unavailable'
        ? 'Não foi possível consultar esta aplicação.'
        : !all.length
          ? 'Ainda não há versões publicadas. As novidades vão aparecer aqui.'
          : needsState && !loaded
            ? discussions.hasError(app?.repository)
              ? 'Não foi possível carregar os estados. Tente atualizar a revisão.'
              : 'A carregar validações e conversas…'
            : !matches.length
              ? 'Nenhuma alteração corresponde aos filtros. Experimente limpar os filtros.'
              : '';
    const share = new URL(location.href);
    share.searchParams.set('app', selection.value);
    for (const id of filterIds) {
      const value = document.getElementById(id).value;
      if (value && value !== 'all') share.searchParams.set(id, value);
      else share.searchParams.delete(id);
    }
    share.searchParams.delete('release');
    share.searchParams.delete('item');
    share.hash = 'release-notes';
    document.querySelector('#share-app').href = share.toString();
    for (const { release, items, technical } of matches.slice(0, limit)) {
      const key = `${app.repository}/${release.version}`;
      const product = release.items ?? [];
      const checked = product.filter(
        (item) => discussions.state(context(app, release, item.id, item.text)).validated,
      ).length;
      const fullyValidated = loaded && product.length > 0 && checked === product.length;
      if (fullyValidated && completed.get(key) === false) expanded.delete(key);
      completed.set(key, fullyValidated);
      const article = element(
        'details',
        undefined,
        `release-entry${fullyValidated ? ' release-complete' : ''}`,
      );
      article.open = expanded.get(key) ?? (filtering || (!fullyValidated && product.length > 0));
      article.id = `release-${release.version.replace(/[^a-z0-9.-]/gi, '-')}`;
      const heading = element('summary', undefined, 'release-heading');
      heading.dataset.focusKey = key + '/heading';
      heading.addEventListener('click', () => expanded.set(key, !article.open));
      const identity = element('span', undefined, 'release-identity');
      const icon = element('span', fullyValidated ? '✅' : '🚀', 'release-icon');
      icon.setAttribute('aria-hidden', 'true');
      identity.append(icon, element('span', release.version, 'release-version'));
      if (release === all[0])
        identity.append(element('span', 'Mais recente', 'badge badge-released'));
      if (release.prerelease) identity.append(element('span', 'Pré-lançamento', 'badge'));
      const meta = element('span', undefined, 'release-meta');
      meta.append(
        releaseDate(release.releasedAt),
        element(
          'span',
          !product.length
            ? 'Sem validação necessária'
            : loaded
              ? fullyValidated
                ? 'Tudo validado'
                : `${checked}/${product.length} validadas`
              : 'A carregar revisão…',
          `release-review${fullyValidated ? ' complete' : ''}`,
        ),
      );
      const chevron = element('span', '⌄', 'release-chevron');
      chevron.setAttribute('aria-hidden', 'true');
      heading.append(identity, meta, chevron);
      article.append(heading);
      const body = element('div', undefined, 'release-body');
      if (items.length) {
        const list = element('ul', undefined, 'change-list');
        list.lang = release.language ?? 'pt-PT';
        for (const item of items)
          list.append(discussions.item(context(app, release, item.id, item.text)));
        body.append(list);
      } else if (!technical.length && !needsState)
        body.append(
          element(
            'p',
            release.summaryContext ?? 'Esta versão não tem novidades de produto descritas.',
            'source-note',
          ),
        );
      if (technical.length) {
        const details = element('details', undefined, 'technical-notes');
        const technicalKey = key + '/technical';
        details.open =
          expanded.get(technicalKey) ??
          (content === 'technical' || conversation !== 'all' || Boolean(search));
        const summary = element('summary', `🛠️ Detalhes técnicos · ${technical.length}`);
        summary.addEventListener('click', () => expanded.set(technicalKey, !details.open));
        details.append(summary);
        const list = element('ul', undefined, 'change-list technical-list');
        for (const item of technical)
          list.append(
            discussions.item({ ...context(app, release, item.id, item.text), technical: true }),
          );
        details.append(list);
        body.append(details);
      }
      const footer = element('div', undefined, 'release-footer');
      footer.append(
        discussions.button(
          context(app, release, 'release', 'Conversa sobre esta versão e novas descobertas'),
          '💬 Conversa da versão',
        ),
        githubLink('Ver no GitHub ↗', release.url, 'text-link'),
      );
      body.append(footer);
      article.append(body);
      feed.append(article);
    }
    document.querySelector('#load-more').hidden = matches.length <= limit;
    if (focusKey) {
      const target = [...document.querySelectorAll('[data-focus-key]')].find(
        (node) => node.dataset.focusKey === focusKey,
      );
      const section = target?.closest('.release-entry');
      (section && !section.open ? section.querySelector('summary') : target)?.focus({
        preventScroll: true,
      });
    }
  }
  selection.addEventListener('change', () => {
    limit = 10;
    for (const id of filterIds)
      document.getElementById(id).value = id === 'notes-search' ? '' : 'all';
    expanded.clear();
    const url = new URL(location.href);
    url.searchParams.set('app', selection.value);
    url.searchParams.delete('release');
    url.searchParams.delete('item');
    for (const id of filterIds) url.searchParams.delete(id);
    url.hash = 'release-notes';
    history.replaceState(null, '', url);
    updateHistory();
    discussions.refreshSummary(selection.value);
  });
  function filtersChanged() {
    limit = 10;
    expanded.clear();
    if (document.querySelector('#content-filter').value === 'technical')
      document.querySelector('#review-filter').value = 'all';
    updateHistory();
    const url = new URL(document.querySelector('#share-app').href);
    history.replaceState(null, '', url);
  }
  for (const id of filterIds)
    document
      .getElementById(id)
      .addEventListener(id === 'notes-search' ? 'input' : 'change', filtersChanged);
  document.querySelector('#clear-filters').addEventListener('click', () => {
    for (const id of filterIds)
      document.getElementById(id).value = id === 'notes-search' ? '' : 'all';
    filtersChanged();
  });
  for (const [id, open] of [
    ['expand-all', true],
    ['collapse-all', false],
  ])
    document.getElementById(id).addEventListener('click', () => {
      for (const release of apps.find((app) => app.repository === selection.value)?.releases ?? [])
        expanded.set(selection.value + '/' + release.version, open);
      updateHistory();
    });
  document.querySelector('#load-more').addEventListener('click', () => {
    limit += 10;
    updateHistory();
  });
  document
    .querySelector('#refresh-review')
    .addEventListener('click', () => discussions.refreshSummary(selection.value));
  document.addEventListener('review-changed', (event) => {
    if (event.detail === selection.value) updateHistory();
  });
  updateHistory();
}
try {
  const response = await fetch('./data.json', { cache: 'no-store' });
  if (!response.ok) throw new Error();
  const snapshot = await response.json();
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.apps)) throw new Error();
  const apps = snapshot.apps;
  const released = apps.filter((app) => app.version).length;
  const adopted = apps.filter((app) => app.tooling.version).length;
  for (const id of ['total', 'nav-count', 'app-count', 'all-count'])
    document.getElementById(id).textContent = apps.length;
  for (const id of ['released', 'released-count'])
    document.getElementById(id).textContent = released;
  document.querySelector('#unreleased-count').textContent = apps.filter(
    (app) => app.status === 'unreleased',
  ).length;
  document.querySelector('#adopted').textContent = adopted;
  const percent = apps.length ? Math.round((adopted / apps.length) * 100) : 0;
  document.querySelector('#adoption-percent').textContent = `${percent}%`;
  document.querySelector('#adoption-progress').value = percent;
  document.querySelector('#adoption-note').textContent =
    `${adopted} de ${apps.length} aplicações têm uma versão de tooling identificada na última publicação.`;
  document.querySelector('#updated').textContent =
    portugueseDate(snapshot.generatedAt) +
    (Date.now() - Date.parse(snapshot.generatedAt) > 7200000 ? ' · Atualização em atraso' : '');
  let filter = 'all';
  function update() {
    const query = document.querySelector('#search').value.toLocaleLowerCase('pt-PT').trim();
    const visible = apps.filter(
      (app) =>
        `${app.name} ${app.repository}`.toLocaleLowerCase('pt-PT').includes(query) &&
        (filter === 'all' ||
          (filter === 'released' ? Boolean(app.version) : app.status === 'unreleased')),
    );
    visible.sort(
      document.querySelector('#sort').value === 'name'
        ? (a, b) => a.name.localeCompare(b.name, 'pt-PT')
        : (a, b) => (Date.parse(b.releasedAt) || 0) - (Date.parse(a.releasedAt) || 0),
    );
    renderCards(visible);
    document.querySelector('#message').textContent = !visible.length
      ? 'Nenhuma aplicação corresponde aos filtros.'
      : apps.some((app) => app.status === 'unavailable')
        ? 'Algumas aplicações estão indisponíveis. Verifique o acesso aos repositórios.'
        : '';
  }
  for (const button of document.querySelectorAll('[data-filter]'))
    button.addEventListener('click', () => {
      filter = button.dataset.filter;
      for (const choice of document.querySelectorAll('[data-filter]')) {
        choice.classList.toggle('active', choice === button);
        choice.setAttribute('aria-pressed', String(choice === button));
      }
      update();
    });
  document.querySelector('#search').addEventListener('input', update);
  document.querySelector('#sort').addEventListener('change', update);
  renderActivity(apps);
  setupReleaseHub(apps, snapshot.defaultApp);
  discussions.restoreLink(apps);
  for (const app of apps) discussions.refreshSummary(app.repository);
  document.querySelector('a[href="#apps"]').addEventListener('click', () => {
    document.querySelector('#apps').open = true;
  });
  update();
} catch {
  document.querySelector('#updated').textContent = 'Informação indisponível';
  document.querySelector('#message').textContent =
    'Não foi possível carregar as versões. Tente novamente dentro de instantes.';
}
