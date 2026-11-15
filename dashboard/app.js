const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});
function githubLink(text, url, className) {
  const link = element('a', text, className);
  if (typeof url === 'string' && url.startsWith('https://github.com/')) link.href = url;
  return link;
}
function releaseDate(value) {
  if (!value) return element('span', 'No release yet', 'value muted');
  const time = element('time', dateFormat.format(new Date(value)), 'value');
  time.dateTime = value;
  time.title = `${dateTimeFormat.format(new Date(value))} UTC`;
  return time;
}
function toolingValue(tooling) {
  const block = element('div');
  if (tooling.version) {
    block.append(element('span', tooling.version, 'value mono'));
    if (tooling.revision)
      block.append(element('small', tooling.revision.slice(0, 7), 'detail mono'));
  } else {
    const labels = {
      'not-adopted': 'Not adopted',
      unresolved: 'Unresolved',
      unknown: 'Not available',
    };
    block.append(element('span', labels[tooling.status] ?? 'Not available', 'value muted'));
    if (tooling.declared)
      block.append(element('small', `Declared: ${tooling.declared}`, 'detail mono'));
  }
  return block;
}
function renderCards(apps) {
  const cards = document.querySelector('#cards');
  cards.replaceChildren();
  for (const app of apps) {
    const card = element('article', undefined, 'app-card');
    const header = element('div', undefined, 'card-header');
    const identity = element('div', undefined, 'identity');
    const tones = ['blue', 'violet', 'amber', 'rose', 'green'];
    const tone =
      [...app.repository].reduce((sum, char) => sum + char.charCodeAt(0), 0) % tones.length;
    const avatar = element('span', app.name.slice(0, 1).toUpperCase(), `app-icon ${tones[tone]}`);
    avatar.setAttribute('aria-hidden', 'true');
    const title = element('div');
    const heading = element('h3');
    heading.append(githubLink(app.name, app.repositoryUrl));
    title.append(heading, element('p', app.repository.split('/')[1], 'repo-name'));
    identity.append(avatar, title);
    header.append(identity);
    const state =
      app.status === 'unavailable' || app.status === 'partial'
        ? 'Needs attention'
        : app.prerelease
          ? 'Prerelease'
          : app.version
            ? 'Released'
            : 'Unreleased';
    const status = element(
      'span',
      state,
      `badge ${state === 'Released' ? 'badge-released' : state === 'Needs attention' ? 'badge-warning' : ''}`,
    );
    const versionBlock = element('div', undefined, 'version-block');
    const versionHeading = element('div', undefined, 'version-heading');
    versionHeading.append(element('span', 'APP VERSION', 'metric-label'), status);
    versionBlock.append(
      versionHeading,
      app.version
        ? githubLink(app.version, app.releaseUrl, 'app-version mono')
        : element(
            'p',
            app.status === 'unreleased' ? 'No releases yet' : 'Unavailable',
            'app-version no-version',
          ),
    );
    const metrics = element('dl', undefined, 'card-metrics');
    const tooling = element('div');
    const toolingData = element('dd');
    toolingData.append(toolingValue(app.tooling));
    tooling.append(element('dt', 'Tooling version'), toolingData);
    const date = element('div');
    const dateData = element('dd');
    dateData.append(releaseDate(app.releasedAt));
    date.append(element('dt', 'Last release'), dateData);
    metrics.append(tooling, date);
    const footer = element('div', undefined, 'card-footer');
    footer.append(
      element(
        'span',
        app.tooling.version
          ? 'Shared tooling tracked'
          : app.status === 'partial'
            ? 'Tooling check failed'
            : app.version
              ? 'Published on GitHub'
              : 'Waiting for a first release',
        'card-note',
      ),
    );
    const link = githubLink(
      app.version ? 'View release' : 'Repository',
      app.version ? app.releaseUrl : app.repositoryUrl,
      'card-link',
    );
    link.append(element('span', ' ↗'));
    footer.append(link);
    card.append(header, versionBlock, metrics, footer);
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
    const dot = element('span', undefined, 'timeline-dot');
    dot.setAttribute('aria-hidden', 'true');
    const content = element('div');
    content.append(
      element('p', app.name, 'activity-name'),
      githubLink(app.version, app.releaseUrl, 'activity-version mono'),
      releaseDate(app.releasedAt),
    );
    item.append(dot, content);
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
  }
  selection.value =
    apps.find((app) => app.repository === query)?.repository ??
    apps.find((app) => app.repository === defaultApp)?.repository ??
    apps[0]?.repository ??
    '';
  let limit = 10;
  function updateHistory() {
    const app = apps.find((app) => app.repository === selection.value);
    const feed = document.querySelector('#release-feed');
    feed.replaceChildren();
    const all = app?.releases ?? [];
    const search = document.querySelector('#notes-search').value.toLocaleLowerCase().trim();
    const onlyProduct = document.querySelector('#product-only').checked;
    const matches = all.filter(
      (release) =>
        (!onlyProduct || release.source !== 'github') &&
        `${release.version} ${release.releasedAt} ${release.notes.join(' ')} ${release.originalNotes}`
          .toLocaleLowerCase()
          .includes(search),
    );
    document.querySelector('#notes-context').textContent = app
      ? `${app.name} · ${all.length} published releases · Newest first`
      : 'No application selected';
    document.querySelector('#notes-message').textContent = !app
      ? 'No apps configured yet.'
      : app.status === 'unavailable'
        ? 'Release history is unavailable. Please try again after the next sync.'
        : !all.length
          ? 'No published releases yet. Updates will appear here after the first release.'
          : !matches.length
            ? 'No releases match your search.'
            : '';
    const share = new URL(location.href);
    share.searchParams.set('app', selection.value);
    share.hash = 'release-notes';
    document.querySelector('#share-app').href = share.toString();
    for (const [index, release] of matches.slice(0, limit).entries()) {
      const article = element(
        'article',
        undefined,
        `release-entry ${release.source === 'github' ? 'source-entry' : ''}`,
      );
      article.id = `release-${release.version.replace(/[^a-z\d.-]/gi, '-')}`;
      const heading = element('div', undefined, 'release-heading');
      const identity = element('div', undefined, 'release-identity');
      const title = element('h3', release.version, 'mono');
      identity.append(element('span', '↗', 'release-icon'), title);
      if (index === 0 && !search && !onlyProduct)
        identity.append(element('span', 'Latest', 'badge badge-released'));
      if (release.prerelease) identity.append(element('span', 'Prerelease', 'badge'));
      const date = releaseDate(release.releasedAt);
      heading.append(identity, date);
      article.append(heading);
      if (release.notes.length) {
        const list = element('ul', undefined, 'change-list');
        list.lang = release.language ?? 'en';
        for (const note of release.notes) {
          const item = element('li');
          const split = note.indexOf(': ');
          if (split > 0 && split < 45)
            item.append(
              element('strong', note.slice(0, split + 1)),
              document.createTextNode(note.slice(split + 1)),
            );
          else item.textContent = note;
          list.append(item);
        }
        article.append(list);
      } else {
        article.append(
          element('p', 'Product summary not available for this release.', 'source-note'),
        );
        const original = element('details', undefined, 'original-notes');
        original.append(element('summary', 'Read original GitHub notes'));
        original.append(
          element('pre', release.originalNotes || 'No release notes were published.'),
        );
        article.append(original);
      }
      const footer = element('div', undefined, 'release-footer');
      footer.append(
        element(
          'span',
          release.source === 'github' ? 'GitHub notes · Not edited for product' : 'Product notes',
          'source-label',
        ),
        githubLink('View on GitHub ↗', release.url, 'text-link'),
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
    url.hash = 'release-notes';
    history.replaceState(null, '', url);
    updateHistory();
  });
  for (const id of ['notes-search', 'product-only'])
    document.getElementById(id).addEventListener(id === 'notes-search' ? 'input' : 'change', () => {
      limit = 10;
      updateHistory();
    });
  document.querySelector('#load-more').addEventListener('click', () => {
    limit += 10;
    updateHistory();
  });
  updateHistory();
}
try {
  const response = await fetch('./data.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Release data unavailable');
  const snapshot = await response.json();
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.apps))
    throw new Error('Unsupported release data');
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
    `${adopted} of ${apps.length} apps have a resolved tooling version at their latest release.`;
  const checked = new Date(snapshot.generatedAt);
  const stale = Date.now() - checked.getTime() > 2 * 60 * 60 * 1000;
  document.querySelector('#updated').textContent =
    `${dateTimeFormat.format(checked)} UTC${stale ? ' · Refresh overdue' : ''}`;
  if (stale) document.querySelector('#updated').classList.add('attention');
  const message = document.querySelector('#message');
  const problems = apps.filter((app) => ['unavailable', 'partial'].includes(app.status)).length;
  const warning = problems
    ? `${problems} app${problems === 1 ? '' : 's'} could not be fully checked.`
    : '';
  let filter = 'all';
  function update() {
    const query = document.querySelector('#search').value.toLocaleLowerCase().trim();
    const visible = apps.filter(
      (app) =>
        `${app.name} ${app.repository}`.toLocaleLowerCase().includes(query) &&
        (filter === 'all' ||
          (filter === 'released' ? Boolean(app.version) : app.status === 'unreleased')),
    );
    visible.sort(
      document.querySelector('#sort').value === 'name'
        ? (a, b) => a.name.localeCompare(b.name)
        : (a, b) =>
            (Date.parse(b.releasedAt) || 0) - (Date.parse(a.releasedAt) || 0) ||
            a.name.localeCompare(b.name),
    );
    renderCards(visible);
    message.textContent = !apps.length
      ? 'No apps configured yet.'
      : !visible.length
        ? 'No apps match your filters.'
        : warning;
    message.classList.toggle('empty', visible.length === 0);
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
  document.querySelector('a[href="#apps"]').addEventListener('click', () => {
    document.querySelector('#apps').open = true;
  });
  update();
} catch {
  document.querySelector('#updated').textContent = 'Release information unavailable';
  document.querySelector('#message').textContent =
    'We couldn’t load the release data. Please try again shortly.';
  document.querySelector('#activity-empty').hidden = false;
  document.querySelector('#adoption-note').textContent = 'Tooling information unavailable.';
}
