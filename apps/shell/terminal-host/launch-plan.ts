// shell main이 core로 다시 검사한 LaunchPlan을 host가 PTY로 여는 쪽(shell/terminal#R4, R5, R12, R13).
// plan은 `lophn session plan --json`이 만든 값이다. host는 shell 없이 executable·분리 argv·cwd·env로 열고
// 다른 harness·cwd로 대체하지 않는다. env는 상속 환경에서 platform 값을 빼고 env_delete를 지운 뒤
// env_overlay(안전 값과 `LOPHN_CONNECTION` 참조)를 얹고 env_delete를 한 번 더 적용한 다음
// `LOPHN_TERMINAL_OBSERVE`를 host가 더한다. token 원문은 어디에도 없다.
// main.ts는 이 module을 CodingHost 모양으로만 받는다(node 테스트가 contracts를 읽지 않게).

import {
  acceptObservation,
  type CodingAgentLaunchPlan,
  codingAgentLaunchPlanSchema,
  endedByProcessExit,
  type HarnessSessionObservation,
  harnessSessionObservationSchema,
  LOPHN_TERMINAL_OBSERVE,
  type ObserveEnvelope,
  unknownObservation,
} from "../../../packages/contracts/coding-agent/mod.ts";
import type { PromptOutcome, TerminalFailure } from "../ipc/terminal.ts";
import { stripPlatformEnv } from "./env.ts";
import { createObserveSocket } from "./observe-socket.ts";
import { createPromptDelivery, type PromptTimer } from "./prompt-delivery.ts";

/** host가 main으로 먼저 보내는 줄. 요청의 답이 아니라 id가 없다. */
export type HostEvent = { event: "observation"; envelope: ObserveEnvelope };

export type CodingLaunch = {
  plan: CodingAgentLaunchPlan;
  file: string;
  /** `argv[0]`은 명령 이름이라 빼고 executable에 넘기는 인자다. */
  args: string[];
  cwd: string;
  /** observe 경로를 더하기 전의 환경이다. */
  baseEnv: Record<string, string>;
};

export type PrepareContext = {
  env: Readonly<Record<string, string | undefined>>;
  checkFolder: (
    path: string,
  ) => { ok: true; path: string } | {
    ok: false;
    reason: "not_directory" | "unreadable";
  };
};

export type PrepareResult =
  | { ok: true; launch: CodingLaunch }
  | { ok: false; reason: TerminalFailure; message: string };

export type CodingAttachment = {
  /** socket을 열고 starting 관측을 낸다. 환경에 더할 observe 경로를 돌려준다. */
  begin(): Promise<{ ok: true; env: Record<string, string> } | { ok: false }>;
  /** PTY가 열렸다. 첫 hook 전까지 지금 상태는 unknown이고 prompt 기한이 시작한다. */
  spawned(write: (text: string) => void): void;
  output(chunk: string): void;
  /** 연결된 process exit. ended는 ticket 완료나 claim 해제가 아니다. */
  exited(): void;
  /** 종료를 확인하지 못했거나 수집이 끊겼다. */
  lost(reason: string): void;
  /** spawn 전에 실패했다. socket만 정리한다. */
  abandon(): void;
};

export type CodingHost = {
  prepare(raw: unknown, context: PrepareContext): PrepareResult;
  attach(
    launch: CodingLaunch,
    ref: { runtime_ref: string; generation: number },
    onPrompt: (outcome: PromptOutcome) => void,
  ): CodingAttachment;
};

export type CodingHostDeps = {
  platform: NodeJS.Platform;
  now(): string;
  timer: PromptTimer;
  emit(event: HostEvent): void;
  /** socket 폴더를 만들 곳과 이름. 테스트가 끼운다. */
  socketRoot?: string;
  random?: () => string;
};

function planEnv(
  inherited: Readonly<Record<string, string | undefined>>,
  plan: CodingAgentLaunchPlan,
): Record<string, string> {
  const env = stripPlatformEnv(inherited);
  const remove = () => {
    for (const name of plan.env_delete ?? []) delete env[name];
  };
  remove();
  for (const [name, value] of Object.entries(plan.env_overlay ?? {})) {
    env[name] = value;
  }
  remove();
  return env;
}

function startingObservation(
  plan: CodingAgentLaunchPlan,
  runtimeRef: string,
  now: string,
): HarnessSessionObservation | undefined {
  const parsed = harnessSessionObservationSchema.safeParse({
    harness_id: plan.harness_id,
    environment: plan.environment,
    profile_id: plan.profile_id,
    catalog_revision: plan.catalog_revision,
    adapter_revision: plan.adapter_revision,
    origin: "lophn_terminal",
    runtime_ref: runtimeRef,
    connection: plan.connection,
    ticket: plan.ticket,
    cwd: plan.cwd,
    provider_session: null,
    state: "starting",
    observed_at: now,
    evidence_source: "launch",
    evidence_ref: `launch-${plan.operation_id}`,
    freshness: "fresh",
    reason: null,
  });
  return parsed.success ? parsed.data : undefined;
}

export function createCodingHost(deps: CodingHostDeps): CodingHost {
  return {
    prepare(raw, context) {
      const parsed = codingAgentLaunchPlanSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "spawn_failed",
          message: "launch plan is not valid",
        };
      }
      const plan = parsed.data;
      if (startingObservation(plan, "term_0", deps.now()) === undefined) {
        return {
          ok: false,
          reason: "spawn_failed",
          message: "launch plan cannot be observed",
        };
      }
      // 등록 폴더를 main이 다시 확인했어도 host가 연 순간의 cwd를 한 번 더 본다.
      const checked = context.checkFolder(plan.cwd);
      if (!checked.ok) {
        return {
          ok: false,
          reason: checked.reason,
          message: "registered folder cannot be used",
        };
      }
      return {
        ok: true,
        launch: {
          plan,
          file: plan.executable,
          args: plan.argv.slice(1),
          cwd: checked.path,
          baseEnv: planEnv(context.env, plan),
        },
      };
    },

    attach(launch, ref, onPrompt) {
      const { plan } = launch;
      let current: HarnessSessionObservation | null = null;

      function publish(next: HarnessSessionObservation): void {
        const accepted = acceptObservation(current, next);
        if (accepted === current) return;
        current = accepted;
        deps.emit({
          event: "observation",
          envelope: {
            runtime_ref: ref.runtime_ref,
            generation: ref.generation,
            observation: accepted,
          },
        });
      }

      function unknown(reason: string): void {
        if (current !== null) publish(unknownObservation(current, reason));
      }

      const socket = createObserveSocket({
        platform: deps.platform,
        root: deps.socketRoot,
        random: deps.random,
        runtime_ref: ref.runtime_ref,
        generation: ref.generation,
        // host가 아는 정체를 덧씌운다. payload가 주장한 runtime·connection·ticket·origin은 쓰지 않는다.
        // launch·process 증거는 host만 낸다.
        stamp(payload) {
          if (
            payload.evidence_source === "launch" ||
            payload.evidence_source === "process"
          ) return null;
          return {
            ...payload,
            harness_id: plan.harness_id,
            environment: plan.environment,
            profile_id: plan.profile_id,
            catalog_revision: plan.catalog_revision,
            adapter_revision: plan.adapter_revision,
            origin: "lophn_terminal",
            runtime_ref: ref.runtime_ref,
            connection: plan.connection,
            ticket: plan.ticket,
            cwd: plan.cwd,
          };
        },
        accept(envelope) {
          publish(envelope.observation);
        },
        onLost(reason) {
          unknown(reason);
        },
      });

      let prompt: ReturnType<typeof createPromptDelivery> | undefined;

      return {
        async begin() {
          try {
            await socket.listen();
          } catch {
            socket.close();
            return { ok: false };
          }
          const starting = startingObservation(
            plan,
            ref.runtime_ref,
            deps.now(),
          );
          if (starting === undefined) {
            socket.close();
            return { ok: false };
          }
          publish(starting);
          return {
            ok: true,
            env: { ...launch.baseEnv, [LOPHN_TERMINAL_OBSERVE]: socket.path },
          };
        },
        spawned(write) {
          prompt = createPromptDelivery({
            delivery: plan.prompt_delivery,
            prompt: plan.first_prompt,
            write,
            timer: deps.timer,
            onChange: onPrompt,
          });
          prompt.start();
          // 상태 hook을 검증한 제품이 아직 없다. 첫 hook 전까지는 모른다.
          unknown("첫 상태 관측 전이라 지금 상태를 모른다");
        },
        output(chunk) {
          prompt?.output(chunk);
        },
        exited() {
          if (current !== null) {
            publish(endedByProcessExit(current, deps.now()));
          }
          prompt?.exited();
          socket.close();
        },
        lost(reason) {
          unknown(reason);
          prompt?.exited();
          socket.close();
        },
        abandon() {
          socket.close();
        },
      };
    },
  };
}
