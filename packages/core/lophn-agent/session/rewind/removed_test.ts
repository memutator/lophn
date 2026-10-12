import { assert, assertEquals } from "@std/assert";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  REVERT_EVENTS,
  REVERT_ROUTES,
} from "../../../../protocol/lophn-agent/mod.ts";

// 옛 "run 되돌리기"가 없어졌음을 본다(agent-RW3a의 첫 일). owner 기반 판정·run 단위 revert는 새
// 설계에 맞지 않아 고치지 않고 지운다(AGENTS.md 호환성).

const OLD_FILES = [
  "owners.ts",
  "audit-owners.ts",
  "context-owner.ts",
  "documents-owner.ts",
  "interpretation-owner.ts",
  "term-owner.ts",
  "chain.ts",
  "visibility.ts",
  "work.ts",
  "model.ts",
  "revert_test.ts",
  "context_revert_test.ts",
  "interpretation_revert_test.ts",
];

Deno.test("lophn-agent/revert#R1 [agent-RW3a]: the run-based owner revert code and its tests are gone", () => {
  const present = OLD_FILES.filter((name) =>
    existsSync(fileURLToPath(new URL(`./${name}`, import.meta.url)))
  );
  assertEquals(present, []);
});

Deno.test("lophn-agent/revert#R1 [agent-RW3a]: no RevertRun route or run-based event remains in the contract", () => {
  const names = REVERT_ROUTES.map((route) => route.name);
  assert(!names.includes("RevertRun"));
  assertEquals(
    names.filter((name) => name.includes("Run") && name !== "RunAppRevert"),
    [],
  );
  for (const event of REVERT_EVENTS) {
    // 새 payload는 run이 아니라 session을 싣는다.
    const shape = (event.payload as unknown as { shape: object }).shape;
    assert("session" in shape);
    assert(!("run" in shape));
  }
});
