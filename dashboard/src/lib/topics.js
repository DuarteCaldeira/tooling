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
  if (!topics.length)
    topics.push(
      technical
        ? { id: 'manutencao', label: 'Manutenção', emoji: '🛠️', kind: 'neutral' }
        : { id: 'produto', label: 'Produto', emoji: '📦', kind: 'neutral' },
    );
  return topics;
}

export const normalize = (text) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-PT');
