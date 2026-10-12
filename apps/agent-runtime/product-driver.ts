import {
  createIdSource,
  cryptoRandom,
  err,
  type IdSource,
  ok,
  systemClock,
} from "../../packages/base/mod.ts";
import { ALL_ROUTES } from "../../packages/protocol/mod.ts";
import { instructionRead } from "../../packages/protocol/lophn-agent/mod.ts";
import { instructionFilesOverCore } from "../../packages/core/lophn-agent/instructions/mod.ts";
import { abortableWait } from "../../packages/core/lophn-agent/run-loop/mod.ts";
import { spawnStdioMcp } from "../../packages/core/lophn-agent/extensions/mod.ts";
import type { McpConnectionsDeps } from "../../packages/core/lophn-agent/extensions/mod.ts";
import type { CoreCalls } from "./main.ts";
import { createMcpToolkit } from "./mcp-toolkit.ts";
import { createRunPreparer, type Toolkit } from "./prepare.ts";
import { type CoreCall, readOf } from "./core-call.ts";
import { type Compactor, createCompactor } from "./compact.ts";
import { createModelResolver } from "./resolve-model.ts";
import { PRODUCT_INSTRUCTIONS, rolePrompt } from "./role-prompts.ts";
import type { ProviderWatch } from "./provider-watch.ts";
import type { RunDriver } from "./run-driver.ts";
import type { DriveDeps } from "./run-driver.ts";
import { createAppToolkit } from "./app-toolkit.ts";
import { productSkillStores, registeredSkillEntries } from "./skill-folders.ts";
import { createBuiltinToolkit } from "./toolkit.ts";

// 제품 runtime의 tool 묶음이다. 내장 tool의 정의·handler·소유 계약 연결(쓰기는 입력에서 정확한 대상을
// 읽는 `builtinBinding`)과 외부 MCP 등록 통로를 한 곳에서 낸다. 시험도 같은 묶음을 쓴다.
export function productToolkit(options: {
  machine: CoreCall;
  ids: IdSource;
  mcp?: Toolkit["mcp"];
}): Toolkit {
  return {
    ...createBuiltinToolkit({
      routes: ALL_ROUTES,
      machine: options.machine,
      ids: options.ids,
    }),
    ...(options.mcp === undefined ? {} : { mcp: options.mcp }),
  };
}

// 제품 runtime의 driver 재료(lophn-agent/harness/run-loop). core 연결을 받아 run 시작 재료, 복구 재료,
// 기본 harness 묶음(내장 tool, 역할 prompt, model 선택 검증, 등록 skill 폴더)을 만든다. 아래는 소유
// 작업이 채울 자리라 비어 있다: 쓰기·external tool의 결과 조회(`lookups`).
export function productDriver(options: { fetch?: typeof fetch } = {}) {
  return (
    calls: CoreCalls,
  ):
    & Pick<
      DriveDeps,
      "prepare" | "closeUnusable" | "liveRuns" | "prepareResume"
    >
    & { compactor: Compactor } => {
    const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
    const resolveModel = createModelResolver({
      machine: calls.machine,
      ...(calls.secrets === undefined ? {} : { attach: calls.secrets }),
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
    });
    // 외부 MCP 연결과 등록 통로다(Q16, T37). 프로세스 수명의 상태는 entry에서
    // 만들어 넘기므로(architecture) productDriver 호출마다 하나를 만든다.
    const mcpKit = createMcpToolkit({
      machine: calls.machine,
      connections: mcpConnectionsDeps(calls.secrets),
    });
    const prepared = createRunPreparer({
      clock: systemClock,
      ids,
      machine: calls.machine,
      agentCall: calls.agentCall,
      blobs: calls.blobs,
      resolveModel,
      toolkit: productToolkit({
        machine: calls.machine,
        ids,
        // 외부 MCP tool 등록 통로다(Q16, T37). 등록·재조회는 mcp-toolkit이 소유한다.
        mcp: (assignment: string) => mcpKit.toolkit(assignment),
      }),
      // 앱 command 선언·허락 읽기와 앱 통로 호출, 결과 조회(lophn-agent/harness/tools R16).
      apps: createAppToolkit({ machine: calls.machine }),
      product: PRODUCT_INSTRUCTIONS,
      rolePrompt,
      instructions: {
        // run 없이는 읽지 않는다. 실제 읽기는 아래 instructionFilesFor가 run마다 연다.
        files: {
          read: () =>
            Promise.resolve(
              err({ code: "unavailable", message: "no run for instructions" }),
            ),
        },
        redact: calls.redact,
      },
      // LOPHN.md와 agent 정의 본문은 core의 ReadInstructionFile로 그 run의 이름으로 매 call 직전에 읽는다
      // (instructions R4, R5, R8). core가 run의 작업 자리로 어느 파일인지 정한다.
      instructionFilesFor: (run) =>
        instructionFilesOverCore(
          run,
          (input) => readOf(calls.machine, instructionRead, input),
        ),
      redact: calls.redact,
      // 그 agent 자리의 skill 폴더와 등록한 skill 폴더만 검사한다(extensions R1, R32). 설정이 없으면 빈 목록이다.
      skills: (place) =>
        registeredSkillEntries(calls.machine, productSkillStores(place)),
    });
    // 사람이 요청한 Compact의 요약 call이다. 같은 model 선택 검증과 core 연결을 쓴다.
    const compactor = createCompactor({
      clock: systemClock,
      ids,
      machine: calls.machine,
      blobs: calls.blobs,
      redact: calls.redact,
      resolveModel,
    });
    return { ...prepared, compactor };
  };
}

// 접수된 run을 계속 시작한다(selector → beginRun → loop → end). 시작할 run이 없으면 쉬고, 사람의 결정을
// 기다리는 run은 같은 길로 이어 간다. 쉬는 동안에도 core read로만 본다.
export const PUMP_IDLE_MS = 500;
export const PUMP_WAITING_MS = 2_000;

// 제품 MCP 연결 눈이다(Q16, T37). 실제 stdio process를 열고(spawnStdioMcp) 단조
// deadline timer를 쓴다. 테스트는 fake child·fake fetch를 끼운다.
export function mcpConnectionsDeps(
  secrets?: McpConnectionsDeps["secrets"],
): McpConnectionsDeps {
  return {
    nowMs: () => Date.now(),
    wait: abortableWait,
    deadline: (ms, signal) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve("elapsed");
        }, ms);
        function onAbort() {
          clearTimeout(timer);
          resolve("aborted");
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    // HTTP MCP는 core가 child 권한에 더한 등록 server의 정확한 host:port로만 닿는다.
    fetch: (url, init) => fetch(url, init),
    // bearer·api_key·secret_ref 헤더의 값은 core가 감독 pipe로 요청마다 한 번 건넨다(R17).
    ...(secrets === undefined ? {} : { secrets }),
    openStdio: (_server, input, signal) => {
      void signal;
      return Promise.resolve(spawnStdioMcp(input));
    },
  };
}

export function startRunPump(options: {
  driver: RunDriver;
  liveRuns?: DriveDeps["liveRuns"];
  // 사람이 요청한 Compact와 "Summarize from here"의 요약을 한 번에 하나씩 끝낸다. run을 시작하는 길과 따로 돈다.
  compactor?: Compactor;
  // Disconnect한 provider로 진행 중인 run을 멈추게 하는 알림을 매 주기 훑는다.
  providerWatch?: Pick<ProviderWatch, "poll">;
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
        await options.providerWatch?.poll();
      } catch {
        // 알림을 읽지 못해도 pump는 계속 돈다. 위치를 옮기지 않았으므로 다음 주기에 같은 알림을 다시 본다.
      }
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
      try {
        const compacted = await options.compactor?.next();
        if (compacted !== undefined && compacted.kind !== "idle") {
          started = true;
        }
      } catch {
        // 요약 한 번의 실패도 pump를 끝내지 않는다. 요청은 core에 열려 있어 다음 주기에 다시 본다.
      }
      try {
        const summarized = await options.compactor?.nextRange();
        if (summarized !== undefined && summarized.kind !== "idle") {
          started = true;
        }
      } catch {
        // 요약 한 번의 실패도 pump를 끝내지 않는다. 사람이 다시 요청하면 새 요청으로 온다.
      }
      if (!started) await abortableWait(idleMs, options.signal);
    }
  })();
}
