import { posix } from "node:path";
import ts from "typescript";
import type { SourceFile } from "./contracts";

const root = "/rollbackiq";

export function resolvedDeclaration(identifier: ts.Identifier, checker: ts.TypeChecker) {
  let symbol = checker.getSymbolAtLocation(identifier);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.valueDeclaration;
}

export function isTypescriptConfig(path: string) {
  return (
    /(?:^|\/)(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json$/.test(path) &&
    !path
      .split("/")
      .some((part) =>
        ["node_modules", "dist", "build", ".next", "coverage", "vendor"].includes(part),
      )
  );
}

export function typescriptProgram(
  files: Map<string, ts.SourceFile>,
  configs: readonly SourceFile[],
  configurationGap: (path: string) => void,
) {
  const sources = new Map([...files.values()].map((file) => [file.fileName, file]));
  const contents = new Map([
    ...[...sources].map(([name, file]) => [name, file.text] as const),
    ...configs.map((file) => [`${root}/${file.path}`, file.text] as const),
  ]);
  const directories = new Set<string>();
  for (const name of contents.keys()) {
    let directory = posix.dirname(name);
    while (directory !== "/") {
      directories.add(directory);
      directory = posix.dirname(directory);
    }
  }
  const defaults: ts.CompilerOptions = {
    noLib: true,
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
  };
  const configurationPaths = configs
    .filter(({ path }) => ["tsconfig.json", "jsconfig.json"].includes(posix.basename(path)))
    .map(({ path }) => `${root}/${path}`)
    .sort((a, b) => posix.dirname(b).length - posix.dirname(a).length || a.localeCompare(b));
  const options = new Map<string, ts.CompilerOptions>();
  const readFile = (name: string) => contents.get(posix.normalize(name));
  const fileExists = (name: string) => contents.has(posix.normalize(name));
  const directoryExists = (name: string) => directories.has(posix.normalize(name));
  const getCurrentDirectory = () => root;

  function compilerOptions(containingFile: string) {
    const config = configurationPaths.find((path) =>
      containingFile.startsWith(`${posix.dirname(path)}/`),
    );
    if (!config) return defaults;
    const cached = options.get(config);
    if (cached) return cached;
    // Configuration and imports resolve only against supplied Git blobs.
    const parsed = ts.getParsedCommandLineOfConfigFile(
      config,
      {},
      {
        readFile,
        fileExists,
        directoryExists,
        getCurrentDirectory,
        useCaseSensitiveFileNames: true,
        readDirectory: (directory) =>
          [...sources.keys()].filter((name) => name.startsWith(`${directory}/`)),
        onUnRecoverableConfigFileDiagnostic: () => configurationGap(config.slice(root.length + 1)),
      },
    );
    if (parsed?.errors.length) configurationGap(config.slice(root.length + 1));
    const result = { ...defaults, ...parsed?.options, noLib: true, allowJs: true };
    options.set(config, result);
    return result;
  }

  const host: ts.CompilerHost = {
    getSourceFile: (name) => sources.get(posix.normalize(name)),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists,
    readFile,
    directoryExists,
    resolveModuleNames: (names, containingFile) =>
      names.map(
        (name) =>
          ts.resolveModuleName(name, containingFile, compilerOptions(containingFile), {
            fileExists,
            readFile,
            directoryExists,
            getCurrentDirectory,
          }).resolvedModule,
      ),
  };
  return ts.createProgram([...sources.keys()], defaults, host);
}

export function sourceFile(path: string, text: string) {
  return ts.createSourceFile(`${root}/${path}`, text, ts.ScriptTarget.Latest, true);
}
