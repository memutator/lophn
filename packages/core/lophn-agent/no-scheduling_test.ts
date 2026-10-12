import { assert, assertEquals } from "@std/assert";
import { runSchemaSteps } from "./run-loop/schema.ts";
import * as operator from "./roles/operator/mod.ts";
import {
  RUN_OUTCOME_REASONS,
  runSourceSchema,
} from "../../protocol/lophn-agent/mod.ts";

// lophn-agent/scheduling [agent-R3]: 주기(scheduling)는 보류다. 요구 문서만 남고 폴더·contract·
// occurrence 시계·runs의 schedule 출처 열·periodic origin·no_change·알림 계기가 코드에서 없어졌다.
// 다시 만들 때는 agent 정의 위에 새로 쓴다.

const REPO = new URL("../../../", import.meta.url);

function exists(path: string): boolean {
  try {
    Deno.statSync(new URL(path, REPO));
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function* sources(directory: URL): Generator<URL> {
  for (const entry of Deno.readDirSync(directory)) {
    const child = new URL(
      `${entry.name}${entry.isDirectory ? "/" : ""}`,
      directory,
    );
    if (entry.isDirectory) {
      if (entry.name !== "node_modules" && entry.name !== "testdata") {
        yield* sources(child);
      }
    } else if (/\.(ts|tsx)$/.test(entry.name)) yield child;
  }
}

function textsUnder(...roots: string[]): Map<string, string> {
  const texts = new Map<string, string>();
  for (const root of roots) {
    for (const file of sources(new URL(root, REPO))) {
      if (file.pathname === new URL(import.meta.url).pathname) continue;
      texts.set(file.pathname, Deno.readTextFileSync(file));
    }
  }
  return texts;
}

function mentions(texts: Map<string, string>, pattern: RegExp): string[] {
  return [...texts].filter(([, text]) => pattern.test(text)).map(([path]) =>
    path
  );
}

Deno.test("lophn-agent/scheduling [agent-R3]: 폴더·contract·base 계산이 없고 어느 코드도 부르지 않는다", () => {
  for (
    const path of [
      "packages/core/lophn-agent/scheduling",
      "packages/protocol/lophn-agent/occurrences.ts",
      "packages/protocol/lophn-agent/occurrences_test.ts",
      "packages/base/schedule.ts",
      "packages/base/schedule_test.ts",
    ]
  ) assertEquals(exists(path), false, path);
  const all = textsUnder("packages/");
  assertEquals(
    mentions(
      all,
      /lophn-agent\/scheduling\/|\.\/occurrences\.ts|createOccurrenceClock|processAssignmentOccurrence|assignment-occurrences|AssignmentScheduleAdvanced|\bdueTimes\b/,
    ),
    [],
  );
});

Deno.test("lophn-agent/scheduling [agent-R3]: agent-runtime에 occurrence 시계가 없다", () => {
  assertEquals(
    mentions(
      textsUnder(
        "packages/core/main/agent-runtime/",
        "packages/core/lophn-agent/run-loop/",
      ),
      /occurrence/i,
    ),
    [],
  );
});

Deno.test("lophn-agent/scheduling [agent-R3]: runs에는 schedule 출처 열·check·index가 없고 출처 종류는 message·handoff다", () => {
  const sql = runSchemaSteps.map((step) => step.sql).join("\n");
  assert(!sql.includes("source_scheduled_at"));
  assert(!sql.includes("source_assignment_revision"));
  assert(!sql.includes("runs_source_schedule"));
  assert(!sql.includes("'schedule'"));
  assertEquals(
    runSourceSchema.safeParse({
      kind: "schedule",
      assignment_revision: 1,
      scheduled_at: "2026-10-04T00:00:00.000Z",
    }).success,
    false,
  );
});

Deno.test("lophn-agent/scheduling [agent-R3]: tool-judgment에 periodic origin이 없다", () => {
  assertEquals(
    mentions(
      textsUnder("packages/core/lophn-agent/tool-judgment/"),
      /periodic/,
    ),
    [],
  );
});

Deno.test("lophn-agent/scheduling [agent-R3]: Operator 결과와 run 결과 이유에 no_change가 없다", () => {
  assertEquals("noChange" in operator, false);
  assertEquals("outcomeOf" in operator, false);
  assertEquals([...RUN_OUTCOME_REASONS.completed] as string[], [
    "answer_completed",
  ]);
});

Deno.test("lophn-agent/scheduling [agent-R3]: 알림 계기는 내는 곳이 없어진 pause 이유를 세지 않는다", () => {
  assertEquals(
    mentions(
      textsUnder("packages/core/notifications/"),
      /consecutive_failures|output_archived/,
    ).filter((path) => !path.endsWith("_test.ts")),
    [],
  );
});
