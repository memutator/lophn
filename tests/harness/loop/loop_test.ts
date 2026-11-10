import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

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
import { OMITTED_RESULT } from "../../../packages/core/lophn-agent/run-loop/history.ts";
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

test("loop의 안전 규칙이 지켜진다", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lophn-loop-"));
  try {
    const rows: [string, (root: string) => Promise<void>][] = [
      [
        "1 기본: 답 하나로 끝난다",
        async () => {
          const h = loopHarness({ steps: [answer("hi")] });
          const end = await h.run().done;
          settle(h);
          assert.deepStrictEqual(end, completed);
          assert.deepStrictEqual(h.model.requests.length, 1);
          assert.deepStrictEqual(h.answers, ["hi"]);
        },
      ],

      [
        "2 기본: 읽기 tool 결과가 다음 요청에 실린다",
        async () => {
          const h = loopHarness({
            steps: [tools([call("t1", "read_file")]), answer("done")],
            tools: [readFile],
          });
          const end = await h.run().done;
          settle(h);
          assert.deepStrictEqual(h.runs.length, 1);
          assert.deepStrictEqual(h.model.lastToolResult(1)?.id, "t1");
          assert.deepStrictEqual(
            [end, h.model.requests.length],
            [completed, 2],
          );
        },
      ],

      [
        "3 불완전한 대답의 tool은 실행하지 않고 잘림을 알린다",
        async (root) => {
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
          const written = await stat(join(root, "a.md")).then(
            () => true,
            () => false,
          );
          const [first, second] = [h.model.userTexts(0), h.model.userTexts(1)];
          assert.deepStrictEqual(
            [written, h.model.lastToolResult(1), end],
            [false, undefined, completed],
          );
          assert.deepStrictEqual(second.length, first.length + 1);
          assert.deepStrictEqual(
            second[second.length - 1].includes("max_tokens"),
            true,
          );
        },
      ],

      [
        "4 같은 잘림이 세 번 되풀이되면 끝난다",
        async (root) => {
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
          assert.deepStrictEqual(end, failedWith("model_error"));
          assert.deepStrictEqual(
            [
              h.model.requests.length,
              h.runs.length,
              h.finishes[0].facts.unexecuted,
            ],
            [3, 0, []],
          );
        },
      ],

      [
        "4b 완전한 응답이 오면 잘림 수를 다시 센다",
        async () => {
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
          assert.deepStrictEqual(
            [end, h.model.requests.length],
            [completed, 6],
          );
        },
      ],

      [
        "5 응답이 없으면 무진행 한도에서 요청을 끊고 끝난다",
        async () => {
          const h = loopHarness({
            steps: [hang()],
            limits: { stall_ms: 1000 },
          });
          const handle = h.run();
          await h.model.arrived(1);
          h.clock.advance(1000);
          h.fireDeadline();
          const end = await handle.done;
          settle(h);
          assert.deepStrictEqual(end, failedWith("stall_limit"));
          assert.deepStrictEqual(h.model.signals[0].aborted, true);
          assert.deepStrictEqual(h.model.requests.length, 1);
        },
      ],

      [
        "6 멈추면 진행 중인 요청을 끊는다",
        async () => {
          const h = loopHarness({ steps: [hang()] });
          const handle = h.run();
          await h.model.arrived(1);
          handle.stop("user_stopped");
          const end = await handle.done;
          settle(h);
          assert.deepStrictEqual(end, {
            kind: "stopped",
            reason: "user_stopped",
          });
          assert.deepStrictEqual(h.model.signals[0].aborted, true);
          assert.deepStrictEqual(h.finishes, []);
        },
      ],

      [
        "7 쓰기 tool은 실패해도 다시 실행하지 않는다",
        async () => {
          const h = loopHarness({
            steps: [tools([call("t1", "write_file")]), answer("done")],
            tools: [downTool("write_file", "write")],
          });
          const end = await h.run().done;
          settle(h);
          assert.deepStrictEqual(
            [h.runs.length, h.finishes[0].facts.changes, end],
            [1, [], completed],
          );
          assert.deepStrictEqual(h.model.lastToolResult(1)?.id, "t1");
        },
      ],

      [
        "8 읽기 tool은 실패하면 한 번만 다시 실행한다",
        async () => {
          const h = loopHarness({
            steps: [tools([call("t1", "read_file")]), answer("done")],
            tools: [downTool("read_file", "read")],
          });
          const end = await h.run().done;
          settle(h);
          assert.deepStrictEqual(
            [h.runs.length, h.waits, end],
            [2, [1000], completed],
          );
        },
      ],

      [
        "8b lophn으로 부른 쓰기 명령도 쓰기로 다뤄 다시 실행하지 않고 읽기와 병렬로 돌지 않는다",
        async () => {
          const wrapped = (id: string, args: string[]) =>
            call(id, "lophn", JSON.stringify({ args }));
          const order: string[] = [];
          const slowRead: HarnessTool = {
            name: "job_list",
            effect: "read",
            async run() {
              // 병렬이면 이 사이에 쓰기가 먼저 끝난다.
              const { promise, resolve } = Promise.withResolvers<void>();
              setTimeout(resolve, 5);
              await promise;
              order.push("read");
              return { status: "success", code: "ok", summary: "read ok" };
            },
          };
          const write: HarnessTool = {
            name: "job_delete",
            effect: "write",
            run() {
              order.push("write");
              return {
                status: "failure",
                code: "unavailable",
                summary: "down",
              };
            },
          };
          const h = loopHarness({
            steps: [
              tools([
                wrapped("t1", ["job", "list"]),
                wrapped("t2", [
                  "job",
                  "delete",
                  "job_00000000000000000000000001",
                ]),
              ]),
              answer("done"),
            ],
            tools: [slowRead, write],
          });
          const end = await h.run().done;
          settle(h);
          // 읽기가 끝난 뒤 쓰기가 한 번만 돈다. 병렬이면 쓰기가 먼저 끝나고, retry면 두 번 돈다.
          assert.deepStrictEqual(
            [order, h.waits, end],
            [["read", "write"], [], completed],
          );
          // 이력의 tool_use는 model이 보낸 lophn 그대로다.
          const uses = h.model.requests[1].prompt.request.messages.flatMap(
            (message) =>
              message.parts.flatMap((part) =>
                part.kind === "tool_use" ? [part.name] : [],
              ),
          );
          assert.deepStrictEqual(uses, ["lophn", "lophn"]);
        },
      ],

      [
        "9 일시 실패는 같은 입력으로 두 번까지 다시 보낸다",
        async () => {
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
          assert.deepStrictEqual(
            [end, requests.length, h.waits],
            [completed, 3, [2000, 4000]],
          );
          assert.deepStrictEqual(
            requests.map((r) => [r.kind, r.retry_of]),
            [
              ["initial", null],
              ["retry", "mcl_0"],
              ["retry", "mcl_1"],
            ],
          );
          assert.deepStrictEqual(
            new Set(requests.map((r) => JSON.stringify(r.prompt))).size,
            1,
          );
        },
      ],

      [
        "10 일시 실패가 계속되면 세 번째에서 끝난다",
        async () => {
          const h = loopHarness({
            steps: [
              failed({ code: "temporary" }),
              failed({ code: "temporary" }),
              failed({ code: "temporary" }),
            ],
          });
          const end = await h.run().done;
          settle(h);
          assert.deepStrictEqual(
            [end, h.model.requests.length, h.waits],
            [failedWith("model_error"), 3, [2000, 4000]],
          );
        },
      ],

      [
        "11 서버가 준 재시도 시각을 지킨다",
        async () => {
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
          assert.deepStrictEqual(
            [end, h.model.requests.length, h.waits],
            [completed, 2, [10_000]],
          );
        },
      ],

      [
        "12a 입력이 너무 크다는 거절은 오래된 tool 결과를 줄여 다시 보내고, 줄일 것이 없으면 끝낸다",
        async () => {
          const bigRead: HarnessTool = {
            name: "read_file",
            effect: "read",
            run: () => ({
              status: "success",
              code: "ok",
              summary: "x".repeat(3000),
            }),
          };
          const h = loopHarness({
            steps: [
              tools([call("t1", "read_file")]),
              tools([call("t2", "read_file")]),
              tools([call("t3", "read_file")]),
              failed({ code: "context_exceeded" }),
              answer("ok"),
            ],
            tools: [bigRead],
          });
          const handle = h.run();
          const end = await handle.done;
          settle(h);
          const results = (i: number) =>
            h.model.requests[i].prompt.request.messages.flatMap((message) =>
              message.parts.flatMap((part) =>
                part.kind === "tool_result"
                  ? [part.text === OMITTED_RESULT ? "omitted" : part.id]
                  : [],
              ),
            );
          assert.deepStrictEqual(
            [end, h.model.requests.length, results(3), results(4)],
            [completed, 5, ["t1", "t2", "t3"], ["omitted", "t2", "t3"]],
          );
          // 이전 대화가 작으니 다음 turn 전에 Compact하지 않는다.
          assert.deepStrictEqual(handle.compactNext(), false);

          const bare = loopHarness({
            steps: [failed({ code: "context_exceeded" })],
          });
          const bareHandle = bare.run();
          assert.deepStrictEqual(
            await bareHandle.done,
            failedWith("context_limit"),
          );
          settle(bare);
          // turn 안에서 줄일 것이 없으면 다음 turn 전에 이전 대화를 Compact한다.
          assert.deepStrictEqual(bareHandle.compactNext(), true);
        },
      ],

      [
        "12b turn 안 Compact 뒤 같은 turn이 요약과 덮은 끝 뒤의 대화로 이어 가고, Compact가 실패하면 tool 결과를 줄여 이어 간다",
        async () => {
          const bigRead: HarnessTool = {
            name: "read_file",
            effect: "read",
            run: () => ({
              status: "success",
              code: "ok",
              summary: "x".repeat(3000),
            }),
          };
          const steps = [
            tools([call("t1", "read_file")]),
            tools([call("t2", "read_file")]),
            tools([call("t3", "read_file")]),
            failed({ code: "context_exceeded" }),
            answer("ok"),
          ];
          const resultIds = (h: Harness, i: number) =>
            h.model.requests[i].prompt.request.messages.flatMap((message) =>
              message.parts.flatMap((part) =>
                part.kind === "tool_result"
                  ? [part.text === OMITTED_RESULT ? "omitted" : part.id]
                  : [],
              ),
            );

          const compacted = loopHarness({
            steps,
            tools: [bigRead],
            compact: {
              outcome: "compacted",
              after: {
                compaction: { through_seq: 5n, text: "SUMMARY-OF-PROGRESS" },
                messages: [],
              },
            },
          });
          const end = await compacted.run().done;
          compacted.model.finish();
          // 덮인 turn 안 tool 결과는 다시 실리지 않고 요약과 이 turn의 요청이 대신한다.
          assert.deepStrictEqual(
            [
              end,
              compacted.compactions,
              resultIds(compacted, 3),
              resultIds(compacted, 4),
              compacted.model
                .userTexts(4)
                .some((text) => text.includes("SUMMARY-OF-PROGRESS")),
              compacted.model.userTexts(4).includes("go"),
            ],
            // 넘긴 이력은 맨 앞 날짜 notice와 tool 세 번의 호출·결과다.
            [completed, [7], ["t1", "t2", "t3"], [], true, true],
          );

          const failedCompact = loopHarness({
            steps,
            tools: [bigRead],
            compact: {
              outcome: "failed",
              after: { compaction: null, messages: [] },
            },
          });
          const failedEnd = await failedCompact.run().done;
          settle(failedCompact);
          // 요약이 실패해도 turn은 끝나지 않고 오래된 tool 결과를 줄여 이어 간다.
          assert.deepStrictEqual(
            [failedEnd, failedCompact.compactions, resultIds(failedCompact, 4)],
            [completed, [7], ["omitted", "t2", "t3"]],
          );
        },
      ],

      [
        "12 일시 실패가 아니면 다시 보내지 않고 종류대로 끝난다",
        async () => {
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
          assert.deepStrictEqual(
            got,
            codes.map(([, reason]) => [failedWith(reason), 1, []]),
          );
        },
      ],
    ];
    for (const [name, row] of rows) {
      await t.test(name, () => row(dir));
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});
