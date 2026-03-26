import { createHash } from "node:crypto";

export function shortId(parts: string[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p, "utf8");
  return h.digest("hex").slice(0, 16);
}
