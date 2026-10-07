// 앱 단계가 있는 revert의 이어 실행(lophn-agent#T48, R10·R11). 사람이 확인한 RevertRun은 앱 단계가 있으면
// applying으로 접수만 한다. 사람의 shell(revert 창)이 접수 뒤 `RunAppRevert`를 부르면 core가 그 revert를
// 이어 받는다.
//   - 앱의 revert command 호출은 호출한 사람의 자격으로 한다(그 사람의 `apps/connect` 연결과 앱 direct
//     socket). agent.commands grant를 복원 권한으로 쓰지 않는다.
//   - 단계 기록(`CheckpointRevert`)과 끝내기(`FinishRevert`)는 core 내부 machine 자격이다. 사람 token이
//     이 command를 직접 부르지 못한다.
// 순서 규칙(applying일 때만, 원래 호출 역순, 기록한 단계 건너뜀, 앞 단계가 복원되지 않으면 멈춤)은
// lophn-agent/revert의 runAppSteps가 맡는다. 네트워크 호출은 writer transaction 밖이다.
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  type AppRevertBinding,
  checkpointRevert,
  finishRevert,
  type runAppRevert,
} from "../../packages/contracts/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  RequestContext,
} from "../../packages/contracts/platform/mod.ts";
import type { OperationPolicy } from "../../packages/platform/identity/mod.ts";
import { openConnection } from "../../packages/platform/ledger/mod.ts";
import type { MemoryHandler } from "../../packages/platform/api/mod.ts";
import {
  type CoreCall,
  createRuntimeClient,
  type DirectTransport,
} from "../../packages/apps/runtime/client/mod.ts";
import {
  type AppStepPorts,
  type AppStepResult,
  runAppSteps,
} from "../../packages/lophn-agent/revert/mod.ts";
import type { z } from "zod";

export const APP_REVERT_PRINCIPAL = "machine:app-revert";

// 단계 기록과 끝내기만 하는 core 내부 machine 자격이다. token이 없어 HTTP로는 이 principal이 될 수 없다.
export const APP_REVERT_CONTEXT: RequestContext = {
  principal: APP_REVERT_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [checkpointRevert.name, finishRevert.name],
    targets: {},
  },
  conditions: {},
  credential_ref: APP_REVERT_PRINCIPAL,
};

export function appRevertPolicies(): OperationPolicy[] {
  return [checkpointRevert.name, finishRevert.name].map((
    name,
  ): OperationPolicy => ({ name, actors: ["machine"], kind: "command" }));
}

type Envelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: string[];
};

// 호출한 사람의 자격으로 앱의 revert command를 한 번 직접 부른다.
export type AppRevertCaller = (
  binding: AppRevertBinding,
) => Promise<AppStepResult>;

const PLACEHOLDER_SCREEN = "main";

// 제품의 호출자. 사람의 `apps/connect` 연결을 받아 연결이 고정한 release가 단계의 release와 같을 때만
// request_key=step_key로 보낸다(앱이 같은 key의 재전송에 같은 결과를 돌려주므로 중복 실행되지 않는다).
// 앱에 닿지 못했으면 failure, 앱이 conflict로 거절했으면 conflict, 보낸 뒤 응답을 잃었으면 uncertain이다.
export function runtimeAppCaller(options: {
  connect: CoreCall;
  direct?: DirectTransport;
}): AppRevertCaller {
  const client = createRuntimeClient({
    core: { call: options.connect },
    ...(options.direct === undefined ? {} : { direct: options.direct }),
  });
  const notSent: AppStepResult = { result: "failure", invocation: null };
  return async (binding) => {
    const session = await client.connect({
      app: binding.app,
      mode: "live",
      screens: [PLACEHOLDER_SCREEN],
      screen_sizes: {},
      commands: [binding.revert_command],
    });
    if (!session.ok) return notSent;
    // 원래 write의 release와 다른 release에는 되돌림 근거가 통하지 않는다.
    if (session.value.connection.release !== binding.release) return notSent;
    const sent = await session.value.invoke({
      command: binding.revert_command,
      input: {
        invocation: binding.invocation,
        receipt: binding.receipt,
        expected_revision: binding.expected_revision,
      },
      request_key: binding.step_key,
    });
    if (!sent.ok) {
      return {
        result: sent.error.code === "conflict" ? "conflict" : "failure",
        invocation: null,
      };
    }
    if (sent.value.kind === "unknown") {
      return { result: "uncertain", invocation: null };
    }
    const invocation = sent.value.output.invocation;
    // 실제 Invocation 없이 복원했다고 기록하지 않는다.
    return invocation === undefined
      ? { result: "uncertain", invocation: null }
      : { result: "restored", invocation };
  };
}

export type AppRevertDeps = {
  ledgerPath: string;
  // 호출한 사람의 자격으로 앱을 부르는 호출자를 만든다.
  caller(ctx: AuthenticatedContext): AppRevertCaller;
  // writer로 command를 낸다. core 조립이 늦게 채우므로 호출 때 읽는다.
  command(
    ctx: RequestContext,
    envelope: Envelope,
  ): Promise<Result<unknown>> | undefined;
  machine(): RequestContext | undefined;
};

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

// 저장한 revert와 그 앱 단계. 읽기만 한다.
function readStored(
  ledgerPath: string,
  revert: string,
): Result<{
  outcome: string;
  steps: { binding: AppRevertBinding; result: string }[];
}> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return unavailable("ledger is unavailable");
  try {
    const header = opened.value.sql.get(
      "select outcome from reverts where id = ?",
      [revert],
    );
    if (header === undefined) {
      return err({ code: "not_found", message: "revert not found" });
    }
    const rows = opened.value.sql.all(
      `select result, app_revert from revert_changes
        where revert = ? and app_revert is not null order by ordinal`,
      [revert],
    );
    return ok({
      outcome: String(header["outcome"]),
      steps: rows.map((row) => ({
        binding: JSON.parse(String(row["app_revert"])) as AppRevertBinding,
        result: String(row["result"]),
      })),
    });
  } catch {
    return unavailable("ledger is unavailable");
  } finally {
    opened.value.close();
  }
}

export function createAppRevert(deps: AppRevertDeps): MemoryHandler {
  return async (ctx, value) => {
    const input = value as z.infer<typeof runAppRevert.input>;
    const machine = deps.machine();
    if (machine === undefined) return unavailable("app revert is unavailable");
    const send = (envelope: Envelope) => {
      const sent = deps.command(machine, envelope);
      return sent === undefined
        ? Promise.resolve(unavailable("app revert is unavailable"))
        : sent;
    };
    const ports: AppStepPorts = {
      stored: (revert) => Promise.resolve(readStored(deps.ledgerPath, revert)),
      call: deps.caller(ctx),
      checkpoint: (step) =>
        send({
          command: checkpointRevert.name,
          input: step,
          idempotency_key: `app-revert:${step.step_key}`,
          compare: {},
          prepared: [],
        }),
      finish: async (done) => {
        // 끝내기가 ledger owner의 거절로 취소되면 ledger 묶음 없이 다시 끝내 앱 결과만 확정한다.
        if (input.groups !== undefined) {
          const full = await send({
            command: finishRevert.name,
            input: { ...done, groups: input.groups },
            idempotency_key: `app-revert:${done.revert}:finish:full`,
            compare: {},
            prepared: [],
          });
          if (full.ok || full.error.code !== "conflict") return full;
        }
        return await send({
          command: finishRevert.name,
          input: done,
          idempotency_key: `app-revert:${done.revert}:finish`,
          compare: {},
          prepared: [],
        });
      },
    };
    const ran = await runAppSteps(ports, input.revert);
    if (!ran.ok) return ran;
    const after = readStored(deps.ledgerPath, input.revert);
    if (!after.ok) return after;
    return ok({
      revert: input.revert,
      outcome: after.value.outcome,
      called: ran.value.called,
    });
  };
}
