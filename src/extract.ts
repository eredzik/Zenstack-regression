import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import type {
  ExtractManifest,
  ExtractOptions,
  ExtractedParam,
  ExtractedQuery,
} from "./types.js";
import { shortId } from "./hash.js";

const DEFAULT_METHODS = [
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
];

export function defaultPrismaQueryMethods(): Set<string> {
  return new Set(DEFAULT_METHODS);
}

function getClientRootSource(
  root: ts.Expression,
  segments: string[],
  options: ExtractOptions
): string | null {
  if (ts.isIdentifier(root)) {
    if (options.dbAliases.includes(root.text)) return root.text;
    if (options.transactionAliases.includes(root.text)) return root.text;
    return null;
  }
  // `this.db.model.method` unwinds to root `this` with segments [db, model, method]
  if (root.kind === ts.SyntaxKind.ThisKeyword && segments.length >= 3) {
    const prop = segments[0]!;
    if (options.thisPropertyNames.includes(prop)) {
      return `this.${prop}`;
    }
  }
  return null;
}

function getPropertyName(
  name: ts.PropertyName | ts.MemberName
): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
    return name.text;
  return null;
}

function calleeChain(
  expr: ts.LeftHandSideExpression
): { root: ts.Expression; segments: string[] } | null {
  const segments: string[] = [];
  let current: ts.Expression = expr;

  for (;;) {
    if (ts.isPropertyAccessExpression(current)) {
      const seg = getPropertyName(current.name);
      if (!seg) return null;
      segments.unshift(seg);
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    break;
  }

  return { root: current, segments };
}

function extractCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  options: ExtractOptions,
  checker: ts.TypeChecker
): ExtractedQuery | null {
  const chain = calleeChain(node.expression);
  if (!chain) return null;
  const { root, segments } = chain;
  if (segments.length < 2) return null;

  let model: string;
  let method: string;
  let clientSource: string | null;

  if (root.kind === ts.SyntaxKind.ThisKeyword && segments.length >= 3) {
    clientSource = getClientRootSource(root, segments, options);
    if (!clientSource) return null;
    method = segments[segments.length - 1]!;
    if (!options.prismaQueryMethods.has(method)) return null;
    model = segments[segments.length - 2]!;
  } else {
    clientSource = getClientRootSource(root, segments, options);
    if (!clientSource) return null;
    method = segments[segments.length - 1]!;
    if (!options.prismaQueryMethods.has(method)) return null;
    model = segments[segments.length - 2]!;
  }
  if (!model) return null;

  const argsText = node.arguments.map((a) => a.getText(sourceFile)).join(", ");
  const arg0Source =
    node.arguments.length > 0 ? node.arguments[0]!.getText(sourceFile) : null;

  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile, false)
  );

  const relFile = path.relative(options.root, sourceFile.fileName);
  const id = shortId([
    relFile,
    String(line),
    String(character),
    clientSource,
    model,
    method,
    argsText,
  ]);

  return {
    id,
    file: relFile.split(path.sep).join("/"),
    line: line + 1,
    column: character + 1,
    dbAlias: clientSource,
    model,
    method,
    arg0Source,
    argsSource: argsText,
    params: inferQueryParams(node, checker),
  };
}

function visit(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  options: ExtractOptions,
  checker: ts.TypeChecker,
  out: ExtractedQuery[]
): void {
  if (ts.isCallExpression(node)) {
    const q = extractCall(node, sourceFile, options, checker);
    if (q) out.push(q);
  }
  ts.forEachChild(node, (child) => visit(child, sourceFile, options, checker, out));
}

function addBindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) {
    out.add(name.text);
    return;
  }
  for (const e of name.elements) {
    if (ts.isOmittedExpression(e)) continue;
    addBindingNames(e.name, out);
  }
}

function collectLocalNames(node: ts.Node, out: Set<string>): void {
  if (ts.isVariableDeclaration(node)) {
    addBindingNames(node.name, out);
  } else if (ts.isParameter(node)) {
    addBindingNames(node.name, out);
  } else if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node)) &&
    node.name
  ) {
    out.add(node.name.text);
  } else if (ts.isImportClause(node) && node.name) {
    out.add(node.name.text);
  } else if (
    ts.isImportSpecifier(node) ||
    ts.isNamespaceImport(node) ||
    ts.isImportEqualsDeclaration(node)
  ) {
    out.add(node.name.text);
  }
  ts.forEachChild(node, (child) => collectLocalNames(child, out));
}

function inferQueryParams(
  call: ts.CallExpression,
  checker: ts.TypeChecker
): ExtractedParam[] {
  const sourceFile = call.getSourceFile();
  const localNames = new Set<string>();
  for (const arg of call.arguments) {
    collectLocalNames(arg, localNames);
  }

  const byName = new Map<string, ExtractedParam>();
  const printer = ts.createPrinter({ removeComments: true });
  const printTypeInline = (type: ts.Type, atNode: ts.Node): string => {
    try {
      const node = checker.typeToTypeNode(
        type,
        atNode,
        ts.NodeBuilderFlags.NoTruncation |
          ts.NodeBuilderFlags.UseStructuralFallback |
          ts.NodeBuilderFlags.MultilineObjectLiterals |
          ts.NodeBuilderFlags.WriteTypeArgumentsOfSignature
      );
      if (!node) return "unknown";
      const rendered = printer.printNode(
        ts.EmitHint.Unspecified,
        node,
        atNode.getSourceFile()
      );
      return rendered && rendered.trim() ? rendered.trim() : "unknown";
    } catch {
      return "unknown";
    }
  };
  const isCapturedValueDeclaration = (decl: ts.Declaration): boolean => {
    const isImportDecl =
      ts.isImportSpecifier(decl) ||
      ts.isImportClause(decl) ||
      ts.isNamespaceImport(decl) ||
      ts.isImportEqualsDeclaration(decl);
    const isSameFileDecl = decl.getSourceFile().fileName === sourceFile.fileName;
    if (!isImportDecl && !isSameFileDecl) return false;
    return (
      ts.isVariableDeclaration(decl) ||
      ts.isParameter(decl) ||
      ts.isBindingElement(decl) ||
      isImportDecl
    );
  };
  const includeIdentifier = (id: ts.Identifier): boolean => {
    const p = id.parent;
    if (!p) return true;
    if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
    // Object literal keys are syntax, not captured runtime params.
    if (
      ts.isPropertyAssignment(p) &&
      p.name.getStart() === id.getStart() &&
      p.name.getEnd() === id.getEnd()
    ) {
      return false;
    }
    // Shorthand `{ foo }` is a real value capture and should be included.
    if (ts.isShorthandPropertyAssignment(p) && p.name === id) return true;
    if (ts.isImportSpecifier(p) || ts.isImportClause(p)) return false;
    return true;
  };

  for (const arg of call.arguments) {
    const argStart = arg.getStart();
    const argEnd = arg.getEnd();
    const walk = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && includeIdentifier(n) && !localNames.has(n.text)) {
        const symbol = checker.getSymbolAtLocation(n);
        if (!symbol) {
          ts.forEachChild(n, walk);
          return;
        }
        const resolved =
          (symbol.flags & ts.SymbolFlags.Alias) !== 0
            ? checker.getAliasedSymbol(symbol)
            : symbol;
        const decls = resolved.declarations ?? [];
        if (!decls.some(isCapturedValueDeclaration)) {
          ts.forEachChild(n, walk);
          return;
        }
        // Ignore identifiers whose declarations are fully inside the current
        // argument expression (object keys, inline locals, etc.).
        const allDeclaredInsideArg =
          decls.length > 0 &&
          decls.every((d) => {
            const start = d.getStart();
            const end = d.getEnd();
            return start >= argStart && end <= argEnd;
          });
        if (allDeclaredInsideArg) {
          ts.forEachChild(n, walk);
          return;
        }
        const type = checker.getTypeAtLocation(n);
        const typeText = printTypeInline(type, n);
        if (!byName.has(n.text)) {
          byName.set(n.text, {
            name: n.text,
            typeText: typeText && typeText.trim() ? typeText : "unknown",
            origin: "identifier",
          });
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(arg);
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function collectSourceFiles(
  options: ExtractOptions
): Promise<string[]> {
  const patterns = options.include.map((p) =>
    path.isAbsolute(p) ? p : path.join(options.root, p)
  );
  const files = await fg(patterns, {
    absolute: true,
    onlyFiles: true,
    unique: true,
    ignore: options.exclude,
    dot: false,
  });
  return files.filter((f) => {
    const ext = path.extname(f);
    return ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts";
  });
}

export async function findZmodelFiles(root: string): Promise<string[]> {
  const files = await fg(["**/*.zmodel"], {
    cwd: root,
    absolute: false,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
  });
  return files.sort();
}

export async function extractQueries(
  options: ExtractOptions
): Promise<ExtractedQuery[]> {
  const files = await collectSourceFiles(options);
  const program = ts.createProgram({
    rootNames: files,
    options: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      allowJs: false,
      noEmit: true,
    },
  });
  const checker = program.getTypeChecker();
  const queries: ExtractedQuery[] = [];

  for (const filePath of files) {
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) continue;
    visit(sourceFile, sourceFile, options, checker, queries);
  }

  const seen = new Set<string>();
  const deduped: ExtractedQuery[] = [];
  for (const q of queries) {
    const key = `${q.file}:${q.line}:${q.column}:${q.method}:${q.argsSource}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(q);
  }
  deduped.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)
  );
  return deduped;
}

function readZmodelContents(
  root: string,
  relativePaths: string[],
  maxBytesPerFile: number
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of relativePaths) {
    const abs = path.join(root, rel);
    try {
      const buf = fs.readFileSync(abs);
      const slice = buf.subarray(0, maxBytesPerFile);
      let text = slice.toString("utf8");
      if (buf.length > maxBytesPerFile) {
        text += `\n/* ... truncated after ${maxBytesPerFile} bytes ... */\n`;
      }
      out[rel.split(path.sep).join("/")] = text;
    } catch {
      out[rel.split(path.sep).join("/")] = `/* failed to read: ${rel} */\n`;
    }
  }
  return out;
}

export async function buildManifest(
  options: ExtractOptions,
  zmodelReadOpts: { maxBytesPerFile: number } = { maxBytesPerFile: 512_000 }
): Promise<ExtractManifest> {
  const [queries, zmodelFiles] = await Promise.all([
    extractQueries(options),
    findZmodelFiles(options.root),
  ]);
  const zmodelContents = readZmodelContents(
    options.root,
    zmodelFiles,
    zmodelReadOpts.maxBytesPerFile
  );
  return {
    version: 1,
    root: options.root,
    extractedAt: new Date().toISOString(),
    zmodelFiles,
    zmodelContents,
    queries,
  };
}
