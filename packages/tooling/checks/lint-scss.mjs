#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { loadConfig, inside } from '../runner/config.mjs';
import { matches } from '../runner/graph.mjs';
import scss from 'postcss-scss';

const repo = process.env.TOOLING_ROOT ?? process.cwd();
const { config } = loadConfig(repo);
const options = config.styles ?? {};
const ORDER = JSON.parse(
  readFileSync(new URL('./style-property-order.json', import.meta.url), 'utf8'),
);
const RANK = new Map(ORDER.map((name, index) => [name, index]));

const BEM =
  /^[a-z][a-z0-9]*(-[a-z0-9]+)*(__[a-z][a-z0-9]*(-[a-z0-9]+)*)?(--[a-z][a-z0-9]*(-[a-z0-9]+)*)?$/;
const rookie = options.preset === 'rookie';
const rules = { bem: rookie, componentName: rookie, palette: rookie, ...options.rules };
const COLOUR_FREE = /[/\\](_palette|themes)[/\\]/;
const MAX_DEPTH = options.maxDepth ?? 3;
const CONTROL = new Set(['for', 'each', 'while', 'if', 'else']);
const MAX_SPECIFICITY = options.maxSpecificity ?? [0, 4, 2];
const LENGTH_UNITS = 'px|em|rem|ex|ch|vw|vh|vmin|vmax|cm|mm|in|pt|pc|q';
const NAMED_COLOURS = new Set(
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(
    ' ',
  ),
);
const COLOUR_PROPS =
  /^(color|background(-color|-image)?|border(-[a-z]+)*-color|border(-top|-right|-bottom|-left)?|outline(-color)?|fill|stroke|box-shadow|text-shadow|caret-color|accent-color|text-decoration(-color)?|column-rule(-color)?)$/;

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return entry.isFile() && path.endsWith('.scss') ? [path] : [];
  });

const stripValue = (value) =>
  value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(['"])(?:\\.|(?!\1).)*\1/g, '""')
    .replace(/#\{[^}]*\}/g, 'x');

const unprefixed = (prop) => prop.replace(/^-(webkit|moz|ms|o)-/, '');

const specificity = (selector) => {
  const s = [0, 0, 0];
  const clean = selector.replace(/\[[^\]]*\]/g, () => {
    s[1] += 1;
    return '';
  });
  for (const match of clean.matchAll(
    /(#[\w-]+)|(\.[\w-]+)|(::?[\w-]+)(\([^)]*\))?|([a-zA-Z][\w-]*)/g,
  )) {
    if (match[1]) s[0] += 1;
    else if (match[2]) s[1] += 1;
    else if (match[3]) {
      const name = match[3].replace(/^:+/, '');
      if (
        match[3].startsWith('::') ||
        ['before', 'after', 'first-line', 'first-letter'].includes(name)
      )
        s[2] += 1;
      else if (name === 'where' || name === 'global') continue;
      else if (['is', 'not', 'has'].includes(name)) {
        const inner = (match[4] ?? '').slice(1, -1).split(',').map(specificity);
        const top = inner.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0] ?? [0, 0, 0];
        s[0] += top[0];
        s[1] += top[1];
        s[2] += top[2];
      } else s[1] += 1;
    } else if (match[5]) s[2] += 1;
  }
  return s;
};
const tooSpecific = (s) =>
  s[0] > MAX_SPECIFICITY[0] ||
  (s[0] === MAX_SPECIFICITY[0] &&
    (s[1] > MAX_SPECIFICITY[1] || (s[1] === MAX_SPECIFICITY[1] && s[2] > MAX_SPECIFICITY[2])));

const splitList = (selector) => {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const c = selector[i];
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(selector.slice(start).trim());
  return out.filter(Boolean);
};

const resolve = (selector, parents) =>
  parents.length === 0
    ? splitList(selector)
    : splitList(selector).flatMap((child) =>
        parents.map((parent) =>
          child.includes('&') ? child.replaceAll('&', parent) : `${parent} ${child}`,
        ),
      );

/* An at-rule straight under the root (a mixin, a media query) and Sass control flow are not levels. */
const nestingDepth = (node, level = 0) => {
  const parent = node.parent;
  if (!parent || parent.type === 'root') return level;
  if (parent.type === 'atrule' && parent.parent?.type === 'root') return level;
  if (parent.type === 'atrule' && CONTROL.has(parent.name)) return nestingDepth(parent, level);
  return nestingDepth(parent, level + 1);
};

const line = (node) => node.source?.start?.line ?? 0;
const endLine = (node) => node.source?.end?.line ?? line(node);
const blankBefore = (node) => /\n[ \t\r]*\n/.test(node.raws.before ?? '');

const lintFile = (file, fix) => {
  const source = readFileSync(file, 'utf8');
  const problems = [];
  const root = scss.parse(source, { from: file });
  const colourFree =
    !rules.palette ||
    COLOUR_FREE.test(file) ||
    (options.colourTokenPaths ?? []).some((pattern) => matches(relative(repo, file), pattern));
  const moduleBlock =
    rules.componentName && /\.module\.scss$/.test(file)
      ? basename(file, '.module.scss')
          .replace(/(?<!^)(?=[A-Z])/g, '-')
          .toLowerCase()
      : null;
  const disabled = new Map();
  root.walkComments((c) => {
    const m = /lint-scss-disable-next-line\s+([\w-]+)/.exec(c.text);
    if (m) disabled.set(`${endLine(c) + 1}:${m[1]}`, true);
  });
  const report = (node, rule, message) => {
    if (disabled.has(`${line(node)}:${rule}`)) return;
    problems.push({ line: line(node), rule, message });
  };

  const visit = (parent, selectors, depth) => {
    const kids = parent.nodes ?? [];
    kids.forEach((node, index) => {
      const prev = kids[index - 1];
      const first = index === 0;
      const nested = parent.type !== 'root';

      if (node.type === 'comment') {
        const sameLine = prev && endLine(prev) === line(node);
        const afterComment = prev?.type === 'comment';
        if (
          !sameLine &&
          !afterComment &&
          !first &&
          !blankBefore(node) &&
          !/lint-scss|stylelint/.test(node.text)
        )
          report(node, 'comment-empty-line-before', 'Expected an empty line before the comment');
        if (!sameLine && first && nested && blankBefore(node))
          report(
            node,
            'comment-empty-line-before',
            'Unexpected empty line before the first comment',
          );
      }

      if (
        node.type === 'rule' &&
        parent.name !== 'keyframes' &&
        !/keyframes$/.test(parent.name ?? '')
      ) {
        const own = resolve(node.selector, selectors);
        const multi = endLine(node) > line(node);
        const afterComment = prev?.type === 'comment';
        if (first && nested && blankBefore(node))
          report(node, 'rule-empty-line-before', 'Unexpected empty line before the first rule');
        else if (!first && multi && !afterComment && !blankBefore(node))
          report(node, 'rule-empty-line-before', 'Expected an empty line before the rule');
        if (nestingDepth(node) > MAX_DEPTH)
          report(node, 'max-nesting-depth', `Nesting deeper than ${MAX_DEPTH} levels`);
        if (!node.nodes?.length) report(node, 'block-no-empty', 'Empty block');
        for (const sel of own) {
          if (!sel.includes('#{') && !sel.includes('%')) {
            const bare = sel.replace(/:global\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '');
            for (const m of bare.matchAll(/\.(-?[\w-]+)/g))
              if (rules.bem && !BEM.test(m[1]))
                report(
                  node,
                  'selector-class-pattern',
                  `Use BEM: .block, .block__element, .block--modifier, in kebab-case: .${m[1]}`,
                );
            for (const m of bare.matchAll(/\.([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:__|--|(?![\w-]))/g))
              if (moduleBlock && m[1] !== moduleBlock)
                report(
                  node,
                  'block-name-matches-component',
                  `The block is named after the component: .${moduleBlock}, not .${m[1]}`,
                );
          }
          if (!sel.includes('#{') && tooSpecific(specificity(sel)))
            report(
              node,
              'selector-max-specificity',
              `Specificity of "${sel}" is above ${MAX_SPECIFICITY.join(',')}`,
            );
        }
        visit(node, own, depth + 1);
        return;
      }

      if (node.type === 'atrule') {
        const blockless = !node.nodes;
        const afterComment = prev?.type === 'comment';
        const prevBlockless = prev?.type === 'atrule' && !prev.nodes;
        if (node.name !== 'else') {
          if (first && nested && blankBefore(node))
            report(node, 'at-rule-empty-line-before', `Unexpected empty line before @${node.name}`);
          else if (!first && !afterComment) {
            if (blockless && prevBlockless && blankBefore(node))
              report(
                node,
                'at-rule-empty-line-before',
                `Unexpected empty line before @${node.name}`,
              );
            else if (!(blockless && prevBlockless) && !blankBefore(node))
              report(
                node,
                'at-rule-empty-line-before',
                `Expected an empty line before @${node.name}`,
              );
          }
        }
        if (node.nodes) {
          if (nestingDepth(node) > MAX_DEPTH && node.name !== 'keyframes')
            report(node, 'max-nesting-depth', `Nesting deeper than ${MAX_DEPTH} levels`);
          if (!node.nodes.length) report(node, 'block-no-empty', 'Empty block');
          visit(node, selectors, node.name === 'keyframes' ? depth : depth + 1);
        }
        return;
      }

      if (node.type === 'decl') {
        const value = stripValue(node.value);
        if (!colourFree) {
          if (
            /#[0-9a-fA-F]{3,8}\b/.test(value) &&
            !node.prop.startsWith('$') &&
            !node.prop.startsWith('--')
          )
            report(node, 'color-no-hex', 'Raw hex colour: use a palette token');
          if (/\b(rgba?|hsla?)\(/i.test(value))
            report(node, 'function-disallowed-list', 'Use a palette token, not rgb()/hsl()');
          if (COLOUR_PROPS.test(node.prop)) {
            for (const word of value.match(/(?<![\w$#.-])[a-zA-Z][a-zA-Z0-9-]*(?![\w(-])/g) ?? [])
              if (NAMED_COLOURS.has(word.toLowerCase()))
                report(node, 'color-named', `Named colour "${word}": use a palette token`);
          }
        }
        if (!node.prop.startsWith('--') && !node.prop.startsWith('$')) {
          const zero = new RegExp(`(?<![\\w.#$-])0(${LENGTH_UNITS})\\b`, 'i');
          if (zero.test(value) && !/calc\(/.test(value))
            report(node, 'length-zero-no-unit', 'Unexpected unit on a zero length');
        }
      }
    });

    const decls = kids.filter((n) => n.type === 'decl');
    const seen = new Map();
    decls.forEach((d, i) => {
      if (d.prop.startsWith('$') || d.prop.startsWith('--')) return;
      const before = seen.get(d.prop);
      const consecutive = before !== undefined && decls[i - 1] === decls[before];
      if (before !== undefined && !(consecutive && decls[before].value !== d.value))
        report(d, 'declaration-block-no-duplicate-properties', `Duplicate property ${d.prop}`);
      seen.set(d.prop, i);
    });

    let run = [];
    const flush = () => {
      const known = run.filter((d) => RANK.has(unprefixed(d.prop)));
      const sorted = [...known].sort(
        (a, b) => RANK.get(unprefixed(a.prop)) - RANK.get(unprefixed(b.prop)),
      );
      known.forEach((d, i) => {
        if (
          d !== sorted[i] &&
          !known
            .slice(0, i)
            .every((p) => RANK.get(unprefixed(p.prop)) <= RANK.get(unprefixed(d.prop)))
        ) {
          const before = known
            .slice(0, i)
            .find((p) => RANK.get(unprefixed(p.prop)) > RANK.get(unprefixed(d.prop)));
          report(
            d,
            'order/properties-order',
            `Expected "${d.prop}" to come before "${before.prop}"`,
          );
        }
      });
      if (fix && known.some((d, i) => d !== sorted[i])) {
        const slots = known.map((d) => ({ before: d.raws.before }));
        const nodes = run.slice();
        const positions = known.map((d) => nodes.indexOf(d));
        const holders = positions.map((p) => nodes[p]);
        sorted.forEach((d, i) => {
          holders[i].replaceWith(d.clone({ raws: { ...d.raws, before: slots[i].before } }));
        });
      }
      run = [];
    };
    for (const node of kids) {
      if (node.type === 'decl') run.push(node);
      else if (node.type !== 'comment') flush();
    }
    flush();
  };
  visit(root, [], 0);

  if (fix) {
    const out = root.toString();
    if (out !== source) writeFileSync(file, out);
  }
  return problems;
};

const fix = process.argv.includes('--fix');
const given = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const targets = given.length ? given : files(inside(repo, options.source ?? 'src'));
let total = 0;
for (const file of targets) {
  const problems = fix ? (lintFile(file, true), lintFile(file, false)) : lintFile(file, false);
  for (const p of problems.sort((a, b) => a.line - b.line)) {
    console.error(
      `${relative(repo, file).replaceAll('\\', '/')}:${p.line}  ${p.message}  (${p.rule})`,
    );
    total += 1;
  }
}
if (total) {
  console.error(`\n${total} SCSS problem${total === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log(`SCSS lint passed (${targets.length} files).`);
