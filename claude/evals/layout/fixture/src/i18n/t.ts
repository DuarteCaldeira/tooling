import en from '../locales/en.json';

type Key = string;

/** Translate a key from the active locale (`src/locales/<locale>.json`). */
export function t(key: Key): string {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en) as string;
}
