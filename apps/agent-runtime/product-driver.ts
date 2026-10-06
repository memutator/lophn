import {
  createIdSource,
  cryptoRandom,
  err,
  ok,
  systemClock,
} from "../../packages/base/mod.ts";
import { ALL_ROUTES } from "../../packages/contracts/mod.ts";
import { abortableWait } from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import type { CoreCalls } from "./main.ts";
import { createRunPreparer } from "./prepare.ts";
import { createModelResolver } from "./resolve-model.ts";
import { PRODUCT_INSTRUCTIONS, rolePrompt } from "./role-prompts.ts";
import type { RunDriver } from "./run-driver.ts";
import type { DriveDeps } from "./run-driver.ts";
import { createBuiltinToolkit } from "./toolkit.ts";

// 제품 runtime의 driver 재료(lophn-agent/harness/run-loop). core 연결을 받아 run 시작 재료, 복구 재료,
// 기본 harness 묶음(내장 tool, 역할 prompt, model 선택 검증)을 만든다. 아래는 소유 작업이 채울 자리라
// 비어 있다: 쓰기·external tool의 소유 계약 연결(`binding`)과 결과 조회(`lookups`), 앱 command 선언(`offers`),
// skill·MCP·material source, 사람 지침 파일 읽기(`InstructionFiles`).
export function productDriver(options: { fetch?: typeof fetch } = {}) {
  return (
    calls: CoreCalls,
  ): Pick<
    DriveDeps,
    "prepare" | "closeUnusable" | "liveRuns" | "prepareResume"
  > => {
    const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
    return createRunPreparer({
      clock: systemClock,
      ids,
      machine: calls.machine,
      agentCall: calls.agentCall,
      blobs: calls.blobs,
      resolveModel: createModelResolver({
        machine: calls.machine,
        catalog: async () => {
          if (calls.catalog === undefined) {
            return err({
              code: "unavailable",
              message: "the model catalog is not available",
            });
          }
          const loaded = await calls.catalog.load();
          return loaded.ok ? ok(loaded.value.entries) : loaded;
        },
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      }),
      toolkit: createBuiltinToolkit({
        routes: ALL_ROUTES,
        machine: calls.machine,
        ids,
      }),
      product: PRODUCT_INSTRUCTIONS,
      rolePrompt,
      instructions: {
        files: {
          registered: () => Promise.resolve(ok(null)),
          attached: () =>
            Promise.resolve(
              err({ code: "unavailable", message: "no instruction files" }),
            ),
          projectOf: () => Promise.resolve(ok(null)),
        },
        redact: calls.redact,
      },
      redact: calls.redact,
    });
  };
}

// 접수된 run을 계속 시작한다(selector → beginRun → loop → end). 시작할 run이 없으면 쉬고, 사람의 결정을
// 기다리는 run은 같은 길로 이어 간다. 쉬는 동안에도 core read로만 본다.
export const PUMP_IDLE_MS = 500;
export const PUMP_WAITING_MS = 2_000;

export function startRunPump(options: {
  driver: RunDriver;
  liveRuns?: DriveDeps["liveRuns"];
  signal: AbortSignal;
  idleMs?: number;
  waitingMs?: number;
}): Promise<void> {
  const idleMs = options.idleMs ?? PUMP_IDLE_MS;
  const waitingMs = options.waitingMs ?? PUMP_WAITING_MS;
  return (async () => {
    let lastWaiting = 0;
    while (!options.signal.aborted) {
      let started = false;
      try {
        const next = await options.driver.startNext();
        started = next.kind === "started" || next.kind === "not_started";
        if (
          options.liveRuns !== undefined &&
          Date.now() - lastWaiting >= waitingMs
        ) {
          lastWaiting = Date.now();
          const live = await options.liveRuns();
          if (live.ok) {
            for (const entry of live.value) {
              if (entry.state === "waiting_user") {
                void options.driver.resume(entry.run).catch(() => {});
              }
            }
          }
        }
      } catch {
        // 한 번의 실패가 pump를 끝내지 않는다. 다음 주기에 다시 본다.
      }
      if (!started) await abortableWait(idleMs, options.signal);
    }
  })();
}
