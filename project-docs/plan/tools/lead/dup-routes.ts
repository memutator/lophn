import { ALL_ROUTES } from "/home/pyosechang/projects/lophn/packages/protocol/mod.ts";
const seen = new Map<string, number>();
for (const r of ALL_ROUTES as unknown as Record<string, unknown>[]) {
  const key = String(r.name ?? r.command ?? r.method ?? JSON.stringify(Object.keys(r)));
  seen.set(key, (seen.get(key) ?? 0) + 1);
}
const dups = [...seen].filter(([, n]) => n > 1);
console.log(`routes ${ALL_ROUTES.length}, duplicates ${dups.length}`, dups.slice(0, 10));
