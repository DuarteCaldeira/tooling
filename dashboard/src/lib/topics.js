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

const topicRules = [
  [
    'acessibilidade',
    'Acessibilidade',
    '♿',
    /acessib|contraste|leitor de ecra|zoom|texto.*legivel|foco|botoes maiores|movimento reduzido/,
  ],
  [
    'seguranca',
    'Segurança',
    '🔐',
    /seguran|protec|privacidade|bloqueio|encript|autentic|dados.*(?:temporar|memoria)/,
  ],
  [
    'performance',
    'Performance',
    '⚡',
    /rapid|desempenho|performance|mais leve|otimiz|redesenha|depressa|lentidao|grava varios/,
  ],
  [
    'dados',
    'Dados',
    '🗂️',
    /import|export|ficheiro|relatorio|dados|leitura|backup|copia de seguranca|sincron|guard|sns/,
  ],
  [
    'ux',
    'UX',
    '✨',
    /aspeto|visual|apresenta|menu|layout|ecra|separador|botao|cartao|navega|lista|filtro|pesquisa|formulario|interface|seta/,
  ],
];
const appAreas = [
  ['exames', 'Exames', /\bexames?\b/],
  ['analises', 'Análises', /\banalises?\b|leucocitos|laboratorio/],
  ['consultas', 'Consultas', /\bconsultas?\b/],
  ['medicacao', 'Medicação', /medicacao|receitas|registar toma/],
  ['vacinas', 'Vacinas', /vacin/],
  ['perfil', 'Perfil', /perfil|parentesco|grupo sanguineo/],
  ['treinos', 'Treinos', /treinos?|workout|renpho/],
  ['exploracao', 'Exploração', /explora|percursos?|mapa|freguesias/],
  ['progresso', 'Progresso', /progresso|recordes?|graficos/],
  ['competicao', 'Competição', /competir|competicao|liga|classificacao/],
  ['nutricao', 'Nutrição', /nutricao|alimentacao|refeicoes/],
  ['pesquisa', 'Pesquisa', /pesquisa/],
  ['backup', 'Cópia de segurança', /copia de seguranca|backup/],
  ['importacao', 'Importação', /importacao|carregar ficheiros|ficheiros carregados/],
  ['definicoes', 'Definições', /definicoes|preferencias/],
];
// Every change gets at least one tag besides its area: when no theme matches, the kind of
// change is used instead, so the same few tags can be reused across apps.
const changeTypes = {
  novidade: { id: 'novidade', label: 'Novidade', emoji: '🆕', kind: 'type' },
  correcao: { id: 'correcao', label: 'Correção', emoji: '🐛', kind: 'type' },
  melhoria: { id: 'melhoria', label: 'Melhoria', emoji: '📈', kind: 'type' },
  manutencao: { id: 'manutencao', label: 'Manutenção', emoji: '🛠️', kind: 'neutral' },
  testes: { id: 'testes', label: 'Testes', emoji: '🧪', kind: 'neutral' },
  refatoracao: { id: 'refatoracao', label: 'Refatoração', emoji: '♻️', kind: 'neutral' },
  documentacao: { id: 'documentacao', label: 'Documentação', emoji: '📝', kind: 'neutral' },
};
const commitTypes = {
  feat: 'novidade',
  fix: 'correcao',
  perf: 'melhoria',
  refactor: 'refatoracao',
  test: 'testes',
  tests: 'testes',
  docs: 'documentacao',
};
function changeType(text, normalized, technical) {
  if (technical) {
    const prefix = /^(\w+)(?:\([^)]*\))?!?:/.exec(normalized)?.[1];
    return changeTypes[commitTypes[prefix] ?? 'manutencao'];
  }
  if (
    /corrig|erro|falha|bug|resolv|ja nao|deixa de|nunca e|sem repeticoes|cortad|volta a|em vez de/.test(
      normalized,
    )
  )
    return changeTypes.correcao;
  if (
    /nov[oa]s?|passa a|permite|marca |diz onde|consultar|criar|editar|lembretes|notificac|adicion|catalogo|disponivel|pagina propria|registar|mostra|mapa|ja (?:pode|aparece)/.test(
      normalized,
    )
  )
    return changeTypes.novidade;
  return changeTypes.melhoria;
}

export function itemTopics(text, technical = false) {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-PT');
  const prefix = normalized.split(':')[0];
  const area =
    appAreas.find(([, , rule]) => rule.test(prefix)) ??
    appAreas.find(([, , rule]) => rule.test(normalized));
  const topics = [];
  if (area) topics.push({ id: area[0], label: area[1], emoji: '📍', kind: 'area' });
  for (const [id, label, emoji, rule] of topicRules) {
    if (rule.test(normalized)) topics.push({ id, label, emoji, kind: id });
  }
  if (!topics.some((topic) => topic.kind !== 'area'))
    topics.push(changeType(text, normalized, technical));
  return topics;
}

export const normalize = (text) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-PT');
