import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock, ok } from "../../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import { terminalViewWiring } from "./terminal-view.ts";

const TERMINAL = "trm_01hzx3k4m5n6p7q8r9s0t1v2w3";
const who = (principal: string): AuthenticatedContext => ({
  principal,
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: principal,
});

// 허락 칸을 채우는 쪽이 없으면(기기 허락이 아직 없으면) 어떤 principal도 터미널에 칠 수 없고 터미널에 아무것도 가지 않는다.
test("terminalInputGrant 칸이 채워지지 않았으면 terminal_view/input은 늘 forbidden이다", async () => {
  const slots: Record<string, unknown> = {};
  const sent: unknown[] = [];
  const ctx = {
    clock: manualClock(0),
    peek: slots,
    get terminalView() {
      return slots.terminalView;
    },
    provide: (name: string, value: unknown) => {
      slots[name] = value;
    },
    bus: { publish() {} },
    terminals: {
      write: (terminal: string, text: string) => {
        sent.push({ terminal, text });
        return Promise.resolve(ok(undefined));
      },
    },
    terminalAgents: {
      coding: { terminalKnown: () => true, onChange: () => () => {} },
    },
  };
  const wiring = terminalViewWiring();
  wiring.prepare!(ctx as never);
  const built = await wiring.build!(ctx as never);
  assert.ok(built.ok);
  const memory = new Map(
    built.value.memory as Iterable<[string, MemoryHandler]>,
  );
  const input = memory.get("terminal_view/input")!;
  const body = { terminal: TERMINAL, text: "ls\n", key: "k1" };

  const refused = await input(who("device:a"), body);
  assert.ok(!refused.ok && refused.error.code === "forbidden");
  assert.deepEqual(sent, []);

  slots.terminalInputGrant = (principal: string) => principal === "device:a";
  assert.ok((await input(who("device:a"), body)).ok);
  const other = await input(who("device:b"), { ...body, key: "k2" });
  assert.ok(!other.ok && other.error.code === "forbidden");
  assert.equal(sent.length, 1);
  wiring.closeWork!();
});
