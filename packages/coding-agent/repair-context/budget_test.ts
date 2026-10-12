import { assert, assertEquals } from "@std/assert";
import {
  REPAIR_CONTEXT_BYTES,
  REPAIR_CONTEXT_LINES,
  REPAIR_CONTEXT_SUMMARY_MAX_CHARS,
  RepairContextSchema,
} from "../../protocol/coding-agent/mod.ts";
import { assembleRepairContext, renderBundleText } from "./assemble.ts";
import { lineCount, utf8Bytes } from "./text.ts";
import {
  APP,
  fakePort,
  newWorld,
  P1,
  relId,
  TICKET,
  ticketOf,
} from "./testing/mod.ts";

// 큰 문제 여러 개. 다국어 한 줄 큰 log와 긴 사람 글이 묶음 예산을 넘기게 한다.
const PROBLEMS = [
  P1,
  "prb_01arz3ndektsv4rrffq69g5fb1",
  "prb_01arz3ndektsv4rrffq69g5fb2",
  "prb_01arz3ndektsv4rrffq69g5fb3",
];

function bigWorld(lineBytes: number) {
  const world = newWorld();
  const log = Array.from(
    { length: 400 },
    (_, i) => `로그 ${i} ${"긴🙂".repeat(lineBytes)}`,
  ).join("\n");
  for (const id of PROBLEMS) {
    world.problems.set(id, {
      app: APP,
      text: "저장 버튼을 누르면 멈춘다 ".repeat(400),
      reports: Array.from({ length: 12 }, (_, i) => ({
        n: i + 1,
        release: relId(1),
        command: `cmd${i % 4}`,
        frame: `src/f${i % 5}.ts`,
        message: "boom ".repeat(500),
        text: i === 0 ? "사람이 쓴 긴 글 ".repeat(300) : undefined,
        logs: log,
      })),
    });
  }
  world.releases.push({ n: 1, created_at: "2026-09-30T00:00:00.000Z" });
  world.tickets.set(TICKET, ticketOf(PROBLEMS));
  return world;
}

Deno.test("coding-agent/repair-context#R11 R12: 묶음은 24,576 bytes와 300줄 둘 다 안이고 줄인 자리마다 원래 크기와 실제 이어 읽기를 적는다", async () => {
  for (const lineBytes of [4, 400]) {
    const world = bigWorld(lineBytes);
    const assembled = await assembleRepairContext(fakePort(world), {
      ticket: TICKET,
    });
    assert(assembled.ok, JSON.stringify(assembled));
    const context = assembled.value.context;
    assert(context !== null, "줄여서 한도 안에 든다");
    const text = renderBundleText(context);
    assert(utf8Bytes(text) <= REPAIR_CONTEXT_BYTES);
    assert(lineCount(text) <= REPAIR_CONTEXT_LINES);
    assertEquals(context.bytes, utf8Bytes(text));
    assertEquals(context.lines, lineCount(text));
    assertEquals(RepairContextSchema.safeParse(context).success, true);
    // 줄인 절은 truncated이고 실제 이어 읽기 참조가 있다. 본문에 원래 크기와 이어 읽기가 보인다.
    const reduced = context.sections.filter((section) =>
      section.content.startsWith("전체 예산 때문에 생략")
    );
    assert(reduced.length > 0, "예산 때문에 줄인 절이 있다");
    for (const section of reduced) {
      assertEquals(section.availability, "truncated");
      assert(section.more !== null && section.more.length > 0);
      assert(/원래 \d+ bytes·\d+줄/.test(section.content));
      assert(section.content.includes(`more ${section.more[0].kind}`));
    }
    // 줄이는 순서: log가 먼저 줄고, 증상은 마지막까지 남는다.
    assert(
      context.sections.some((section) =>
        section.kind === "logs" &&
        section.content.startsWith("전체 예산 때문에 생략")
      ),
    );
    assert(
      context.sections.some((section) => section.kind === "target_symptom"),
    );
    assertEquals(context.truncated, true);
    // summary는 문제당 2줄·전체 10줄·1,200자 안이다.
    const summary = assembled.value.summary;
    const chars = summary.problems.reduce(
      (sum, item) =>
        sum +
        Array.from(
          `${item.id} ${item.status}\n${item.symptom}\n${item.next_action}`,
        )
          .length,
      0,
    );
    assert(chars <= REPAIR_CONTEXT_SUMMARY_MAX_CHARS, `${chars}자`);
    assert(summary.problems.length * 2 <= 10);
  }
});

Deno.test("coding-agent/repair-context#R11: 작은 자료는 줄이지 않는다", async () => {
  const world = newWorld();
  world.problems.set(P1, {
    app: APP,
    text: "작은 문제",
    reports: [{
      n: 1,
      release: relId(1),
      command: "save",
      frame: "src/a.ts",
      message: "boom",
      logs: "a\nb",
    }],
  });
  world.releases.push({ n: 1, created_at: "2026-09-30T00:00:00.000Z" });
  const assembled = await assembleRepairContext(fakePort(world), {
    problem: P1,
  });
  assert(assembled.ok && assembled.value.context !== null);
  assert(
    !assembled.value.context.sections.some((section) =>
      section.content.startsWith("전체 예산 때문에 생략")
    ),
  );
});
