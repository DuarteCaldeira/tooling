import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Drawer,
  Select,
  Tag,
  Textarea,
  ToggleSwitch,
} from '@dcaldeira/design-system';
import { api, itemKey, readStorage, writeStorage } from '../lib/api.js';
import { itemTopics, portugueseDate } from '../lib/topics.js';
import { useConversationOverlay, usePolling } from '../hooks.js';

const kinds = [
  { value: 'comment', label: 'Comentário' },
  { value: 'question', label: 'Pergunta' },
  { value: 'issue', label: 'Problema' },
];
const kindLabels = { comment: 'Comentário', question: 'Pergunta', issue: 'Problema' };
const NAME_KEY = 'tooling-discussion-name';
const authors = ['QAren', 'DUveloper'].map((value) => ({ value, label: value }));

export function TopicTags({ text, technical }) {
  const topics = itemTopics(text, technical);
  return (
    <div className="topic-row">
      {topics.map((topic) => (
        <Tag key={topic.id} size="sm" variant={topic.kind === 'area' ? 'primary' : 'default'}>
          {`${topic.emoji} ${topic.label}`}
        </Tag>
      ))}
    </div>
  );
}

function Section({ title, aside, children, className = '' }) {
  return (
    <section className={`drawer-section ${className}`}>
      <header className="drawer-section-heading">
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function ConversationDrawer({ context, onClose, review, participantId, drafts }) {
  const open = Boolean(context);
  const contentRef = useRef(null);
  useConversationOverlay(open, contentRef);
  const [comments, setComments] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [author, setAuthor] = useState(() => {
    const saved = readStorage(NAME_KEY);
    return authors.some(({ value }) => value === saved) ? saved : 'QAren';
  });
  const [edit, setEdit] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const loadedCount = useRef(0);
  loadedCount.current = comments.length;
  const [kind, setKind] = useState('comment');
  const [body, setBody] = useState('');
  const generation = useRef(0);
  const request = useRef(null);
  const latest = useRef({ context, kind, body });
  latest.current = { context, kind, body };

  const state = context ? review.stateOf(context) : { closed: false, validated: false };
  const isRelease = context?.item === 'release';
  const canValidate = Boolean(context) && !isRelease && !context.technical;

  const load = useCallback(
    async ({ earlier = false, quiet = false, from = cursor } = {}) => {
      if (!context) return;
      const current = generation.current;
      if (!quiet) setStatus('A carregar os comentários…');
      try {
        let result = await api({
          repository: context.repository,
          version: context.version,
          item: context.item,
          ...(earlier && from ? { cursor: from } : {}),
        });
        const refreshed = [...result.comments];
        // Refresh loaded pages as well, so deleted comments disappear on every device.
        if (!earlier) {
          while (result.nextCursor && refreshed.length < loadedCount.current) {
            result = await api({
              repository: context.repository,
              version: context.version,
              item: context.item,
              cursor: result.nextCursor,
            });
            refreshed.push(...result.comments);
          }
        }
        if (current !== generation.current) return;
        setComments((existing) => {
          if (!earlier) return refreshed;
          const merged = new Map(existing.map((comment) => [comment.id, comment]));
          for (const comment of refreshed) merged.set(comment.id, comment);
          return [...merged.values()];
        });
        setCursor(result.nextCursor);
        setStatus('');
      } catch (error) {
        if (current === generation.current) setStatus(error.message);
      }
    },
    [context, cursor],
  );

  // Open / switch conversation: reset, restore the draft, load comments.
  const key = context ? itemKey(context) : null;
  useEffect(() => {
    generation.current++;
    setComments([]);
    setCursor(null);
    setStatus('');
    setNotice('');
    setBusy(false);
    setEdit(null);
    setDeleting(null);
    request.current = null;
    if (!key) return undefined;
    const draft = drafts.current.get(key);
    request.current = draft?.request ?? null;
    setBody(draft?.body ?? '');
    setKind(draft?.kind ?? 'comment');
    load({ from: null });
    return () => {
      drafts.current.set(key, {
        body: latest.current.body,
        kind: latest.current.kind,
        request: request.current,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  usePolling(
    () => {
      load({ quiet: true });
      review.refresh(context.repository);
    },
    15000,
    open && !busy,
  );

  const shareUrl = useMemo(() => {
    if (!context) return '';
    const url = new URL(location.href);
    url.searchParams.set('app', context.repository);
    url.searchParams.set('release', context.version);
    url.searchParams.set('item', context.item);
    url.hash = 'discussion';
    return url.toString();
  }, [context]);

  async function change(field, value, done) {
    if (!context || busy) return;
    const current = generation.current;
    setBusy(true);
    setNotice('');
    try {
      await review.setField(context, field, value);
      if (current === generation.current) setNotice(done);
    } catch (error) {
      if (current === generation.current) setNotice(error.message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setNotice('Ligação copiada');
    } catch {
      setNotice('Não foi possível copiar a ligação');
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!context || busy) return;
    const current = generation.current;
    const value = {
      repository: context.repository,
      version: context.version,
      item: context.item,
      author: author.trim(),
      body: body.trim(),
      kind,
      participantId,
    };
    const signature = JSON.stringify(value);
    if (request.current?.signature !== signature)
      request.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    setNotice('');
    setStatus('A enviar o comentário…');
    try {
      const result = await api({}, { ...value, requestId: request.current.id });
      writeStorage(NAME_KEY, value.author);
      drafts.current.delete(key);
      if (current === generation.current) {
        setComments((existing) => [
          ...existing.filter((comment) => comment.id !== result.comment.id),
          result.comment,
        ]);
        setBody('');
        request.current = null;
        setStatus('');
        setNotice('Comentário enviado');
      }
      review.refresh(context.repository);
    } catch (error) {
      if (current === generation.current) setStatus(error.message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  async function mutateComment(comment, action) {
    if (!context || busy) return;
    // Discard pending polls that still contain the old comment.
    const current = ++generation.current;
    setBusy(true);
    setNotice('');
    setStatus('');
    try {
      const result = await api(
        {},
        {
          repository: context.repository,
          version: context.version,
          item: context.item,
          action,
          id: comment.id,
          ...(action === 'edit' ? { body: edit.body } : {}),
        },
      );
      if (current !== generation.current) return;
      setComments((existing) =>
        action === 'delete'
          ? existing.filter(({ id }) => id !== comment.id)
          : existing.map((entry) => (entry.id === comment.id ? result.comment : entry)),
      );
      setEdit(null);
      setDeleting(null);
      setNotice(action === 'delete' ? 'Comentário eliminado' : 'Comentário atualizado');
      review.refresh(context.repository);
    } catch (error) {
      if (current === generation.current) setNotice(error.message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  const sorted = [...comments].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );

  // Closing must not depend on animationend (reduced motion can suppress it).
  return open ? (
    <Drawer
      isOpen={open}
      onClose={onClose}
      title={isRelease ? '🐛 Reportar bug' : '💬 Conversa'}
      subtitle={context ? `${context.appName} · ${context.version}` : undefined}
      closeLabel="Fechar"
      size="lg"
    >
      {context ? (
        <div className="conversation" ref={contentRef}>
          <Section title={isRelease ? 'Versão' : 'Alteração'} className="drawer-context">
            {isRelease ? null : <TopicTags text={context.text} technical={context.technical} />}
            <blockquote className="conversation-quote">{context.text}</blockquote>
          </Section>

          <Section title="Ações" className="drawer-actions">
            <div className="action-list">
              {canValidate ? (
                <ToggleSwitch
                  id="conversation-validated"
                  label="Validada"
                  helperText="Confirma que esta novidade está correta."
                  checked={state.validated}
                  disabled={busy || !review.isLoaded(context.repository)}
                  onChange={(event) =>
                    change(
                      'validated',
                      event.target.checked,
                      event.target.checked ? 'Marcada como validada' : 'Validação removida',
                    )
                  }
                />
              ) : null}
              <ToggleSwitch
                id="conversation-resolved"
                label="Conversa resolvida"
                helperText="Marca esta conversa como tratada. Pode reabri-la quando quiser."
                checked={state.closed}
                disabled={busy || !review.isLoaded(context.repository)}
                onChange={(event) =>
                  change(
                    'closed',
                    event.target.checked,
                    event.target.checked ? 'Conversa resolvida' : 'Conversa reaberta',
                  )
                }
              />
            </div>
            <div className="action-buttons">
              <Button variant="secondary" size="sm" onClick={copyLink}>
                Copiar ligação
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => load()}>
                Atualizar comentários
              </Button>
            </div>
            <p className="drawer-notice" role="status" aria-live="polite">
              {notice}
            </p>
          </Section>

          <Section
            title="Comentários"
            aside={<Badge variant="neutral" size="sm" text={`${sorted.length}`} />}
          >
            <p className="drawer-status" role="status" aria-live="polite">
              {status}
            </p>
            {sorted.length ? (
              <ol className="comment-list">
                {sorted.map((comment) => {
                  const mine = comment.participantId === participantId;
                  return (
                    <li key={comment.id} className={`comment ${mine ? 'comment-mine' : ''}`}>
                      <div className="comment-heading">
                        <strong>{comment.author}</strong>
                        {mine ? <span className="comment-self">Tu</span> : null}
                        {comment.kind !== 'comment' ? (
                          <span className="comment-kind">
                            {kindLabels[comment.kind] ?? comment.kind}
                          </span>
                        ) : null}
                        <time dateTime={comment.createdAt}>
                          {portugueseDate(comment.createdAt)}
                        </time>
                      </div>
                      {edit?.id === comment.id ? (
                        <form
                          className="comment-editor"
                          onSubmit={(event) => {
                            event.preventDefault();
                            mutateComment(comment, 'edit');
                          }}
                        >
                          <Textarea
                            id={`comment-edit-${comment.id}`}
                            label="Editar mensagem"
                            value={edit.body}
                            onChange={(event) =>
                              setEdit({ id: comment.id, body: event.target.value })
                            }
                            required
                            maxLength={4000}
                            rows={4}
                          />
                          <div className="action-buttons">
                            <Button type="submit" size="sm" disabled={busy || !edit.body.trim()}>
                              Guardar
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => setEdit(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <p>{comment.body}</p>
                      )}
                      {comment.updatedAt ? <span className="comment-edited">Editado</span> : null}
                      {deleting === comment.id ? (
                        <div className="comment-editor">
                          <p>Eliminar este comentário?</p>
                          <div className="action-buttons">
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => mutateComment(comment, 'delete')}
                            >
                              Confirmar eliminação
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => setDeleting(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : edit?.id === comment.id ? null : (
                        <div className="action-buttons">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              setEdit({ id: comment.id, body: comment.body });
                              setDeleting(null);
                            }}
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              setDeleting(comment.id);
                              setEdit(null);
                            }}
                          >
                            Eliminar
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : status ? null : (
              <p className="drawer-empty">Ainda não há comentários. Comece a conversa abaixo.</p>
            )}
            {cursor ? (
              <Button variant="ghost" size="sm" onClick={() => load({ earlier: true })}>
                Carregar comentários anteriores
              </Button>
            ) : null}
          </Section>

          <Section title="Novo comentário" className="drawer-form">
            <form className="comment-form" onSubmit={submit} aria-busy={busy}>
              <Select
                id="comment-author"
                label="Nome"
                options={authors}
                value={author}
                onChange={(value) => {
                  setAuthor(value);
                  writeStorage(NAME_KEY, value);
                }}
              />
              <Select
                id="comment-kind"
                label="Tipo"
                options={kinds}
                value={kind}
                onChange={setKind}
              />
              <Textarea
                id="comment-body"
                label="Mensagem"
                name="body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
                maxLength={4000}
                rows={4}
                placeholder="O que aconteceu? O que esperava? Se for um problema, indique os passos para o reproduzir."
              />
              <p className="identity-note">
                Os seus comentários aparecem como «Tu» neste navegador. Os nomes são indicados pelos
                participantes.
              </p>
              <Button type="submit" variant="primary" isLoading={busy}>
                Enviar comentário
              </Button>
            </form>
          </Section>
        </div>
      ) : null}
    </Drawer>
  ) : null;
}
