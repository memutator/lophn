// route 이름 중복 검사. boot.sh가 부른다. 실행: deno run -A --config deno.json <이 file> (저장소 root에서)
import { ALL_ROUTES } from "../../../../packages/protocol/mod.ts";
const seen = new Map<string, number>();
for (const r of ALL_ROUTES as unknown as Record<string, unknown>[]) {
  const key = String(r.name ?? r.command ?? r.method ?? JSON.stringify(Object.keys(r)));
  seen.set(key, (seen.get(key) ?? 0) + 1);
}
const dups = [...seen].filter(([, n]) => n > 1);
console.log(`routes ${ALL_ROUTES.length}, duplicates ${dups.length}`, dups.slice(0, 10));
