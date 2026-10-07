import { assert, assertEquals, assertFalse } from "@std/assert";
import { ok } from "../../base/mod.ts";
import { EVIDENCE_PAGE_LIMITS } from "../../contracts/coding-agent/mod.ts";
import { createRepairCursor } from "./cursor.ts";
import { repairMore, textPage } from "./more.ts";
import type { RepairReadPort } from "./model.ts";
import { lineCount, utf8Bytes } from "./text.ts";
import {
  APP,
  fakePort,
  HIDDEN,
  newWorld,
  P1,
  rid,
  sid,
} from "./testing/mod.ts";

type Page = {
  item: string | { open: unknown; size_bytes: number };
  missing: { reason: string } | null;
  next_cursor: string | null;
  as_of_seq: string;
};

// fence 줄과 접두를 벗기고 escape를 되돌린 자료 줄이다.
function dataLines(item: unknown): string[] {
  const lines = String(item).split("\n");
  return lines.slice(1, -1).map((line) =>
    line.slice(2).split("<<\\<").join("<<<")
  );
}

function logWorld(logs: string, count = 1) {
  const world = newWorld();
  const reports = Array.from({ length: count }, (_, i) => ({
    n: i + 1,
    release: null,
    command: "save",
    frame: "src/a.ts",
    message: "boom",
    logs: i === count - 1 ? logs : undefined,
  }));
  world.problems.set(P1, { app: APP, text: "t", reports });
  return world;
}

async function readAll(
  port: RepairReadPort,
  input: { kind: string; source: string },
  principal = "p1",
): Promise<Page[]> {
  const cursor = await createRepairCursor();
  const pages: Page[] = [];
  let next: string | null = null;
  for (let i = 0; i < 100; i += 1) {
    const read = await repairMore(
      port,
      { problem: P1, ...input, cursor: next },
      principal,
      cursor,
    );
    assert(read.ok, JSON.stringify(read));
    pages.push(read.value as unknown as Page);
    next = (read.value as unknown as Page).next_cursor;
    if (next === null) return pages;
  }
  throw new Error("끝나지 않는다");
}

Deno.test("coding-agent/repair-context#R11 R15: 한 페이지는 24,576 bytes와 300줄 안이고 다국어·한 줄 큰 자료도 code point 중간을 자르지 않고 이어진다", () => {
  const text = `${"한글🙂é".repeat(8_000)}\n${"x".repeat(100)}\n끝`;
  let offset: number | null = 0;
  const parts: string[] = [];
  let pages = 0;
  while (offset !== null) {
    const page: { text: string; next: number | null } = textPage(
      text,
      offset,
      EVIDENCE_PAGE_LIMITS.text_lines,
    );
    assert(utf8Bytes(page.text) <= EVIDENCE_PAGE_LIMITS.text_bytes);
    assert(lineCount(page.text) <= EVIDENCE_PAGE_LIMITS.text_lines);
    parts.push(...dataLines(page.text));
    pages += 1;
    offset = page.next;
  }
  // 한 줄 큰 자료는 페이지를 넘어 이어지고, 이어 붙이면 줄바꿈을 뺀 원문 그대로다(누락·중복·깨진 문자 없음).
  assert(pages > 3);
  const joined = parts.join("");
  assertEquals(joined, text.replaceAll("\n", ""));
  assertFalse(joined.includes("\uFFFD"));
});

Deno.test("coding-agent/repair-context#R15: log는 200줄씩 이어 읽고 누락·중복이 없으며 마지막 쪽에서 cursor가 끝난다", async () => {
  const logs = Array.from({ length: 450 }, (_, i) => `log line ${i}`).join(
    "\n",
  );
  const world = logWorld(logs);
  const pages = await readAll(fakePort(world), {
    kind: "log",
    source: `report:${rid(1)}`,
  });
  assertEquals(pages.map((page) => dataLines(page.item).length), [
    200,
    200,
    50,
  ]);
  assertEquals(
    pages.flatMap((page) => dataLines(page.item)),
    logs.split("\n"),
  );
  assertEquals(pages.at(-1)!.next_cursor, null);
  for (const page of pages) {
    assert(lineCount(String(page.item)) <= EVIDENCE_PAGE_LIMITS.text_lines);
  }
});

Deno.test("coding-agent/repair-context#R15: occurrences는 20개씩이고 첫 페이지의 고정 목록에서 누락·중복 없이 읽는다", async () => {
  const world = logWorld("x", 45);
  const pages = await readAll(fakePort(world), {
    kind: "occurrences",
    source: `problem:${P1}`,
  });
  const ids = pages.flatMap((page) =>
    (JSON.parse(dataLines(page.item).join("\n")) as { id: string }[]).map((
      row,
    ) => row.id)
  );
  assertEquals(pages.length, 3);
  assertEquals(ids.length, 45);
  assertEquals(new Set(ids).size, 45);
  assertEquals(ids[0], rid(45));
});

Deno.test("coding-agent/repair-context#R15 R19: cursor는 변조·다른 대상·다른 kind·다른 요청자·재시작 뒤 key로 쓰면 invalid_input이다", async () => {
  const logs = Array.from({ length: 450 }, (_, i) => `l${i}`).join("\n");
  const world = logWorld(logs);
  const port = fakePort(world);
  const cursor = await createRepairCursor();
  const source = `report:${rid(1)}`;
  const first = await repairMore(
    port,
    { problem: P1, kind: "log", source, cursor: null },
    "p1",
    cursor,
  );
  assert(first.ok);
  const next = (first.value as unknown as Page).next_cursor!;
  assert(next.length < 4096);
  const code = async (
    input: Record<string, unknown>,
    principal = "p1",
    use = cursor,
  ) => {
    const read = await repairMore(port, input, principal, use);
    return read.ok ? "ok" : read.error.code;
  };
  const base = { problem: P1, kind: "log", source, cursor: next };
  assertEquals(await code(base), "ok");
  // 변조: 본문 한 글자·서명 한 글자.
  const [body, mac] = next.split(".");
  const flip = (value: string) =>
    `${value.slice(0, 3)}${value[3] === "A" ? "B" : "A"}${value.slice(4)}`;
  assertEquals(
    await code({ ...base, cursor: `${flip(body)}.${mac}` }),
    "invalid_input",
  );
  assertEquals(
    await code({ ...base, cursor: `${body}.${flip(mac)}` }),
    "invalid_input",
  );
  assertEquals(
    await code({ ...base, cursor: "x".repeat(5_000) }),
    "invalid_input",
  );
  // 다른 kind·source·요청자는 같은 cursor를 쓰지 못한다.
  assertEquals(await code({ ...base, kind: "screen" }), "invalid_input");
  assertEquals(
    await code({ ...base, source: `report:${rid(2)}` }),
    "invalid_input",
  );
  assertEquals(await code(base, "p2"), "invalid_input");
  // worker가 다시 떠 key가 바뀌면 옛 cursor는 첫 페이지부터 다시 읽으라는 안내와 함께 거절된다.
  const restarted = await repairMore(
    port,
    base,
    "p1",
    await createRepairCursor(),
  );
  assert(!restarted.ok);
  assertEquals(restarted.error.code, "invalid_input");
  assert(restarted.error.message.includes("첫 페이지"));
});

Deno.test("coding-agent/repair-context#R15 R19: 범위 밖 문제는 없는 문제와 같은 답이고 이어 읽을 때마다 범위를 다시 본다", async () => {
  const world = logWorld(
    Array.from({ length: 450 }, (_, i) => `l${i}`).join("\n"),
  );
  world.problems.set(HIDDEN, { app: APP, text: "h", reports: [] });
  world.hidden.add(HIDDEN);
  const port = fakePort(world);
  const cursor = await createRepairCursor();
  const ask = async (problem: string, cur: string | null = null) => {
    const read = await repairMore(
      port,
      { problem, kind: "log", source: `report:${rid(1)}`, cursor: cur },
      "p1",
      cursor,
    );
    return read.ok ? read.value : read.error;
  };
  const absent = await ask("prb_01arz3ndektsv4rrffq69g5fb0");
  assertEquals(await ask(HIDDEN), absent);
  // 첫 페이지 뒤 연결 범위가 바뀌어 문제가 보이지 않게 되면 다음 페이지도 같은 답이다.
  const first = await ask(P1) as unknown as Page;
  assert(first.next_cursor !== null);
  world.hidden.add(P1);
  const later = await ask(P1, first.next_cursor);
  assertEquals(later, absent);
});

Deno.test("coding-agent/repair-context#R16: source_diff는 보존 근거가 없으면 이유만 내고 현재 파일로 보충하지 않는다", async () => {
  const world = logWorld("x");
  const port = fakePort(world);
  const pages = await readAll(port, {
    kind: "source_diff",
    source: `problem:${P1}`,
  });
  assertEquals(pages.length, 1);
  assertEquals(pages[0].item, null);
  assert(pages[0].missing!.reason.includes("source diff"));
  assertEquals(pages[0].next_cursor, null);
});

Deno.test("coding-agent/repair-context#R17: image는 내용·base64가 아니라 허용 첨부 열기 참조·종류·크기만 보낸다", async () => {
  const world = logWorld("x");
  const base = fakePort(world);
  const hash = "5".repeat(64);
  const withScreen = (size: number): RepairReadPort => ({
    ...base,
    async report(id) {
      const read = await base.report(id);
      if (!read.ok) return read;
      const value = structuredClone(read.value) as unknown as Record<
        string,
        unknown
      >;
      (value["snapshot"] as Record<string, unknown>)["screen"] = {
        name: "main",
        observed_at: "2026-10-07T12:00:00.000Z",
        state: null,
        state_missing_reason: { reason: "none" },
        screenshot: hash,
        screenshot_missing_reason: null,
      };
      value["attachments"] = [{
        field: "feedback_screenshot",
        hash,
        size_bytes: size,
      }];
      return ok(value as never);
    },
  });
  const source = `snapshot:${sid(1)}`;
  const [page] = await readAll(withScreen(1234), { kind: "image", source });
  const item = page.item as {
    open: Record<string, unknown>;
    size_bytes: number;
  };
  assertEquals(item.size_bytes, 1234);
  assertEquals(item.open["kind"], "report_attachment");
  assertEquals(item.open["field"], "feedback_screenshot");
  const text = JSON.stringify(page);
  assertFalse(text.includes("base64"));
  assertFalse(text.includes("data:image"));
  assert(page.missing!.reason.includes("image/png"));
  // 상한(2,097,152 bytes)을 넘는 첨부는 참조도 열지 않고 이유만 낸다.
  const [big] = await readAll(
    withScreen(EVIDENCE_PAGE_LIMITS.image_bytes + 1),
    {
      kind: "image",
      source,
    },
  );
  assertEquals(big.item, null);
  assert(big.missing!.reason.includes("2097152"));
});
