import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/mod.ts";
import { resolveMachine } from "../../../../protocol/machine/requester.ts";
import type { CommandEnvelope, Writer } from "../../../storage/ledger/mod.ts";
import { withTriggerMachine } from "./jobs.ts";

const mch = (suffix: string) => `mch_${"0".repeat(24)}${suffix}` as Id<"mch">;
const dev = (suffix: string) => `dev_${"0".repeat(24)}${suffix}` as Id<"dev">;
const computers = [
  { machine: mch("00"), device: dev("00"), name: "studio", self: true },
  { machine: mch("a1"), device: dev("a1"), name: "laptop", self: false },
  { machine: mch("b1"), device: dev("b1"), name: "office", self: false },
  { machine: mch("b2"), device: dev("b2"), name: "office", self: false },
];

// 명단은 main thread에만 있어 job을 저장하기 전에 컴퓨터 이름을 `mch_`로 풀어 둔다. 못 풀거나 이 컴퓨터를 가리키는 이름이 job으로 저장되면 그 job은 영영 돌지 않는다.
test("job을 만들 때 trigger의 컴퓨터 이름은 저장 전에 mch_로 풀리고, 못 풀거나 이름이 겹치거나 이 컴퓨터이거나 명단이 아직 없으면 job을 저장하지 않는다", async () => {
  const stored: CommandEnvelope[] = [];
  const inner = {
    command: async (_ctx: unknown, envelope: CommandEnvelope) => {
      stored.push(envelope);
      return ok({ result: {}, replayed: false });
    },
  } as unknown as Writer;
  let known: typeof computers | undefined = computers;
  const writer = withTriggerMachine(inner, (ref) =>
    known === undefined ? undefined : resolveMachine(ref, known),
  );
  const create = (machine: string) =>
    writer.command(
      {} as never,
      {
        command: "job.create",
        input: {
          title: "t",
          trigger: { source: "app_x", event: "e", machine },
          action: {},
        },
        compare: {},
        idempotency_key: "k",
        prepared: [],
      } as never,
    );
  const code = (done: { ok: boolean; error?: { code: string } }) =>
    done.ok ? "ok" : done.error?.code;

  assert.equal(code(await create("laptop")), "ok");
  assert.equal(
    (stored[0]!.input as { trigger: { machine: string } }).trigger.machine,
    mch("a1"),
  );
  assert.equal(code(await create("nowhere")), "not_found");
  assert.equal(code(await create("office")), "invalid_input");
  assert.equal(code(await create("studio")), "invalid_input");
  known = undefined;
  assert.equal(code(await create("laptop")), "unavailable");
  // 저장 쪽에는 첫 하나만 갔다.
  assert.equal(stored.length, 1);

  // 다른 command와 trigger에 machine이 없는 job은 그대로 지난다.
  known = computers;
  await writer.command(
    {} as never,
    {
      command: "job.create",
      input: {
        title: "t",
        trigger: { source: "masup", event: "e" },
        action: {},
      },
    } as never,
  );
  assert.equal(stored.length, 2);
});
