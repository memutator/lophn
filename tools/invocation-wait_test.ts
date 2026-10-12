// R2 직접 통로 정적·빠른 확인(docs/plan/platform.md T52). 기본 check에서
// 돌고(LOPHN_MEASURE 없이) 빠르다: temp SQLite도 큰 파일도 없다. 이 확인은
// packages/platform과 packages/apps 사이 직접 import가 deps 규칙에 걸리므로,
// T52 자리의 tools/에 둔다. apps/runtime entrypoint의 제품 형상을 그대로 쓴다 —
// direct 통로의 invoke가 core·invocation 기록(submit)을 기다리지 않는다
// (invoke.ts "void submit" fire-and-forget). 부하 도중의 실측은
// packages/platform/responsiveness/measure-load_test.ts의 opt-in(R9)이 맡는다.
import { assert } from "@std/assert";
import { handleInvoke } from "../packages/core/apps/runtime/entrypoint/invoke.ts";
import { startRuntime } from "../packages/core/apps/runtime/entrypoint/startup.ts";
import {
  blueprint,
  clockAt,
  connection,
  installHandlers,
  REL,
  shaKey,
  startLine,
} from "../packages/core/apps/runtime/entrypoint/testing.ts";
import type { AppConnection } from "../packages/core/apps/runtime/entrypoint/wire.ts";

Deno.test({
  name:
    "platform/responsiveness#R2: 앱 command가 core·invocation 기록을 기다리지 않는다",
  async fn() {
    let release: (() => void) | undefined;
    const started = startRuntime({
      line: startLine(),
      blueprint: blueprint(),
      key: shaKey(),
      clock: clockAt(),
      ids: { newId: (prefix) => `${prefix}_01h455vb4pex5v6nkc6gd5fdw1` },
      // 30초 이상 멈춘 기록 통로(R2 확인 조건). 응답은 이 완료를 기다리지 않는다.
      broker: () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 503, body: { accepted: false } });
        }),
      dataSchema: 0,
    });
    started.state.accepting = true;
    const user = connection() as AppConnection;
    let handlerRan = false;
    installHandlers([
      {
        command: "usage.save",
        handle: () => {
          handlerRan = true;
          return { saved: true };
        },
      },
    ]);
    const start = performance.now();
    const outcome = await handleInvoke(
      started.state,
      "/_lophn/commands/invoke",
      new TextEncoder().encode(
        JSON.stringify({
          request_key: "wait",
          release: REL,
          command: "usage.save",
        }),
      ),
      user,
    );
    const ms = performance.now() - start;
    assert(outcome.status === 200, `invoke status ${outcome.status}`);
    assert(handlerRan, "handler가 running으로 도는 중이다");
    assert(ms < 1_000, `앱 command가 ${ms}ms에 기록을 기다렸다`);
    release?.();
  },
});
