import { assertEquals } from "@std/assert";
import { err, ok } from "../../../../base/mod.ts";
import { createTicketCheckHandler } from "./handler.ts";

const TKT = "tkt_01hzzzzzzzzzzzzzzzzzzzzzza";
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const REL = "rel_01hzzzzzzzzzzzzzzzzzzzzzza";

// 예시를 test로 만들 수 없는 보고는 재시도로 남기지 않고 fail로 기록해야 ticket을 verify할 수 있다.
Deno.test("an examples check that cannot be prepared is recorded as fail, not retried", async () => {
  const recorded: { result: string; reason: string }[] = [];
  const handler = createTicketCheckHandler({
    work: () =>
      Promise.resolve(ok({
        work: {
          ticket: TKT,
          app: APP,
          revision: "1",
          completion_seq: "5",
          release: { id: REL, app: APP, bundle_hash: "a".repeat(64) },
          check: {
            kind: "examples",
            steps: [{ api: "notes.list", expect: [] }],
          },
          verifications: [],
        },
      })),
    requestExamples: () =>
      Promise.resolve(err({ code: "invalid_input", message: "bad bundle" })),
    record: (call) => {
      recorded.push(call);
      return Promise.resolve(ok(undefined));
    },
  });
  const done = await handler.handle(
    { seq: "5", subject: TKT } as never,
    { idempotencyKey: () => Promise.resolve("k") } as never,
  );
  assertEquals(done.ok, true);
  assertEquals(recorded.length, 1);
  assertEquals(recorded[0]?.result, "fail");
  assertEquals(
    recorded[0]?.reason,
    "the examples could not be prepared: bad bundle",
  );
});
