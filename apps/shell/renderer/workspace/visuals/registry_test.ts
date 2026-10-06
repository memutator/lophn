import { assert, assertEquals } from "@std/assert";

import { planChart } from "./chart-plan.ts";
import {
  type ChartContent,
  checkVisual,
  observedAt,
  VISUAL_REGISTRY,
} from "./registry.ts";
import {
  appCardBlock,
  barBlock,
  categoryLineBlock,
  diagramBlock,
  lineBlock,
  OBSERVED,
  scatterBlock,
  tableBlock,
  VALID_BLOCKS,
} from "./testdata/blocks.ts";

// lophn-agent visuals contract를 테스트 실행 중에만 불러온다. renderer 설정(lib ES2023·DOM)으로는
// contracts·base를 type check하지 않으므로 계산한 경로로 불러 필요한 모양만 적는다.
interface Schema {
  safeParse(value: unknown): { success: boolean };
}

async function contract(): Promise<
  { visualBlockSchema: Schema; visualBlockInputSchema: Schema }
> {
  const url = new URL(
    "../../../../../packages/contracts/lophn-agent/visuals.ts",
    import.meta.url,
  );
  return await import(url.href);
}

function edit(
  block: Record<string, unknown>,
  patch: (copy: Record<string, unknown>) => void,
): Record<string, unknown> {
  const copy = structuredClone(block);
  patch(copy);
  return copy;
}

Deno.test("shell/workspace#R12: 허용 registry는 표·차트·도표만 SDK로 그리고 contract를 통과한 블록을 그대로 받는다", async () => {
  assertEquals(Object.keys(VISUAL_REGISTRY).sort(), [
    "chart",
    "diagram",
    "table",
  ]);
  assert(Object.isFrozen(VISUAL_REGISTRY));
  const schemas = await contract();
  for (const block of VALID_BLOCKS) {
    assert(
      schemas.visualBlockInputSchema.safeParse(block).success,
      `${block.key} is not a contract block`,
    );
    const checked = checkVisual(block);
    assert(checked.ok, `${block.key} was not accepted`);
    assertEquals(checked.content.kind, block.kind);
  }
  const table = checkVisual(tableBlock);
  assert(table.ok && table.content.kind === "table");
  assertEquals(table.content.rows[1]!["total"], null);
  assertEquals(observedAt(table.sources), OBSERVED);
  // 앱 카드 입력은 그리지 않지만 앱 view 계약에 넘길 값이라 그대로 옮긴다.
  const card = checkVisual(appCardBlock);
  assert(card.ok && card.content.kind === "app_card");
  assertEquals(card.content.input, { range: "7d" });
});

Deno.test("shell/workspace#R12: script 입력은 실행 없이 거절되고 이유와 안전한 설명·출처만 남는다", () => {
  // 모르는 종류(HTML·script·iframe)는 registry에 없다.
  for (const kind of ["html", "script", "iframe", "__proto__", "constructor"]) {
    const checked = checkVisual(
      edit(tableBlock, (copy) => {
        copy["kind"] = kind;
        copy["payload"] = { html: "<script>alert(1)</script>" };
      }),
    );
    assert(!checked.ok);
    assertEquals(checked.reason, "kind");
    assertEquals(checked.title, "Open orders");
    assertEquals(checked.description, tableBlock.description);
    assertEquals(checked.sources.length, 1);
  }
  // payload의 script·html·style field는 선언형 모양에 없다.
  for (const field of ["script", "html", "style", "onload"]) {
    const checked = checkVisual(
      edit(tableBlock, (copy) => {
        (copy["payload"] as Record<string, unknown>)[field] = "alert(1)";
      }),
    );
    assert(!checked.ok);
    assertEquals(checked.reason, "shape");
  }
  // 글 안의 tag·실행 scheme·URL·CSS 함수는 owner 검사와 같은 규칙으로 거절한다.
  const markup = [
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    "javascript:alert(1)",
    "data:text/html;base64,AAAA",
    "https://example.test/x.js",
    "www.example.test",
    "url(evil)",
    "@import 'x'",
  ];
  for (const text of markup) {
    const cell = checkVisual(
      edit(tableBlock, (copy) => {
        const payload = copy["payload"] as { rows: Record<string, unknown>[] };
        payload.rows[0]!["customer"] = text;
      }),
    );
    assert(!cell.ok, text);
    assertEquals(cell.reason, "markup");
    // 제목의 markup은 제목을 남기지 않는다.
    const title = checkVisual(
      edit(barBlock, (copy) => {
        copy["title"] = text;
      }),
    );
    assert(!title.ok);
    assertEquals(title.reason, "markup");
    assertEquals(title.title, null);
    assertEquals(title.description, barBlock.description);
  }
  // 일반 문장은 막지 않는다.
  const plain = checkVisual(
    edit(tableBlock, (copy) => {
      copy["description"] = "Totals are 3 < 5 and a:b. Cost is $5 (est.).";
    }),
  );
  assert(plain.ok);
});

Deno.test("shell/workspace#R12: 모양·상한·판이 맞지 않는 저장 블록은 이용 불가이고 다른 블록 검사와 무관하다", () => {
  const cases: [string, Record<string, unknown>][] = [
    [
      "schema version",
      edit(tableBlock, (copy) => (copy["schema_version"] = 2)),
    ],
    ["key", edit(tableBlock, (copy) => (copy["key"] = "Has Space"))],
    ["empty title", edit(tableBlock, (copy) => (copy["title"] = ""))],
    [
      "long title",
      edit(tableBlock, (copy) => (copy["title"] = "a".repeat(201))),
    ],
    [
      "unknown column",
      edit(tableBlock, (copy) => {
        (copy["payload"] as { rows: Record<string, unknown>[] }).rows[0]![
          "other"
        ] = 1;
      }),
    ],
    [
      "cell type",
      edit(tableBlock, (copy) => {
        (copy["payload"] as { rows: Record<string, unknown>[] }).rows[0]![
          "total"
        ] = "125";
      }),
    ],
    [
      "too many rows",
      edit(tableBlock, (copy) => {
        (copy["payload"] as { rows: unknown[] }).rows = Array.from(
          { length: 1001 },
          () => ({ customer: "a" }),
        );
      }),
    ],
    [
      "x type",
      edit(lineBlock, (copy) => {
        const payload = copy["payload"] as {
          series: { points: { x: unknown }[] }[];
        };
        payload.series[0]!.points[0]!.x = 3;
      }),
    ],
    [
      "scatter category",
      edit(scatterBlock, (copy) => {
        (copy["payload"] as { x: { type: string } }).x.type = "category";
      }),
    ],
    [
      "missing endpoint",
      edit(diagramBlock, (copy) => {
        (copy["payload"] as { edges: { to: string }[] }).edges[0]!.to = "gone";
      }),
    ],
    [
      "app card id",
      edit(appCardBlock, (copy) => {
        (copy["payload"] as { app: string }).app = "app_x";
      }),
    ],
    ["not an object", "<table>" as unknown as Record<string, unknown>],
  ];
  for (const [name, block] of cases) {
    const checked = checkVisual(block);
    assert(!checked.ok, name);
    assert(
      checked.reason === "shape" || checked.reason === "markup",
      `${name}: ${checked.reason}`,
    );
  }
  // 깨진 출처는 남기지 않고 나머지 출처는 그대로 둔다.
  const sources = checkVisual(
    edit(tableBlock, (copy) => {
      copy["payload"] = null;
      copy["sources"] = [
        { kind: "document", reference: { document: "x" }, observed_at: null },
        ...(copy["sources"] as unknown[]),
      ];
    }),
  );
  assert(!sources.ok);
  assertEquals(sources.sources.map((item) => item.kind), ["app_command"]);
  // SDK 도표는 자기 자신을 가리키는 edge를 그리지 않는다.
  const loop = checkVisual(
    edit(diagramBlock, (copy) => {
      (copy["payload"] as { edges: unknown[] }).edges.push({
        from: "new",
        to: "new",
      });
    }),
  );
  assert(!loop.ok);
  assertEquals(loop.reason, "drawing");
});

Deno.test("shell/workspace#R12: 차트는 SDK가 그릴 수 있는 입력으로 옮기고 결측을 0으로 바꾸지 않는다", () => {
  const content = (block: unknown): ChartContent => {
    const checked = checkVisual(block);
    if (!checked.ok || checked.content.kind !== "chart") {
      throw new Error("not a chart");
    }
    return checked.content;
  };
  const bar = planChart(content(barBlock));
  assert(bar.draw === "bar");
  assertEquals(bar.categories, ["Aug", "Sep", "Oct"]);
  assertEquals(bar.series[0]!.values, [1200, 900, null]);
  const line = planChart(content(lineBlock));
  assert(line.draw === "line");
  assertEquals(line.x.map((x) => x.toISOString()), [
    "2026-10-01T00:00:00.000Z",
    "2026-10-02T00:00:00.000Z",
    "2026-10-03T00:00:00.000Z",
  ]);
  const scatter = planChart(content(scatterBlock));
  assert(scatter.draw === "scatter");
  assertEquals(scatter.groups[0]!.points, [{ x: 1, y: 3 }, { x: 4, y: 9 }]);
  // SDK 선 차트는 시간 축만 그린다. 범주 축의 선은 같은 값을 표로 보인다.
  const steps = planChart(content(categoryLineBlock));
  assert(steps.draw === "table");
  assertEquals(steps.rows.map((row) => row.x), ["Draft", "Review"]);
  // 한 계열에 같은 x가 둘이면 고르지 않고 둘 다 표로 보인다.
  const twice = planChart(content(edit(barBlock, (copy) => {
    const payload = copy["payload"] as {
      series: { points: { x: string; y: number | null }[] }[];
    };
    payload.series[0]!.points.push({ x: "Aug", y: 5 });
  })));
  assert(twice.draw === "table");
  assertEquals(twice.rows[0]!.values, [[1200, 5]]);
});
