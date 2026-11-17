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
