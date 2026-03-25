import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import type { ExtractManifest, ExtractOptions, ExtractedQuery } from "./types.js";
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
  options: ExtractOptions
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
  };
}

function visit(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  options: ExtractOptions,
  out: ExtractedQuery[]
): void {
  if (ts.isCallExpression(node)) {
    const q = extractCall(node, sourceFile, options);
    if (q) out.push(q);
  }
  ts.forEachChild(node, (child) => visit(child, sourceFile, options, out));
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
  const queries: ExtractedQuery[] = [];

  for (const filePath of files) {
    const text = fs.readFileSync(filePath, "utf8");
    const scriptKind =
      filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(
      filePath,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );
    visit(sourceFile, sourceFile, options, queries);
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
