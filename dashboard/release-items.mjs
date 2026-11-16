import { createHash } from 'node:crypto';

export function itemId(text, kind = 'product') {
  return `${kind}-${createHash('sha256').update(text.normalize('NFC').trim()).digest('hex').slice(0, 20)}`;
}

export function changelogSections(text = '') {
  const sections = {};
  for (const section of text.split(/^##\s+/m).slice(1)) {
    const version = section.match(/^\[?v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)/)?.[1];
    if (version) sections[version] = section.slice(section.indexOf('\n') + 1).trim();
  }
  return sections;
}

export function technicalNotes(text = '') {
  let technicalSection = false;
  const notes = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^#{2,3}\s/.test(line))
      technicalSection = /dependencies|technical|internal|dependências|técnic/i.test(line);
    if (!/^\s*[-*]\s+/.test(line)) continue;
    const value = line.replace(/^\s*[-*]\s+/, '');
    if (
      !technicalSection &&
      !/^(?:chore|ci|test|refactor|docs|build|deps|jest|expo|release(?: scripts| workflow)?|security docs|npm run check|visual tests|fix\((?:ci|release|db|security)\)|perf\(data\))/i.test(
        value,
      ) &&
      !/^Bump\s/i.test(value)
    )
      continue;
    const clean = value
      .replace(/\s+by @.*$/, '')
      .replace(/\s*\(\[#[\s\S]*$/, '')
      .replace(/\s*https:\/\/github\.com\/\S+/g, '')
      .trim();
    if (clean && !/^Release v?\d/i.test(clean)) notes.push(clean);
  }
  return [...new Set(notes)];
}

export function discussionManifest(snapshot) {
  return Object.fromEntries(
    snapshot.apps.map((app) => [
      app.repository,
      Object.fromEntries(
        app.releases.map((release) => [
          release.version,
          [
            'release',
            ...(release.items ?? []).map((item) => item.id),
            ...(release.technicalItems ?? []).map((item) => item.id),
          ],
        ]),
      ),
    ]),
  );
}
