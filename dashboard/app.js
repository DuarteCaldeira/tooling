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
  function updateHistory() {
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
    const search = document.querySelector('#notes-search').value.toLocaleLowerCase('pt-PT').trim();
    const onlyProduct = document.querySelector('#product-only').checked;
    const filter = document.querySelector('#review-filter').value;
    const loaded = discussions.isLoaded(app?.repository);
    const itemMatches = (release, item) => {
      const state = discussions.state(context(app, release, item.id, item.text));
      const matchesSearch = `${release.version} ${portugueseDate(release.releasedAt)} ${item.text}`
        .toLocaleLowerCase('pt-PT')
        .includes(search);
      return (
        matchesSearch &&
        (filter === 'all' ||
          (loaded && (filter === 'pending' ? !state.validated : state.count > 0 && !state.closed)))
      );
    };
    const matches = all
      .map((release) => {
        const items = (release.items ?? release.notes.map((text) => ({ text }))).filter((item) =>
          itemMatches(release, item),
        );
        const technical = onlyProduct
          ? []
          : (release.technicalItems ?? []).filter((item) => itemMatches(release, item));
        const releaseState = discussions.state(context(app, release, 'release', ''));
        const releaseMatch =
          filter === 'discussions' &&
          loaded &&
          releaseState.count > 0 &&
          !releaseState.closed &&
          `${release.version} ${release.summaryContext ?? ''}`
            .toLocaleLowerCase('pt-PT')
            .includes(search);
        const emptyMatch =
          filter === 'all' &&
          !onlyProduct &&
          !release.notes.length &&
          !release.technicalItems?.length &&
          `${release.version} ${release.summaryContext ?? ''}`
            .toLocaleLowerCase('pt-PT')
            .includes(search);
        return {
          release,
          items,
          technical,
          visible: items.length || technical.length || releaseMatch || emptyMatch,
        };
      })
      .filter((entry) => entry.visible);
    const totalItems = all.flatMap((release) => [
      ...(release.items ?? []),
      ...(release.technicalItems ?? []),
    ]);
    let validated = 0,
      open = 0;
    for (const release of all) {
      for (const item of [...(release.items ?? []), ...(release.technicalItems ?? [])]) {
        const state = discussions.state(context(app, release, item.id, item.text));
        if (state.validated) validated++;
        if (state.count && !state.closed) open++;
      }
      const state = discussions.state(context(app, release, 'release', ''));
      if (state.count && !state.closed) open++;
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
      ? `${validated} de ${totalItems.length} alterações validadas`
      : 'A carregar o estado de revisão…';
    document.querySelector('#notes-context').textContent =
      `${all.length} versões publicadas · ${matches.length} nesta vista`;
    document.querySelector('#notes-message').textContent =
      app?.status === 'unavailable'
        ? 'Não foi possível consultar esta aplicação. Tente novamente após a próxima atualização.'
        : !all.length
          ? 'Ainda não há versões publicadas. As novidades vão aparecer aqui.'
          : filter !== 'all' && !loaded
            ? discussions.hasError(app?.repository)
              ? 'Não foi possível carregar os estados. Tente atualizar a revisão.'
              : 'A carregar validações e conversas…'
            : !matches.length
              ? 'Nenhuma alteração corresponde aos filtros.'
              : '';
    const share = new URL(location.href);
    share.searchParams.set('app', selection.value);
    share.searchParams.delete('release');
    share.searchParams.delete('item');
    share.hash = 'release-notes';
    document.querySelector('#share-app').href = share.toString();
    for (const { release, items, technical } of matches.slice(0, limit)) {
      const article = element('article', undefined, 'release-entry');
      article.id = `release-${release.version.replace(/[^a-z\d.-]/gi, '-')}`;
      const heading = element('div', undefined, 'release-heading');
      const identity = element('div', undefined, 'release-identity');
      const icon = element('span', '🚀', 'release-icon');
      icon.setAttribute('aria-hidden', 'true');
      identity.append(icon, element('h3', release.version, 'mono'));
      if (release === all[0])
        identity.append(element('span', 'Mais recente', 'badge badge-released'));
      if (release.prerelease) identity.append(element('span', 'Pré-lançamento', 'badge'));
      heading.append(identity, releaseDate(release.releasedAt));
      article.append(heading);
      if (items.length) {
        const list = element('ul', undefined, 'change-list');
        list.lang = release.language ?? 'pt-PT';
        for (const item of items)
          list.append(discussions.item(context(app, release, item.id, item.text)));
        article.append(list);
      } else if (!technical.length && filter === 'all') {
        article.append(
          element(
            'p',
            release.summaryContext ?? 'Esta versão não tem alterações funcionais descritas.',
            'source-note',
          ),
        );
      }
      if (technical.length) {
        const details = element('details', undefined, 'technical-notes');
        details.append(element('summary', `🛠️ Detalhes técnicos · ${technical.length}`));
        const list = element('ul', undefined, 'change-list technical-list');
        for (const item of technical)
          list.append(discussions.item(context(app, release, item.id, item.text)));
        details.append(list);
        article.append(details);
      }
      const footer = element('div', undefined, 'release-footer');
      footer.append(
        discussions.button(
          context(app, release, 'release', 'Conversa sobre esta versão e novas descobertas'),
          '💬 Conversa da versão',
        ),
        githubLink('Ver no GitHub ↗', release.url, 'text-link'),
      );
      article.append(footer);
      feed.append(article);
    }
    document.querySelector('#load-more').hidden = matches.length <= limit;
  }
  selection.addEventListener('change', () => {
    limit = 10;
    document.querySelector('#notes-search').value = '';
    const url = new URL(location.href);
    url.searchParams.set('app', selection.value);
    url.searchParams.delete('release');
    url.searchParams.delete('item');
    url.hash = 'release-notes';
    history.replaceState(null, '', url);
    updateHistory();
    discussions.refreshSummary(selection.value);
  });
  for (const id of ['notes-search', 'product-only', 'review-filter'])
    document.getElementById(id).addEventListener(id === 'notes-search' ? 'input' : 'change', () => {
      limit = 10;
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
