import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { inside, loadConfig } from './config.mjs';

const kebab = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();

export function generateFiles(root, kind, { name, path, designSystem = false } = {}, config = {}) {
  if (!['component', 'hook'].includes(kind)) throw new Error('Generator must be component or hook');
  if (
    !name ||
    (kind === 'component'
      ? !/^[A-Z][A-Za-z0-9]*$/.test(name)
      : !/^use[A-Z][A-Za-z0-9]*$/.test(name))
  )
    throw new Error(
      kind === 'component'
        ? 'Use a PascalCase component name'
        : 'Hook names must start with use followed by PascalCase',
    );
  const settings = config.generators ?? {};
  const directory =
    path ??
    (kind === 'component'
      ? (settings.components ?? 'src/components')
      : (settings.hooks ?? 'src/hooks'));
  inside(root, directory);
  const files = new Map();
  if (kind === 'component') {
    const block =
        config.styles?.preset === 'rookie' || config.styles?.rules?.componentName
          ? name.replace(/(?<!^)(?=[A-Z])/g, '-').toLowerCase()
          : kebab(name),
      base = `${directory}/${name}`;
    let source;
    if (designSystem) {
      const ds = settings.designSystem;
      if (!ds?.package || !ds.component)
        throw new Error(
          'Configure generators.designSystem.package and component before using --design-system',
        );
      if (
        !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(ds.package) ||
        !/^[A-Z][A-Za-z0-9]*$/.test(ds.component)
      )
        throw new Error('Invalid design-system import');
      source = `import type { ComponentProps } from 'react';\nimport { ${ds.component} as Primitive } from '${ds.package}';\nimport styles from './${name}.module.scss';\n\nexport type ${name}Props = ComponentProps<typeof Primitive>;\n\nexport function ${name}({ className, ...props }: ${name}Props) {\n  return <Primitive className={[styles['${block}'], className].filter(Boolean).join(' ')} {...props} />;\n}\n`;
    } else {
      source = `import type { HTMLAttributes } from 'react';\nimport styles from './${name}.module.scss';\n\nexport type ${name}Props = HTMLAttributes<HTMLDivElement>;\n\nexport function ${name}({ className, ...props }: ${name}Props) {\n  return <div className={[styles['${block}'], className].filter(Boolean).join(' ')} {...props} />;\n}\n`;
    }
    files.set(`${base}/${name}.tsx`, source);
    files.set(`${base}/${name}.module.scss`, `.${block} {\n  display: block;\n}\n`);
    files.set(
      `${base}/${name}.test.tsx`,
      `// @vitest-environment jsdom\nimport { cleanup, render, screen } from '@testing-library/react';\nimport { afterEach, describe, expect, it } from 'vitest';\nimport { ${name} } from './${name}';\n\nafterEach(cleanup);\n\ndescribe('${name}', () => {\n  it('renders its content and forwards DOM attributes', () => {\n    render(<${name} data-testid="subject" className="custom">Content</${name}>);\n    const element = screen.getByTestId('subject');\n    expect(element.textContent).toBe('Content');\n    expect(element.classList.contains('custom')).toBe(true);\n  });\n});\n`,
    );
    files.set(
      `${base}/index.ts`,
      `export { ${name} } from './${name}';\nexport type { ${name}Props } from './${name}';\n`,
    );
  } else {
    files.set(
      `${directory}/${name}.ts`,
      `import { useState } from 'react';\n\n// Replace this initial state scaffold with the hook's domain behaviour.\nexport function ${name}<T>(initialValue: T) {\n  return useState(initialValue);\n}\n`,
    );
    files.set(
      `${directory}/${name}.test.ts`,
      `// @vitest-environment jsdom\nimport { act, cleanup, renderHook } from '@testing-library/react';\nimport { afterEach, describe, expect, it } from 'vitest';\nimport { ${name} } from './${name}';\n\nafterEach(cleanup);\n\ndescribe('${name}', () => {\n  it('initializes state and accepts updates', () => {\n    const { result } = renderHook(() => ${name}('initial'));\n    expect(result.current[0]).toBe('initial');\n    act(() => result.current[1]('updated'));\n    expect(result.current[0]).toBe('updated');\n  });\n});\n`,
    );
  }
  return files;
}

export function writeGenerated(root, files, { dryRun = false } = {}) {
  const canonicalRoot = realpathSync(root);
  for (const path of files.keys()) {
    const target = inside(root, path);
    if (existsSync(target)) throw new Error(`Refusing to overwrite ${path}`);
    let parent = dirname(target);
    while (!existsSync(parent)) parent = dirname(parent);
    const rel = relative(canonicalRoot, realpathSync(parent));
    if (
      isAbsolute(rel) ||
      rel === '..' ||
      rel.startsWith(`..${sep}`) ||
      resolve(canonicalRoot, rel) !== realpathSync(parent)
    )
      throw new Error(`Generator destination escapes repository: ${path}`);
  }
  if (dryRun) return;
  for (const [path, content] of files) {
    const target = inside(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { flag: 'wx' });
  }
}

export function generateCommand(root, kind, options) {
  let config;
  try {
    config = loadConfig(root, options.config).config;
  } catch (error) {
    if (options.config || error.code !== 'ENOENT') throw error;
    config = {};
  }
  const files = generateFiles(
    root,
    kind,
    { name: options.name, path: options.path, designSystem: options['design-system'] },
    config,
  );
  writeGenerated(root, files, { dryRun: options['dry-run'] });
  console.log(
    options['dry-run']
      ? JSON.stringify({ files: [...files].map(([path, content]) => ({ path, content })) }, null, 2)
      : `Generated ${[...files.keys()].join(', ')}`,
  );
  return 0;
}
