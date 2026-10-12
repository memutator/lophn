import { assert, assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import { SCAN_CAP, scanVisible } from "./access.ts";

type Row = { seq: bigint };

// seq 내림차순 저장소. before 아래에서 size개를 준다.
function store(top: number) {
  const rows: Row[] = [];
  for (let seq = top; seq >= 1; seq--) rows.push({ seq: BigInt(seq) });
  return (before: bigint | null, size: number): Row[] =>
    rows.filter((row) => before === null || row.seq < before).slice(0, size);
}

Deno.test("problems/reporting#R15: 범위 밖 행은 건너뛰고 limit개를 채운 뒤 보이는 행이 더 있을 때만 cursor를 준다", () => {
  const load = store(10);
  const even = (row: Row) => ok(row.seq % 2n === 0n);
  const first = scanVisible({ limit: 2, before: null, load, visible: even });
  assert(first.ok);
  assertEquals(first.value.rows.map((row) => row.seq), [10n, 8n]);
  assertEquals(first.value.next, "8");
  const second = scanVisible({ limit: 2, before: 8n, load, visible: even });
  assert(second.ok);
  assertEquals(second.value.rows.map((row) => row.seq), [6n, 4n]);
  assertEquals(second.value.next, "4");
  // 마지막 page는 남은 보이는 행이 limit 이하이면 cursor가 없다.
  const last = scanVisible({ limit: 2, before: 4n, load, visible: even });
  assert(last.ok);
  assertEquals(last.value.rows.map((row) => row.seq), [2n]);
  assertEquals(last.value.next, null);
  // 보이는 행이 limit과 같은 개수로 끝나면 빈 page를 약속하지 않는다.
  const exact = scanVisible({ limit: 5, before: null, load, visible: even });
  assert(exact.ok);
  assertEquals(exact.value.rows.length, 5);
  assertEquals(exact.value.next, null);
});

Deno.test("problems/reporting#R15: 보이는 행이 없어도 훑는 행은 상한이 있고 짧은 page와 cursor로 잇는다", () => {
  const load = store(SCAN_CAP + 500);
  const none = scanVisible({
    limit: 3,
    before: null,
    load,
    visible: () => ok(false),
  });
  assert(none.ok);
  assertEquals(none.value.rows, []);
  // 다음 호출이 마지막으로 훑은 위치에서 이어 간다.
  assertEquals(none.value.next, String(BigInt(500 + 1)));
  const rest = scanVisible({
    limit: 3,
    before: BigInt(none.value.next!),
    load,
    visible: (row) => ok(row.seq === 7n),
  });
  assert(rest.ok);
  assertEquals(rest.value.rows.map((row) => row.seq), [7n]);
  assertEquals(rest.value.next, null);
});
