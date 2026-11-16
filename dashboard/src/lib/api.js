export async function api(params, payload) {
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

export const itemKey = (context) => `${context.repository}\n${context.version}\n${context.item}`;

export function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage can be disabled; the value then only lives for this page. */
  }
}

export function participantId() {
  let id = crypto.randomUUID();
  const saved = readStorage('tooling-discussion-participant');
  if (/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(saved ?? '')) id = saved;
  writeStorage('tooling-discussion-participant', id);
  return id;
}
