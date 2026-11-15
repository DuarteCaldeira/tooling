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
function githubLink(text, url) {
  const link = element('a', text);
  // Only our GitHub links can become navigation targets, even with malformed data.
  if (typeof url === 'string' && url.startsWith('https://github.com/')) link.href = url;
  return link;
}
function toolingCell(tooling) {
  const cell = element('td');
  cell.dataset.label = 'Tooling version';
  if (tooling.version) {
    cell.append(element('span', tooling.version, 'version tooling-version'));
    if (tooling.revision)
      cell.append(element('small', tooling.revision.slice(0, 7), 'detail mono'));
  } else {
    const labels = {
      'not-adopted': 'Not adopted',
      unresolved: 'Version unresolved',
      unknown: 'Not available',
    };
    cell.append(element('span', labels[tooling.status] ?? 'Not available', 'muted'));
    if (tooling.declared)
      cell.append(element('small', `Declared: ${tooling.declared}`, 'detail mono'));
  }
  return cell;
}
function render(apps) {
  const rows = document.querySelector('#rows');
  rows.replaceChildren();
  for (const [index, app] of apps.entries()) {
    const row = element('tr');
    const name = element('th');
    name.scope = 'row';
    const identity = element('div', undefined, 'identity');
    const avatar = element('span', app.name.slice(0, 1).toUpperCase(), `avatar tone-${index % 4}`);
    avatar.setAttribute('aria-hidden', 'true');
    const title = element('div');
    title.append(
      githubLink(app.name, app.repositoryUrl),
      element('small', app.repository, 'detail'),
    );
    identity.append(avatar, title);
    name.append(identity);
    const version = element('td');
    version.dataset.label = 'App version';
    if (app.version) {
      const link = githubLink(app.version, app.releaseUrl);
      link.className = 'version';
      version.append(link);
      if (app.prerelease) version.append(element('small', 'Prerelease', 'detail'));
    } else
      version.append(
        element('span', app.status === 'unreleased' ? 'No releases yet' : 'Unavailable', 'muted'),
      );
    if (app.status === 'partial')
      version.append(element('small', 'Tooling check failed', 'detail attention'));
    const date = element('td');
    date.dataset.label = 'Last release';
    if (app.releasedAt) {
      const time = element('time', dateFormat.format(new Date(app.releasedAt)));
      time.dateTime = app.releasedAt;
      time.title = `${dateTimeFormat.format(new Date(app.releasedAt))} UTC`;
      date.append(time);
    } else date.append(element('span', '—', 'muted'));
    row.append(name, version, toolingCell(app.tooling), date);
    rows.append(row);
  }
}
try {
  const response = await fetch('./data.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Release data unavailable');
  const snapshot = await response.json();
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.apps))
    throw new Error('Unsupported release data');
  const apps = snapshot.apps;
  document.querySelector('#total').textContent = apps.length;
  document.querySelector('#released').textContent = apps.filter((app) => app.version).length;
  document.querySelector('#adopted').textContent = apps.filter((app) => app.tooling.version).length;
  const checked = new Date(snapshot.generatedAt);
  const stale = Date.now() - checked.getTime() > 2 * 60 * 60 * 1000;
  document.querySelector('#updated').textContent =
    `Last checked ${dateTimeFormat.format(checked)} UTC${stale ? ' · Refresh overdue' : ''}`;
  if (stale) document.querySelector('#updated').classList.add('attention');
  const message = document.querySelector('#message');
  const problems = apps.filter((app) => ['unavailable', 'partial'].includes(app.status)).length;
  const status = problems
    ? `${problems} app${problems === 1 ? '' : 's'} could not be fully checked. Review the dashboard workflow.`
    : '';
  message.textContent = apps.length ? status : 'No apps configured yet.';
  render(apps);
  document.querySelector('#search').addEventListener('input', (event) => {
    const query = event.target.value.toLocaleLowerCase().trim();
    const matches = apps.filter((app) =>
      `${app.name} ${app.repository}`.toLocaleLowerCase().includes(query),
    );
    render(matches);
    message.textContent = matches.length ? status : 'No apps match your search.';
  });
} catch {
  document.querySelector('#updated').textContent = 'Release information unavailable';
  document.querySelector('#message').textContent =
    'We couldn’t load the release data. Please try again shortly.';
}
