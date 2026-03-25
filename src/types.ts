/** Single extracted call site: db.<model>.<method>(args) */

export interface ExtractedQuery {
  /** Stable id (hash of file + position + model + method) */
  id: string;
  file: string;
  line: number;
  column: number;
  dbAlias: string;
  model: string;
  method: string;
  /** First argument source text, if present */
  arg0Source: string | null;
  /** Full argument list source inside (...) */
  argsSource: string;
}

export interface ExtractManifest {
  version: 1;
  root: string;
  extractedAt: string;
  zmodelFiles: string[];
  /** Relative path -> file text (for audit / reproducing schema in harness) */
  zmodelContents?: Record<string, string>;
  queries: ExtractedQuery[];
}

export interface ExtractOptions {
  root: string;
  include: string[];
  exclude: string[];
  dbAliases: string[];
  prismaQueryMethods: Set<string>;
}

export interface CompareOptions {
  cwd: string;
  queriesModule: string;
  enhanceV2Module: string;
  enhanceV3Module: string;
  prismaClientSpecifier: string;
  queryIds?: string[];
  json: boolean;
}
