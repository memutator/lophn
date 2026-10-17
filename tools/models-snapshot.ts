// 판을 낼 때 돌린다. models.dev의 api.json을 lophn 항목으로 바꿔 동봉 catalog
// snapshot(packages/core/lophn-agent/models/snapshot.json)을 새로 쓴다.
// 실행 때 갱신(parseCatalogBody)과 같은 변환(modelsDevEntries)을 쓴다.
// 실행: deno run --allow-net=models.dev --allow-read --allow-write tools/models-snapshot.ts [--from <api.json>]
import { formatAt } from "../packages/base/mod.ts";
import { modelsDevEntries } from "../packages/core/lophn-agent/models/adapters/models-dev.ts";

const SNAPSHOT = new URL(
  "../packages/core/lophn-agent/models/snapshot.json",
  import.meta.url,
);

type Entry = { provider_definition: string; model_name: string };

const from = Deno.args[0] === "--from" ? Deno.args[1] : undefined;
const apiText = from === undefined
  ? await (await fetch("https://models.dev/api.json")).text()
  : await Deno.readTextFile(from);

const converted = modelsDevEntries(
  JSON.parse(apiText),
  formatAt(Date.now()),
);
if (!converted.ok) throw new Error(converted.error.message);
const fresh = (converted.value as Entry[]).map((entry) => ({
  ...entry,
  source: "release_snapshot",
}));

// models.dev에 없는 정의(예: ollama)는 지금 snapshot의 항목을 그대로 옮긴다.
const covered = new Set(fresh.map((entry) => entry.provider_definition));
const previous = JSON.parse(await Deno.readTextFile(SNAPSHOT)) as Entry[];
const carried = previous.filter((entry) =>
  !covered.has(entry.provider_definition)
);

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const all = [...fresh, ...carried].sort((a, b) =>
  compare(a.provider_definition, b.provider_definition) ||
  compare(a.model_name, b.model_name)
);
await Deno.writeTextFile(SNAPSHOT, JSON.stringify(all, null, 2) + "\n");
console.log(
  `${all.length} entries (${fresh.length} from models.dev, ${carried.length} carried)`,
);
