/**
 * Deep-merge Prisma-style call arguments: patch wins, objects recurse, arrays replaced by patch.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

export function mergeQueryArgs(
  base: unknown,
  patch: unknown
): unknown {
  if (patch === undefined) return base;
  if (base === undefined || base === null) return patch;
  if (patch === null) return null;

  if (Array.isArray(base) && Array.isArray(patch)) {
    return patch;
  }
  if (isPlainObject(base) && isPlainObject(patch)) {
    const out: Record<string, unknown> = { ...base };
    for (const k of Object.keys(patch)) {
      const pv = patch[k];
      if (pv === undefined) continue;
      out[k] = mergeQueryArgs(out[k], pv);
    }
    return out;
  }
  return patch;
}

export function mergeQueryArgsInlineSource(): string {
  return `
function __mergeQueryArgs(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (base === undefined || base === null) return patch;
  if (patch === null) return null;
  if (Array.isArray(base) && Array.isArray(patch)) return patch;
  if (
    base !== null &&
    typeof base === "object" &&
    !Array.isArray(base) &&
    Object.getPrototypeOf(base) === Object.prototype &&
    patch !== null &&
    typeof patch === "object" &&
    !Array.isArray(patch) &&
    Object.getPrototypeOf(patch) === Object.prototype
  ) {
    const b = base as Record<string, unknown>;
    const p = patch as Record<string, unknown>;
    const out: Record<string, unknown> = { ...b };
    for (const k of Object.keys(p)) {
      const pv = p[k];
      if (pv === undefined) continue;
      out[k] = __mergeQueryArgs(out[k], pv);
    }
    return out;
  }
  return patch;
}
`.trim();
}
