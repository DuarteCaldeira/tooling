import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { git } from '../runner/git.mjs';
import { matches } from '../runner/graph.mjs';

export const rootDirectory = () => process.env.TOOLING_ROOT ?? process.cwd();
export function peer(name, cwd = process.cwd()) {
  try {
    return createRequire(join(cwd, 'package.json'))(name);
  } catch (error) {
    throw new Error(`Install ${name} in this project to enable this check`, { cause: error });
  }
}
export function sourceFiles(root, patterns, exclude = []) {
  return [
    ...new Set(
      git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0'),
    ),
  ].filter(
      (file) =>
        file &&
        existsSync(join(root, file)) &&
        patterns.some((pattern) => matches(file, pattern)) &&
        !exclude.some((pattern) => matches(file, pattern)),
    );
}
export function writeDetails(value) {
  const directory = process.env.TOOLING_REPORT_DIR;
  const id = process.env.TOOLING_CHECK_ID;
  if (!directory || !id) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${id}.details.json`), JSON.stringify(value, null, 2) + '\n');
}
export function compilerOptions(ts, root, configPath = 'tsconfig.json') {
  const path = join(root, configPath);
  if (!existsSync(path))
    return {
      allowJs: true,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
    };
  const read = ts.readConfigFile(path, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(path), undefined, path);
  const errors = parsed.errors.filter((error) => ![18002, 18003].includes(error.code));
  if (errors.length)
    throw new Error(
      errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'),
    );
  return parsed.options;
}
export function importsIn(ts, file) {
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  if (ast.parseDiagnostics.length)
    throw new Error(
      `${file}: ${ts.flattenDiagnosticMessageText(ast.parseDiagnostics[0].messageText, '\n')}`,
    );
  const imports = [];
  function visit(node) {
    let value;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) value = node.moduleSpecifier;
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      value = node.moduleReference.expression;
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length === 1
    )
      value = node.arguments[0];
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      value = node.argument.literal;
    if (value && ts.isStringLiteralLike(value))
      imports.push({
        specifier: value.text,
        line: ast.getLineAndCharacterOfPosition(value.getStart(ast)).line + 1,
      });
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return imports;
}
