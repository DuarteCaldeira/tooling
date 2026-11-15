const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
};

export function createDiscussions() {
  const dialog = node('dialog', undefined, 'discussion-dialog');
  dialog.id = 'discussion';
  dialog.setAttribute('aria-labelledby', 'discussion-title');
  const heading = node('div', undefined, 'discussion-heading');
  const title = node('h2', '💬 Discussion');
  title.id = 'discussion-title';
  const close = node('button', 'Close', 'quiet-button');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  heading.append(title, close);
  const contextLabel = node('p', undefined, 'discussion-context');
  const quote = node('blockquote', undefined, 'discussion-quote');
  const status = node('p', undefined, 'discussion-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const toolbar = node('div', undefined, 'discussion-toolbar');
  const share = node('a', '🔗 Link to this thread');
  const refresh = node('button', 'Refresh', 'quiet-button');
  refresh.type = 'button';
  toolbar.append(share, refresh);
  const list = node('ol', undefined, 'comment-list');
  const more = node('button', 'Load earlier comments', 'quiet-button');
  more.type = 'button';
  more.hidden = true;
  const form = node('form', undefined, 'comment-form');
  const nameLabel = node('label', 'Your display name');
  const author = node('input');
  author.name = 'author';
  author.required = true;
  author.minLength = 2;
  author.maxLength = 60;
  author.autocomplete = 'nickname';
  nameLabel.append(author);
  try {
    author.value = localStorage.getItem('tooling-discussion-name') ?? '';
  } catch {
    /* Storage can be disabled. */
  }
  const kindLabel = node('label', 'Comment type');
  const kind = node('select');
  kind.name = 'kind';
  for (const [value, text] of [
    ['comment', '💬 Comment'],
    ['question', '❓ Question'],
    ['issue', '🐛 Issue / new finding'],
  ]) {
    const option = node('option', text);
    option.value = value;
    kind.append(option);
  }
  kindLabel.append(kind);
  const bodyLabel = node('label', 'Comment');
  const body = node('textarea');
  body.name = 'body';
  body.required = true;
  body.maxLength = 4000;
  body.rows = 4;
  body.placeholder =
    'What happened? What did you expect? Add steps to reproduce if you found an issue.';
  bodyLabel.append(body);
  const submit = node('button', 'Post comment', 'submit-comment');
  submit.type = 'submit';
  const identityNote = node(
    'p',
    'Shared with everyone who can access this dashboard. Display names are provided by participants.',
    'identity-note',
  );
  form.append(nameLabel, kindLabel, bodyLabel, identityNote, submit);
  dialog.append(heading, contextLabel, quote, toolbar, status, list, more, form);
  document.body.append(dialog);

  let active;
  let generation = 0;
  let nextCursor = null;
  let request;
  let polling;
  const comments = new Map();
  const drafts = new Map();
  const summaries = new Map();
  const controls = new Set();
  const keyOf = (context) => `${context.repository}\n${context.version}\n${context.item}`;
  async function api(params, payload) {
    const query = new URLSearchParams(params);
    const response = await fetch(
      `/api/discussions?${query}`,
      payload
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        : { cache: 'no-store' },
    );
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('Shared discussions are temporarily unavailable. Your draft is kept here');
    }
    if (!response.ok) throw new Error(data.error ?? 'Could not load shared discussions');
    return data;
  }
  function render() {
    list.replaceChildren();
    for (const comment of [...comments.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )) {
      const item = node('li', undefined, 'comment');
      const header = node('div', undefined, 'comment-heading');
      const time = node(
        'time',
        new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(comment.createdAt),
        ),
      );
      time.dateTime = comment.createdAt;
      header.append(node('strong', comment.author), time);
      if (comment.kind !== 'comment')
        header.append(
          node('span', comment.kind === 'issue' ? '🐛 Issue' : '❓ Question', 'comment-kind'),
        );
      item.append(header, node('p', comment.body));
      list.append(item);
    }
    more.hidden = !nextCursor;
  }
  async function load(earlier = false, quiet = false) {
    if (!active) return;
    const current = generation;
    if (!quiet) status.textContent = 'Loading shared comments…';
    try {
      const result = await api({
        repository: active.repository,
        version: active.version,
        item: active.item,
        ...(earlier && nextCursor ? { cursor: nextCursor } : {}),
      });
      if (current !== generation) return;
      for (const comment of result.comments) comments.set(comment.id, comment);
      if (earlier || !quiet) nextCursor = result.nextCursor;
      render();
      status.textContent = comments.size
        ? `${result.total} comment${result.total === 1 ? '' : 's'} in this thread`
        : 'No comments yet. Start the conversation.';
    } catch (error) {
      if (current === generation) status.textContent = error.message;
    }
  }
  function updateCounts() {
    for (const control of [...controls]) {
      if (!control.button.isConnected) {
        controls.delete(control);
        continue;
      }
      const count = summaries.get(control.repository)?.[control.version]?.[control.item];
      control.button.textContent =
        count === undefined || count === 0 ? control.label : `${control.label} (${count})`;
    }
  }
  async function refreshSummary(repository) {
    try {
      summaries.set(repository, (await api({ repository, view: 'summary' })).summary);
      updateCounts();
    } catch {
      /* The thread displays actionable errors when opened. */
    }
  }
  function saveDraft() {
    if (active) drafts.set(keyOf(active), { body: body.value, kind: kind.value, request });
  }
  function open(context) {
    saveDraft();
    generation++;
    active = context;
    request = null;
    comments.clear();
    nextCursor = null;
    list.replaceChildren();
    more.hidden = true;
    contextLabel.textContent = `${context.appName} · ${context.version}`;
    quote.textContent = context.text;
    const draft = drafts.get(keyOf(context));
    request = draft?.request ?? null;
    body.value = draft?.body ?? '';
    kind.value = draft?.kind ?? 'comment';
    const url = new URL(location.href);
    url.searchParams.set('app', context.repository);
    url.searchParams.set('release', context.version);
    url.searchParams.set('item', context.item);
    url.hash = 'discussion';
    share.href = url.toString();
    if (!dialog.open) dialog.showModal();
    load();
    clearInterval(polling);
    polling = setInterval(() => {
      if (!document.hidden) load(false, true);
    }, 15000);
  }
  dialog.addEventListener('close', () => {
    saveDraft();
    generation++;
    clearInterval(polling);
  });
  refresh.addEventListener('click', () => load());
  more.addEventListener('click', () => load(true));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!active || submit.disabled) return;
    const context = active;
    const current = generation;
    const value = {
      repository: context.repository,
      version: context.version,
      item: context.item,
      author: author.value.trim(),
      body: body.value.trim(),
      kind: kind.value,
    };
    const signature = JSON.stringify(value);
    if (request?.signature !== signature) request = { signature, id: crypto.randomUUID() };
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    status.textContent = 'Posting comment…';
    try {
      const result = await api({}, { ...value, requestId: request.id });
      try {
        localStorage.setItem('tooling-discussion-name', value.author);
      } catch {
        /* The comment is already saved on the server. */
      }
      drafts.delete(keyOf(context));
      if (current === generation) {
        comments.set(result.comment.id, result.comment);
        body.value = '';
        request = null;
        render();
        status.textContent = 'Comment posted';
      }
      refreshSummary(context.repository);
    } catch (error) {
      if (current === generation) status.textContent = error.message;
    } finally {
      submit.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
  return {
    open,
    refreshSummary,
    button(context, label = '💬 Discuss') {
      const button = node('button', label, 'discuss-button');
      button.type = 'button';
      button.setAttribute('aria-label', `${label}: ${context.text}`);
      button.addEventListener('click', () => open(context));
      controls.add({ ...context, button, label });
      const count = summaries.get(context.repository)?.[context.version]?.[context.item];
      if (count) button.textContent = `${label} (${count})`;
      return button;
    },
    restoreLink(apps) {
      const params = new URLSearchParams(location.search);
      const app = apps.find((entry) => entry.repository === params.get('app'));
      const release = app?.releases.find((entry) => entry.version === params.get('release'));
      const item = params.get('item');
      const entry = [...(release?.items ?? []), ...(release?.technicalItems ?? [])].find(
        (entry) => entry.id === item,
      );
      if (release && (item === 'release' || entry))
        open({
          repository: app.repository,
          version: release.version,
          item,
          appName: app.name,
          text: entry?.text ?? 'Release discussion and new findings',
        });
    },
  };
}
