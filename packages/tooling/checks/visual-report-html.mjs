// Builds the self-contained interactive HTML report: images are embedded, the
// highlight, slider, and pixel diff run in the browser.

const escape = (value) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const dataUri = (buffer) =>
  `data:image/png;base64,${buffer.toString('base64')}`;

const labels = {
  added: 'New: no previous snapshot',
  changed: 'Changed',
  removed: 'Removed: no new snapshot',
};

// Snapshot paths look like `<project>/<name>.png` (desktop or mobile).
const splitName = (file) => {
  const name = file.replace(/\.png$/, '');
  const at = name.lastIndexOf('/');
  return [name.slice(at + 1), name.slice(0, at)];
};

// Project names decide the device label: anything with "mobile" or "tablet" is flagged.
const deviceOf = (project) => {
  const lower = project.toLowerCase();
  if (lower.includes('mobile')) return { id: 'mobile', label: 'Mobile' };
  if (lower.includes('tablet')) return { id: 'tablet', label: 'Tablet' };
  return { id: 'desktop', label: 'Desktop' };
};

const icons = {
  mobile:
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.5 18.5h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  tablet:
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="4" y="2.5" width="16" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.5 18.5h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  desktop:
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="2.5" y="4" width="19" height="12.5" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 20.5h7M12 16.5v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

const styles = `
:root {
  color-scheme: light;
  --bg: #f4f5f9; --fg: #181825; --muted: #5d5f73; --border: #dcdde8;
  --surface: #ffffff; --surface-2: #f0f1f7;
  --accent: #6d28d9; --accent-fg: #ffffff; --accent-soft: #ede9fe;
  --added: #15803d; --added-bg: #dcfce7;
  --changed: #a16207; --changed-bg: #fef3c7;
  --removed: #b91c1c; --removed-bg: #fee2e2;
  --desktop: #1d4ed8; --desktop-bg: #dbeafe;
  --tablet: #0f766e; --tablet-bg: #ccfbf1;
  --mobile: #be185d; --mobile-bg: #fce7f3;
  --shadow: 0 1px 2px rgb(20 20 40 / .06), 0 4px 16px rgb(20 20 40 / .05);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #101018; --fg: #ececf4; --muted: #a3a4b8; --border: #30303f;
    --surface: #1a1a25; --surface-2: #232331;
    --accent: #a78bfa; --accent-fg: #14141c; --accent-soft: #2c2447;
    --added: #4ade80; --added-bg: #14391f;
    --changed: #fbbf24; --changed-bg: #3d2a08;
    --removed: #f87171; --removed-bg: #471414;
    --desktop: #93c5fd; --desktop-bg: #1c2a4d;
    --tablet: #5eead4; --tablet-bg: #0f3a36;
    --mobile: #f9a8d4; --mobile-bg: #4a1a35;
    --shadow: 0 1px 2px rgb(0 0 0 / .4);
  }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 0 0 4rem; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
.page { max-width: 1180px; margin: 0 auto; padding: 0 max(16px, env(safe-area-inset-left, 0px)); }
header.top { background: var(--surface); border-bottom: 1px solid var(--border); padding: 1.5rem 0 1.25rem; margin-bottom: 1.25rem; }
h1 { margin: 0; font-size: 1.5rem; letter-spacing: -.01em; text-wrap: balance; }
.sub { color: var(--muted); margin: .25rem 0 1rem; }
code { font-family: ui-monospace, "Cascadia Code", monospace; background: var(--surface-2); padding: .1rem .4rem; border-radius: 4px; font-size: .9em; }
.totals { display: flex; gap: .75rem; flex-wrap: wrap; }
.total { min-width: 7.5rem; padding: .6rem 1rem; border-radius: 10px; border: 1px solid var(--border); }
.total strong { display: block; font-size: 1.6rem; line-height: 1.1; }
.total span { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.total.changed { background: var(--changed-bg); color: var(--changed); border-color: transparent; }
.total.added { background: var(--added-bg); color: var(--added); border-color: transparent; }
.total.removed { background: var(--removed-bg); color: var(--removed); border-color: transparent; }
.controls { display: flex; flex-wrap: wrap; gap: .75rem 1.5rem; align-items: center; margin-bottom: 1rem; }
.group { display: flex; gap: .35rem; flex-wrap: wrap; align-items: center; }
.group > .label { color: var(--muted); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-right: .25rem; }
.bulk { margin-left: auto; }
button { font: inherit; padding: .3rem .8rem; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--fg); cursor: pointer; }
button:hover { border-color: var(--accent); }
button:focus-visible, .handle:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.segmented { display: inline-flex; padding: 3px; gap: 2px; background: var(--surface-2); border-radius: 10px; }
.segmented button { border: 0; background: transparent; border-radius: 7px; }
.segmented button[aria-pressed="true"] { background: var(--surface); color: var(--accent); box-shadow: var(--shadow); font-weight: 600; }
.card { background: var(--surface); border: 1px solid var(--border); border-left-width: 4px; border-radius: 12px; margin-bottom: .85rem; box-shadow: var(--shadow); overflow: clip; }
.card[data-device="mobile"] { border-left-color: var(--mobile); }
.card[data-device="tablet"] { border-left-color: var(--tablet); }
.card[data-device="desktop"] { border-left-color: var(--desktop); }
.card summary { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; padding: .8rem 1rem; cursor: pointer; list-style: none; }
.card summary::-webkit-details-marker { display: none; }
.card summary::before { content: ""; width: .5rem; height: .5rem; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(-45deg); transition: transform .15s; flex: none; }
.card[open] summary::before { transform: rotate(45deg); }
.card h2 { margin: 0; font-size: 1rem; font-family: ui-monospace, "Cascadia Code", monospace; overflow-wrap: anywhere; min-width: 0; }
.chip { display: inline-flex; align-items: center; gap: .35rem; padding: .1rem .6rem .1rem .5rem; border-radius: 999px; font-size: 12px; font-weight: 700; }
.chip.mobile { background: var(--mobile-bg); color: var(--mobile); }
.chip.tablet { background: var(--tablet-bg); color: var(--tablet); }
.chip.desktop { background: var(--desktop-bg); color: var(--desktop); }
.badge { padding: .1rem .6rem; border-radius: 999px; font-size: 12px; font-weight: 600; }
.badge.added { background: var(--added-bg); color: var(--added); }
.badge.changed { background: var(--changed-bg); color: var(--changed); }
.badge.failure { background: var(--removed-bg); color: var(--removed); border: 1px solid var(--removed); }
.badge.removed { background: var(--removed-bg); color: var(--removed); }
.stats { color: var(--muted); font-size: 12px; margin-left: auto; }
.body { padding: .25rem 1rem 1.25rem; border-top: 1px solid var(--border); background: var(--surface-2); }
.toolbar { display: flex; flex-wrap: wrap; gap: .5rem 1rem; align-items: center; justify-content: space-between; padding: .75rem 0; }
.legend { color: var(--muted); font-size: 12px; }
.stage { display: grid; justify-items: center; }
.frame { width: 100%; max-width: var(--frame-max, 100%); background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: clip; box-shadow: var(--shadow); }
.frame-bar { display: flex; align-items: center; gap: .4rem; padding: .35rem .75rem; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--border); background: var(--surface-2); }
.frame-bar i { width: .55rem; height: .55rem; border-radius: 50%; background: var(--border); }
.frame-bar .size { margin-left: auto; font-weight: 500; text-transform: none; letter-spacing: 0; }
[data-device="mobile"] .frame { --frame-max: 340px; border-radius: 28px; border: 6px solid var(--mobile); }
[data-device="mobile"] .frame-bar { justify-content: center; color: var(--mobile); background: var(--mobile-bg); }
[data-device="mobile"] .frame-bar i { display: none; }
[data-device="mobile"] .frame-bar .size { margin-left: .5rem; }
[data-device="tablet"] .frame { --frame-max: 560px; border-radius: 20px; border: 6px solid var(--tablet); }
[data-device="tablet"] .frame-bar { justify-content: center; color: var(--tablet); background: var(--tablet-bg); }
[data-device="tablet"] .frame-bar i { display: none; }
.side { display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center; width: 100%; }
.side figure { margin: 0; min-width: 0; flex: 1 1 min(100%, var(--frame-max, 420px)); max-width: var(--frame-max, 100%); }
.side figcaption { font-weight: 600; margin-bottom: .35rem; }
.side figure.previous figcaption { color: var(--removed); }
.side figure.next figcaption { color: var(--added); }
.side .frame { max-width: 100%; }
[data-device="mobile"] .side { --frame-max: 340px; }
[data-device="tablet"] .side { --frame-max: 560px; }
img { max-width: 100%; display: block; background: #fff; }
.missing { display: grid; place-items: center; min-height: 8rem; border: 2px dashed var(--border); border-radius: 10px; color: var(--muted); }
.compare { position: relative; line-height: 0; user-select: none; -webkit-user-select: none; touch-action: pan-y; }
.compare img { width: 100%; height: auto; }
.compare .after { position: absolute; inset: 0; clip-path: inset(0 0 0 var(--split, 50%)); }
.compare.slide { cursor: ew-resize; }
.compare .tag { position: absolute; top: .5rem; padding: .1rem .5rem; border-radius: 6px; font: 700 11px/1.5 system-ui, sans-serif; background: rgb(20 20 40 / .75); color: #fff; pointer-events: none; }
.compare .tag.l { left: .5rem; }
.compare .tag.r { right: .5rem; }
.handle { position: absolute; top: 0; bottom: 0; left: var(--split, 50%); width: 44px; margin-left: -22px; cursor: ew-resize; touch-action: none; }
.handle::before { content: ""; position: absolute; top: 0; bottom: 0; left: 50%; width: 3px; margin-left: -1.5px; background: var(--accent); box-shadow: 0 0 0 1px rgb(255 255 255 / .6); }
.handle::after { content: "\\2194"; position: absolute; top: 50%; left: 50%; width: 34px; height: 34px; margin: -17px; border-radius: 50%; background: var(--accent); color: var(--accent-fg); display: grid; place-items: center; font: 700 16px/1 system-ui, sans-serif; border: 2px solid var(--accent-fg); box-shadow: 0 2px 8px rgb(0 0 0 / .35); }
.hl img { filter: grayscale(1) opacity(.5); }
.hl canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
[hidden] { display: none !important; }
@media (max-width: 640px) { .bulk { margin-left: 0; } .stats { margin-left: 0; } }
`;

const script = `
var THRESHOLD = 16;

function press(group, active) {
  group.querySelectorAll('button').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b === active));
  });
}

var filters = { status: 'all', device: 'all' };

function applyFilters() {
  document.querySelectorAll('.card').forEach(function (card) {
    card.hidden = (filters.status !== 'all' && card.dataset.status !== filters.status) ||
      (filters.device !== 'all' && card.dataset.device !== filters.device);
  });
}

document.querySelector('.bulk').addEventListener('click', function (event) {
  var button = event.target.closest('button');
  if (!button) return;
  document.querySelectorAll('.card:not([hidden])').forEach(function (card) {
    card.open = button.dataset.action === 'expand';
  });
});

document.querySelectorAll('[data-filter-group]').forEach(function (group) {
  group.addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button) return;
    press(group, button);
    filters[group.dataset.filterGroup] = button.dataset.value;
    applyFilters();
  });
});

function load(src) {
  return new Promise(function (resolve) {
    var image = new Image();
    image.onload = function () { resolve(image); };
    image.src = src;
  });
}

function readPixels(image, width, height) {
  var canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  var context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, width, height);
}

function computeDiff(card) {
  if (card.diff) return card.diff;
  var sources = card.querySelectorAll('[data-view="side"] img');
  card.diff = Promise.all([load(sources[0].src), load(sources[1].src)]).then(function (images) {
    var width = Math.max(images[0].naturalWidth, images[1].naturalWidth);
    var height = Math.max(images[0].naturalHeight, images[1].naturalHeight);
    var before = readPixels(images[0], width, height);
    var after = readPixels(images[1], width, height);
    var overlay = new ImageData(width, height);
    var count = 0;
    for (var i = 0; i < before.data.length; i += 4) {
      var delta = Math.max(
        Math.abs(before.data[i] - after.data[i]),
        Math.abs(before.data[i + 1] - after.data[i + 1]),
        Math.abs(before.data[i + 2] - after.data[i + 2]),
        Math.abs(before.data[i + 3] - after.data[i + 3])
      );
      if (delta > THRESHOLD) {
        overlay.data[i] = 255;
        overlay.data[i + 1] = 0;
        overlay.data[i + 2] = 80;
        overlay.data[i + 3] = 235;
        count += 1;
      }
    }
    var canvas = card.querySelector('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').putImageData(overlay, 0, 0);
    var percent = (count / (width * height)) * 100;
    card.querySelector('.stats').textContent = count === 0
      ? 'No visible pixel differences'
      : count.toLocaleString() + ' px differ (' + percent.toFixed(2) + '%)';
    return count;
  });
  return card.diff;
}

function setMode(card, mode) {
  card.querySelectorAll('[data-view]').forEach(function (view) {
    view.hidden = view.dataset.view !== mode;
  });
}

document.querySelectorAll('.modes').forEach(function (modes) {
  modes.addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button) return;
    press(modes, button);
    setMode(modes.closest('.card'), button.dataset.mode);
  });
});

// The slider is dragged directly on the image; the handle is also keyboard operable.
document.querySelectorAll('.compare.slide').forEach(function (compare) {
  var handle = compare.querySelector('.handle');
  function set(percent) {
    var value = Math.min(100, Math.max(0, percent));
    compare.style.setProperty('--split', value + '%');
    handle.setAttribute('aria-valuenow', String(Math.round(value)));
  }
  function fromPointer(event) {
    var rect = compare.getBoundingClientRect();
    set(((event.clientX - rect.left) / rect.width) * 100);
  }
  compare.addEventListener('pointerdown', function (event) {
    compare.setPointerCapture(event.pointerId);
    compare.dragging = true;
    fromPointer(event);
  });
  compare.addEventListener('pointermove', function (event) {
    if (compare.dragging) fromPointer(event);
  });
  function stop() { compare.dragging = false; }
  compare.addEventListener('pointerup', stop);
  compare.addEventListener('pointercancel', stop);
  handle.addEventListener('keydown', function (event) {
    var current = Number(handle.getAttribute('aria-valuenow'));
    var step = event.shiftKey ? 10 : 2;
    if (event.key === 'ArrowLeft') set(current - step);
    else if (event.key === 'ArrowRight') set(current + step);
    else if (event.key === 'Home') set(0);
    else if (event.key === 'End') set(100);
    else return;
    event.preventDefault();
  });
});

var observer = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (!entry.isIntersecting) return;
    observer.unobserve(entry.target);
    computeDiff(entry.target);
  });
}, { rootMargin: '300px' });

document.querySelectorAll('.card[data-status="changed"]').forEach(function (card) {
  observer.observe(card);
});
`;

const imageTag = (src, alt) => `<img src="${src}" alt="${alt}">`;

const missing = (text) => `<div class="missing">${text}</div>`;

const modeButton = (mode, label, pressed) =>
  `<button type="button" data-mode="${mode}" aria-pressed="${pressed}">${label}</button>`;

const sizeOf = (buffer) =>
  buffer ? `${buffer.readUInt32BE(16)} × ${buffer.readUInt32BE(20)}` : '';

const frame = (device, inner, buffer) => `<div class="frame">
    <div class="frame-bar"><i></i><i></i><i></i>${device.label}<span class="size">${sizeOf(buffer)}</span></div>
    ${inner}
  </div>`;

const summaryRow = (
  story,
  device,
  status,
  extra = '',
  failure = false
) => `<summary>
    <span class="chip ${device.id}">${icons[device.id]}${device.label}</span>
    <h2>${escape(story)}</h2>
    <span class="badge ${status}">${labels[status]}</span>
    ${failure ? '<span class="badge failure" title="The snapshot test fails: expected is the committed baseline, actual is what the test rendered">Failing test</span>' : ''}
    ${extra}
  </summary>`;

const changedCard = ({ file, before, after, failure }) => {
  const [previousLabel, nextLabel] = failure
    ? ['Expected (baseline)', 'Actual (test)']
    : ['Previous', 'New'];
  const [story, project] = splitName(file);
  const device = deviceOf(project);
  const beforeSrc = dataUri(before);
  const afterSrc = dataUri(after);

  return `<details class="card" data-status="changed" data-device="${device.id}" open>
  ${summaryRow(story, device, 'changed', '<span class="stats" aria-live="polite">Comparing…</span>', failure)}
  <div class="body">
    <div class="toolbar">
      <div class="segmented modes" role="group" aria-label="Comparison mode">
        ${modeButton('highlight', 'Highlight differences', true)}
        ${modeButton('slider', 'Slider', false)}
        ${modeButton('side', 'Side by side', false)}
      </div>
      <span class="legend">Project: <code>${escape(project)}</code></span>
    </div>
    <div class="stage">
      <div data-view="highlight" style="width:100%;display:grid;justify-items:center">
        ${frame(
          device,
          `<div class="compare hl">${imageTag(afterSrc, 'New snapshot with differences highlighted')}<canvas aria-hidden="true"></canvas></div>`,
          after
        )}
        <div class="legend" style="margin-top:.5rem">${nextLabel}, dimmed. Differing pixels are marked in red.</div>
      </div>
      <div data-view="slider" hidden style="width:100%;display:grid;justify-items:center">
        ${frame(
          device,
          `<div class="compare slide">
          ${imageTag(beforeSrc, 'Previous snapshot')}
          <img class="after" src="${afterSrc}" alt="New snapshot">
          <span class="tag l">${previousLabel}</span><span class="tag r">${nextLabel}</span>
          <div class="handle" role="slider" tabindex="0" aria-label="Reveal the new snapshot from the right" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"></div>
        </div>`,
          after
        )}
        <div class="legend" style="margin-top:.5rem">Drag on the image (or use the arrow keys on the handle). Left: ${previousLabel.toLowerCase()}. Right: ${nextLabel.toLowerCase()}.</div>
      </div>
      <div data-view="side" class="side" hidden>
        <figure class="previous"><figcaption>${previousLabel}</figcaption>${frame(device, imageTag(beforeSrc, 'Previous snapshot'), before)}</figure>
        <figure class="next"><figcaption>${nextLabel}</figcaption>${frame(device, imageTag(afterSrc, 'New snapshot'), after)}</figure>
      </div>
    </div>
  </div>
</details>`;
};

const singleCard = ({ file, status, before, after }) => {
  const [story, project] = splitName(file);
  const device = deviceOf(project);
  const previous =
    status === 'added'
      ? missing('No previous snapshot')
      : frame(device, imageTag(dataUri(before), 'Previous snapshot'), before);
  const next =
    status === 'removed'
      ? missing('No new snapshot')
      : frame(device, imageTag(dataUri(after), 'New snapshot'), after);

  return `<details class="card" data-status="${status}" data-device="${device.id}">
  ${summaryRow(story, device, status)}
  <div class="body">
    <div class="toolbar"><span class="legend">Project: <code>${escape(project)}</code></span></div>
    <div class="stage"><div class="side">
      <figure class="previous"><figcaption>Previous</figcaption>${previous}</figure>
      <figure class="next"><figcaption>New</figcaption>${next}</figure>
    </div></div>
  </div>
</details>`;
};

export const buildHtml = ({ entries, counts, baseRef }) => {
  const total = entries.length;
  const devices = [
    ...new Set(entries.map(({ file }) => deviceOf(splitName(file)[1]).id)),
  ];
  const deviceCount = (id) =>
    entries.filter(({ file }) => deviceOf(splitName(file)[1]).id === id).length;
  const filter = (value, label, pressed) =>
    `<button type="button" data-value="${value}" aria-pressed="${pressed}">${label}</button>`;
  const deviceNames = {
    desktop: 'Desktop',
    tablet: 'Tablet',
    mobile: 'Mobile',
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual snapshot report</title>
<style>${styles}</style>
</head>
<body>
<header class="top"><div class="page">
  <h1>Visual snapshot report</h1>
  <p class="sub">${total} snapshot${total === 1 ? '' : 's'} differ from <code>${escape(baseRef)}</code>.</p>
  <div class="totals">
    <div class="total changed"><strong>${counts.changed}</strong><span>Changed</span></div>
    <div class="total added"><strong>${counts.added}</strong><span>New</span></div>
    <div class="total removed"><strong>${counts.removed}</strong><span>Removed</span></div>
  </div>
</div></header>
<main class="page">
<div class="controls">
  <div class="group" data-filter-group="status" role="group" aria-label="Filter by status">
    <span class="label">Status</span>
    ${filter('all', `All (${total})`, true)}
    ${filter('changed', `Changed (${counts.changed})`, false)}
    ${filter('added', `New (${counts.added})`, false)}
    ${filter('removed', `Removed (${counts.removed})`, false)}
  </div>
  <div class="group" data-filter-group="device" role="group" aria-label="Filter by device">
    <span class="label">Device</span>
    ${filter('all', 'All', true)}
    ${devices.map((id) => filter(id, `${deviceNames[id]} (${deviceCount(id)})`, false)).join('\n    ')}
  </div>
  <div class="group bulk" role="group" aria-label="Expand or collapse">
    <button type="button" data-action="expand">Expand all</button>
    <button type="button" data-action="collapse">Collapse all</button>
  </div>
</div>
${entries.map((entry) => (entry.status === 'changed' ? changedCard(entry) : singleCard(entry))).join('\n')}
</main>
<script>${script}</script>
</body>
</html>
`;
};
