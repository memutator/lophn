import { assertEquals } from "@std/assert";
import { join } from "node:path";
import { formatAt } from "../../../packages/base/mod.ts";
import type {
  LoopEnd,
  LoopFailureReason,
} from "../../../packages/core/lophn-agent/run-loop/mod.ts";
import {
  type HarnessTool,
  loopHarness,
  START_MS,
  writeFileTool,
} from "../../support/loop/harness.ts";
import { assertRequestInvariants } from "../../support/loop/invariants.ts";
import {
  answer,
  failed,
  hang,
  partial,
  tools,
} from "../../support/loop/model.ts";

// 세 질문
// - contract: boundary `run-loop`(retry 한도, 한도 도달, 멈춤, 불완전 응답의 tool 미실행). 규칙 5는 `models`의 실패 종류와 맞물린다.
// - 현실적 회귀: partial의 tool을 실행하는 수정, 쓰기 tool에 retry를 붙이는 수정, 되풀이가 끝나지 않는 수정, stop()이 진행 중인 요청을 끊지 않는 수정.
// - 왜 지금 못 잡나: run-loop/에는 단위 test뿐이고 loop를 돌리는 test가 없다.

const completed: LoopEnd = {
  kind: "finished",
  outcome: { kind: "completed", reason: "answer_completed" },
};
const failedWith = (reason: LoopFailureReason): LoopEnd => ({
  kind: "finished",
  outcome: { kind: "failed", reason },
});

const readFile: HarnessTool = {
  name: "read_file",
  effect: "read",
  run: () => ({ status: "success", code: "ok", summary: "read ok" }),
};
const downTool = (
  name: string,
  effect: HarnessTool["effect"],
): HarnessTool => ({
  name,
  effect,
  run: () => ({ status: "failure", code: "unavailable", summary: "down" }),
});
const call = (id: string, name: string, args = "{}") => ({ id, name, args });

type Harness = ReturnType<typeof loopHarness>;

// 모든 행 끝에서 부른다: script를 다 썼고 요청의 불변식이 지켜졌다.
function settle(h: Harness) {
  h.model.finish();
  assertRequestInvariants(h.model.requests);
}

Deno.test("loop의 안전 규칙이 지켜진다", async (t) => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-loop-" });
  try {
    const rows: [string, (root: string) => Promise<void>][] = [
      ["1 기본: 답 하나로 끝난다", async () => {
        const h = loopHarness({ steps: [answer("hi")] });
        const end = await h.run().done;
        settle(h);
        assertEquals(end, completed);
        assertEquals(h.model.requests.length, 1);
        assertEquals(h.answers, ["hi"]);
      }],

      ["2 기본: 읽기 tool 결과가 다음 요청에 실린다", async () => {
        const h = loopHarness({
          steps: [tools([call("t1", "read_file")]), answer("done")],
          tools: [readFile],
        });
        const end = await h.run().done;
        settle(h);
        assertEquals(h.runs.length, 1);
        assertEquals(h.model.lastToolResult(1)?.id, "t1");
        assertEquals([end, h.model.requests.length], [completed, 2]);
      }],

      ["3 불완전한 대답의 tool은 실행하지 않고 잘림을 알린다", async (root) => {
        const h = loopHarness({
          steps: [
            partial({
              calls: [call("t1", "write_file", '{"path":"a.md"}')],
              finish_reason: "max_tokens",
            }),
            answer("ok"),
          ],
          tools: [writeFileTool(root)],
        });
        const end = await h.run().done;
        settle(h);
        const written = await Deno.stat(join(root, "a.md")).then(
          () => true,
          () => false,
        );
        const [first, second] = [h.model.userTexts(0), h.model.userTexts(1)];
        assertEquals([written, h.model.lastToolResult(1), end], [
          false,
          undefined,
          completed,
        ]);
        assertEquals(second.length, first.length + 1);
        assertEquals(second[second.length - 1].includes("max_tokens"), true);
      }],

      ["4 같은 잘림이 세 번 되풀이되면 끝난다", async (root) => {
        const h = loopHarness({
          steps: [
            partial(),
            partial({ calls: [call("t1", "write_file", '{"path":"b.md"}')] }),
            partial(),
          ],
          tools: [writeFileTool(root)],
        });
        const end = await h.run().done;
        settle(h);
        assertEquals(end, failedWith("model_error"));
        assertEquals(
          [
            h.model.requests.length,
            h.runs.length,
            h.finishes[0].facts.unexecuted,
          ],
          [3, 0, []],
        );
      }],

      ["4b 완전한 응답이 오면 잘림 수를 다시 센다", async () => {
        const h = loopHarness({
          steps: [
            partial(),
            partial(),
            tools([call("t1", "read_file")]),
            partial(),
            partial(),
            answer("done"),
          ],
          tools: [readFile],
        });
        const end = await h.run().done;
        settle(h);
        assertEquals([end, h.model.requests.length], [completed, 6]);
      }],

      ["5 응답이 없으면 무진행 한도에서 요청을 끊고 끝난다", async () => {
        const h = loopHarness({ steps: [hang()], limits: { stall_ms: 1000 } });
        const handle = h.run();
        await h.model.arrived(1);
        h.clock.advance(1000);
        h.fireDeadline();
        const end = await handle.done;
        settle(h);
        assertEquals(end, failedWith("stall_limit"));
        assertEquals(h.model.signals[0].aborted, true);
        assertEquals(h.model.requests.length, 1);
      }],

      ["6 멈추면 진행 중인 요청을 끊는다", async () => {
        const h = loopHarness({ steps: [hang()] });
        const handle = h.run();
        await h.model.arrived(1);
        handle.stop("user_stopped");
        const end = await handle.done;
        settle(h);
        assertEquals(end, { kind: "stopped", reason: "user_stopped" });
        assertEquals(h.model.signals[0].aborted, true);
        assertEquals(h.finishes, []);
      }],

      ["7 쓰기 tool은 실패해도 다시 실행하지 않는다", async () => {
        const h = loopHarness({
          steps: [tools([call("t1", "write_file")]), answer("done")],
          tools: [downTool("write_file", "write")],
        });
        const end = await h.run().done;
        settle(h);
        assertEquals([h.runs.length, h.finishes[0].facts.changes, end], [
          1,
          [],
          completed,
        ]);
        assertEquals(h.model.lastToolResult(1)?.id, "t1");
      }],

      ["8 읽기 tool은 실패하면 한 번만 다시 실행한다", async () => {
        const h = loopHarness({
          steps: [tools([call("t1", "read_file")]), answer("done")],
          tools: [downTool("read_file", "read")],
        });
        const end = await h.run().done;
        settle(h);
        assertEquals([h.runs.length, h.waits, end], [2, [1000], completed]);
      }],

      ["9 일시 실패는 같은 입력으로 두 번까지 다시 보낸다", async () => {
        const h = loopHarness({
          steps: [
            failed({ code: "temporary" }),
            failed({ code: "temporary" }),
            answer("ok"),
          ],
        });
        const end = await h.run().done;
        settle(h);
        const requests = h.model.requests;
        assertEquals([end, requests.length, h.waits], [
          completed,
          3,
          [2000, 4000],
        ]);
        assertEquals(requests.map((r) => [r.kind, r.retry_of]), [
          ["initial", null],
          ["retry", "mcl_0"],
          ["retry", "mcl_1"],
        ]);
        assertEquals(
          new Set(requests.map((r) => JSON.stringify(r.prompt))).size,
          1,
        );
      }],

      ["10 일시 실패가 계속되면 세 번째에서 끝난다", async () => {
        const h = loopHarness({
          steps: [
            failed({ code: "temporary" }),
            failed({ code: "temporary" }),
            failed({ code: "temporary" }),
          ],
        });
        const end = await h.run().done;
        settle(h);
        assertEquals([end, h.model.requests.length, h.waits], [
          failedWith("model_error"),
          3,
          [2000, 4000],
        ]);
      }],

      ["11 서버가 준 재시도 시각을 지킨다", async () => {
        const h = loopHarness({
          steps: [
            failed({
              code: "temporary",
              retry_at: formatAt(START_MS + 10_000),
            }),
            answer("ok"),
          ],
        });
        const end = await h.run().done;
        settle(h);
        assertEquals([end, h.model.requests.length, h.waits], [
          completed,
          2,
          [10_000],
        ]);
      }],

      ["12 일시 실패가 아니면 다시 보내지 않고 종류대로 끝난다", async () => {
        const codes = [
          ["credential_unavailable", "configuration_unavailable"],
          ["refused", "model_error"],
          ["context_exceeded", "context_limit"],
          ["unknown", "model_error"],
        ] as const;
        const got = [];
        for (const [code] of codes) {
          const h = loopHarness({ steps: [failed({ code })] });
          const end = await h.run().done;
          settle(h);
          got.push([end, h.model.requests.length, h.waits]);
        }
        assertEquals(
          got,
          codes.map(([, reason]) => [failedWith(reason), 1, []]),
        );
      }],
    ];
    for (const [name, row] of rows) {
      await t.step(name, () => row(dir));
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
