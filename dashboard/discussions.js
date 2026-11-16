export function portugueseDate(value) {
  const parts = new Intl.DateTimeFormat('pt-PT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/Lisbon',
  }).formatToParts(new Date(value));
  const part = (name) => parts.find((entry) => entry.type === name)?.value;
  return `${part('day')} de ${part('month')}, ${part('year')} ${part('hour')}:${part('minute')}`;
}

const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
};

export function createDiscussions() {
  let participantId = crypto.randomUUID();
  try {
    const saved = localStorage.getItem('tooling-discussion-participant');
    if (/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(saved ?? '')) participantId = saved;
    localStorage.setItem('tooling-discussion-participant', participantId);
  } catch {
    /* Keep the identity for this page when storage is unavailable. */
  }

  const dialog = node('dialog', undefined, 'discussion-dialog');
  dialog.id = 'discussion';
  dialog.setAttribute('aria-labelledby', 'discussion-title');
  const heading = node('div', undefined, 'discussion-heading');
  const title = node('h2', '💬 Conversa');
  title.id = 'discussion-title';
  const close = node('button', 'Fechar', 'quiet-button');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  heading.append(title, close);
  const contextLabel = node('p', undefined, 'discussion-context');
  const quote = node('blockquote', undefined, 'discussion-quote');
  const status = node('p', undefined, 'discussion-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const toolbar = node('div', undefined, 'discussion-toolbar');
  const share = node('a', '🔗 Ligação para esta conversa');
  const refresh = node('button', 'Atualizar', 'quiet-button');
  refresh.type = 'button';
  const resolve = node('button', 'Marcar como resolvida', 'quiet-button');
  resolve.type = 'button';
  toolbar.append(share, refresh, resolve);
  resolve.addEventListener('click', async () => {
    if (!active) return;
    resolve.disabled = true;
    try {
      await setState(active, 'closed', !state(active).closed);
      resolve.textContent = state(active).closed ? 'Reabrir conversa' : 'Marcar como resolvida';
      status.textContent = state(active).closed ? 'Conversa resolvida' : 'Conversa reaberta';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      resolve.disabled = false;
    }
  });
  const list = node('ol', undefined, 'comment-list');
  const more = node('button', 'Carregar comentários anteriores', 'quiet-button');
  more.type = 'button';
  more.hidden = true;
  const form = node('form', undefined, 'comment-form');
  const nameLabel = node('label', 'O seu nome');
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
  const kindLabel = node('label', 'Tipo de comentário');
  const kind = node('select');
  kind.name = 'kind';
  for (const [value, text] of [
    ['comment', '💬 Comentário'],
    ['question', '❓ Pergunta'],
    ['issue', '🐛 Problema / nova descoberta'],
  ]) {
    const option = node('option', text);
    option.value = value;
    kind.append(option);
  }
  kindLabel.append(kind);
  const bodyLabel = node('label', 'Comentário');
  const body = node('textarea');
  body.name = 'body';
  body.required = true;
  body.maxLength = 4000;
  body.rows = 4;
  body.placeholder =
    'O que aconteceu? O que esperava? Se encontrou um problema, indique os passos para o reproduzir.';
  bodyLabel.append(body);
  const submit = node('button', 'Enviar comentário', 'submit-comment');
  submit.type = 'submit';
  const identityNote = node(
    'p',
    'Os seus comentários aparecem como «Tu» neste navegador. Os nomes são indicados pelos participantes.',
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
  const reviewStates = new Map();
  const errors = new Set();
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
      throw new Error(
        'As conversas estão temporariamente indisponíveis. O seu rascunho fica guardado aqui',
      );
    }
    if (!response.ok) throw new Error(data.error ?? 'Não foi possível carregar as conversas');
    return data;
  }
  function render() {
    list.replaceChildren();
    for (const comment of [...comments.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )) {
      const mine = comment.participantId === participantId;
      const item = node('li', undefined, mine ? 'comment comment-mine' : 'comment comment-other');
      const header = node('div', undefined, 'comment-heading');
      const time = node('time', portugueseDate(comment.createdAt));
      time.dateTime = comment.createdAt;
      header.append(node('strong', comment.author));
      if (mine) header.append(node('span', 'Tu', 'comment-self'));
      header.append(time);
      if (comment.kind !== 'comment')
        header.append(
          node('span', comment.kind === 'issue' ? '🐛 Problema' : '❓ Pergunta', 'comment-kind'),
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
        ? `${result.total} comentário${result.total === 1 ? '' : 's'} nesta conversa`
        : 'Ainda não há comentários. Comece a conversa.';
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
  function state(context) {
    return {
      count: summaries.get(context.repository)?.[context.version]?.[context.item] ?? 0,
      validated:
        reviewStates.get(context.repository)?.[context.version]?.[context.item]?.validated ?? false,
      closed:
        reviewStates.get(context.repository)?.[context.version]?.[context.item]?.closed ?? false,
    };
  }
  async function setState(context, field, value) {
    await api(
      {},
      {
        repository: context.repository,
        version: context.version,
        item: context.item,
        action: 'state',
        field,
        value,
        requestId: crypto.randomUUID(),
      },
    );
    if (!(await refreshSummary(context.repository)))
      throw new Error('Estado guardado. Atualize a revisão para o confirmar.');
  }
  async function refreshSummary(repository) {
    try {
      const result = await api({ repository, view: 'summary' });
      summaries.set(repository, result.summary);
      reviewStates.set(repository, result.states ?? {});
      errors.delete(repository);
      updateCounts();
      document.dispatchEvent(new CustomEvent('review-changed', { detail: repository }));
      return true;
    } catch {
      errors.add(repository);
      document.dispatchEvent(new CustomEvent('review-changed', { detail: repository }));
      return false;
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
    resolve.textContent = state(context).closed ? 'Reabrir conversa' : 'Marcar como resolvida';
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
      if (!document.hidden) {
        load(false, true);
        refreshSummary(active.repository);
      }
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
      participantId,
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
        status.textContent = 'Comentário enviado';
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
    state,
    isLoaded: (repository) => summaries.has(repository),
    hasError: (repository) => errors.has(repository),
    item(context) {
      const item = node('li', undefined, 'change-item');
      const current = state(context);
      if (current.validated && !context.technical) item.classList.add('is-validated');
      const trigger = node('button', undefined, 'item-trigger');
      trigger.type = 'button';
      trigger.dataset.focusKey = keyOf(context) + '/open';
      trigger.setAttribute('aria-label', 'Abrir conversa: ' + context.text);
      const copy = node('span', undefined, 'change-copy');
      const split = context.text.indexOf(': ');
      if (split > 0 && split < 45)
        copy.append(
          node('strong', context.text.slice(0, split + 1)),
          document.createTextNode(context.text.slice(split + 1)),
        );
      else copy.textContent = context.text;
      const arrow = node('span', '↗', 'item-arrow');
      arrow.setAttribute('aria-hidden', 'true');
      trigger.append(copy, arrow);
      trigger.addEventListener('click', () => open(context));
      const actions = node('div', undefined, 'item-actions');
      const validate = node(
        'button',
        current.validated ? '✓ Validado' : '○ Por validar',
        'validation-button',
      );
      validate.type = 'button';
      validate.dataset.focusKey = keyOf(context) + '/validate';
      validate.disabled = !summaries.has(context.repository);
      validate.setAttribute('aria-pressed', String(current.validated));
      validate.setAttribute(
        'aria-label',
        (current.validated ? 'Retirar validação: ' : 'Validar: ') + context.text,
      );
      validate.addEventListener('click', async () => {
        validate.disabled = true;
        try {
          await setState(context, 'validated', !current.validated);
        } catch (error) {
          validate.disabled = false;
          feedback.textContent = error.message;
        }
      });
      const conversation = node(
        'button',
        current.count
          ? `💬 ${current.count} · ${current.closed ? 'Resolvida' : 'Em aberto'}`
          : '💬 Iniciar conversa',
        'conversation-link',
      );
      conversation.type = 'button';
      conversation.dataset.focusKey = keyOf(context) + '/conversation';
      conversation.addEventListener('click', () => open(context));
      const feedback = node('span', undefined, 'item-feedback');
      feedback.setAttribute('role', 'status');
      if (!context.technical) actions.append(validate);
      actions.append(conversation);
      item.append(trigger, actions, feedback);
      return item;
    },
    button(context, label = '💬 Conversar') {
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
          text: entry?.text ?? 'Conversa sobre esta versão e novas descobertas',
        });
    },
  };
}
