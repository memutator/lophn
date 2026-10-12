// 앱 단계가 있는 rewind의 이어 실행(lophn-agent/revert 앱 복원 실행 경계). 사람이 확인한
// Rewind는 앱 단계가 있으면 applying으로 접수만 한다. rewind 창이 접수 뒤 `RunAppRevert`를 부르면 core가
// 그 revert를 이어 받는다.
//   - 실제 복원 호출(사람의 `apps/connect` 연결과 앱 direct socket으로 앱 command 보내기)은 감독 worker
//     `apps/revert`(packages/core/apps/revert/worker/run.ts)가 한다. core는 호출자의 credential을 호출 요청에 실어 보내고
//     worker가 돌려준 결과를 받아 판정한다. agent.commands grant를 복원 권한으로 쓰지 않는다.
//   - 단계 기록(`CheckpointRevert`)과 끝내기(`FinishRevert`)는 core 내부 machine 자격이다. 사람 token이
//     이 command를 직접 부르지 못한다.
//   - 문서 파일은 앱 단계가 모두 복원된 뒤에 관측 → 판정 → 준비 → FinishRevert → 설치(→ 건너뛴 경로가
//     있으면 AmendRevertInstall) 순서로 복원한다(rewind-files.ts와 같은 순서).
// 순서 규칙(applying일 때만, 원래 호출 역순, 기록한 단계 건너뜀, 앞 단계가 복원되지 않으면 멈춤)은
// lophn-agent/revert의 runAppSteps가 맡는다. 네트워크 호출은 writer transaction 밖이다.
import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import {
  type AppRevertBinding,
  checkpointRevert,
  finishRevert,
  type runAppRevert,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import {
  type AppStepPorts,
  type AppStepResult,
  installRestore,
  runAppSteps,
  type StoredStep,
} from "../../lophn-agent/session/rewind/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import type {
  CommandEnvelope,
  CommandSuccess,
  Writer,
} from "../../storage/ledger/mod.ts";
import type { z } from "zod";
import {
  amendInstalled,
  type PreparedRewind,
  prepareRewind,
  type RewindFilesDeps,
} from "../../lophn-agent/session/rewind/files.ts";

export const APP_REVERT_PRINCIPAL = "machine:app-revert";

// 단계 기록과 끝내기만 하는 core 내부 machine 자격이다. token이 없어 HTTP로는 이 principal이 될 수 없고
// ledger credential 기록으로만 writer가 현재 자격을 본다.
export const APP_REVERT_CONTEXT: AuthenticatedContext = {
  principal: APP_REVERT_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [checkpointRevert.name, finishRevert.name],
    targets: {},
  },
  conditions: {},
  credential_ref: APP_REVERT_PRINCIPAL,
};

// 저장한 revert 단계 하나의 실제 호출이다. 감독 worker(apps/revert)가 호출자의 credential과
// 단계 근거를 받아 앱의 revert command를 부른다(workerAppCaller가 이 모양을 만든다).
export type AppRevertCaller = (
  binding: AppRevertBinding,
) => Promise<AppStepResult>;

export type AppRevertDeps =
  & Pick<RewindFilesDeps, "snapshot" | "rootOf" | "store" | "answeredFacts">
  & {
    // 호출자의 credential로 앱을 부르는 호출자를 만든다. 실제 호출은 감독 worker(apps/revert)가 한다.
    caller(
      ctx: AuthenticatedContext,
      credential: string | undefined,
    ): AppRevertCaller;
    // writer는 core 조립이 늦게 채우므로 호출 때 읽는다.
    writer(): Writer | undefined;
  };

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

type Stored = {
  outcome: string;
  session: string;
  checkpoint: string;
  steps: StoredStep[];
};

// 저장한 revert와 그 앱 단계를 원래 호출 순서(ordinal의 역순)로 읽는다.
function readStored(
  deps: Pick<AppRevertDeps, "snapshot">,
  revert: string,
): Result<Stored> {
  const read = deps.snapshot((lookup) => {
    const header = lookup.sql.get(
      "select session, checkpoint, outcome from reverts where id = ?",
      [revert],
    );
    if (header === undefined) return null;
    const rows = lookup.sql.all(
      `select app_revert, result from revert_items
        where revert = ? and class = 'app' and plan = 'restore' order by ordinal desc`,
      [revert],
    );
    return {
      outcome: String(header["outcome"]),
      session: String(header["session"]),
      checkpoint: String(header["checkpoint"]),
      steps: rows.map((row): StoredStep => ({
        binding: JSON.parse(String(row["app_revert"])) as AppRevertBinding,
        result: String(row["result"]) as StoredStep["result"],
      })),
    };
  });
  if (!read.ok) return read;
  return read.value === null
    ? err({ code: "not_found", message: "revert not found" })
    : ok(read.value);
}

export function createAppRevert(deps: AppRevertDeps): MemoryHandler {
  return async (ctx, value, credential) => {
    const input = value as z.infer<typeof runAppRevert.input>;
    const writer = deps.writer();
    if (writer === undefined) return unavailable("app revert is unavailable");
    const send = (
      envelope: CommandEnvelope,
    ): Promise<Result<CommandSuccess>> =>
      writer.command(APP_REVERT_CONTEXT, envelope);
    // 앱 단계가 모두 복원됐을 때 준비한 문서 파일. 끝낸 revert가 applied이면 설치한다.
    let held: PreparedRewind | null = null;
    const ports: AppStepPorts = {
      stored: (revert) => Promise.resolve(readStored(deps, revert)),
      call: deps.caller(ctx, credential),
      checkpoint: (step) =>
        send({
          command: checkpointRevert.name,
          input: step,
          idempotency_key: `app-revert:${step.step_key}`,
          compare: {},
          prepared: [],
        }),
      prepareFiles: async (revert) => {
        const stored = readStored(deps, revert);
        if (!stored.ok) return stored;
        const prepared = await prepareRewind(deps, {
          kind: "rewind",
          session: stored.value.session,
          checkpoint: stored.value.checkpoint,
          choice: "restore_all",
        }, false);
        if (!prepared.ok) return prepared;
        held = prepared.value;
        return ok(prepared.value?.files ?? []);
      },
      finish: async (done) => {
        const finishInput = { ...done };
        // 다시 불렀을 때 파일 관측이 달라져도 같은 key의 다른 입력으로 거절되지 않게 입력을 key에 싣는다.
        const digest = createHash("sha256").update(canonicalize(finishInput))
          .digest("hex").slice(0, 16);
        const sent = await send({
          command: finishRevert.name,
          input: finishInput,
          idempotency_key: `app-revert:${done.revert}:finish:${digest}`,
          compare: {},
          prepared: [],
        });
        if (!sent.ok) return sent;
        const header = sent.value.result as { outcome: string };
        const prepared = held as PreparedRewind | null;
        if (header.outcome === "applied" && prepared !== null) {
          const installed = await installRestore({
            root: prepared.root,
            store: deps.store,
            session: prepared.plan.target.session,
            judged: prepared.plan.judged,
            prepared: prepared.files,
          });
          const amended = await amendInstalled(writer, done.revert, installed);
          if (!amended.ok) return amended;
        }
        return sent;
      },
    };
    const ran = await runAppSteps(ports, input.revert);
    if (!ran.ok) return ran;
    const after = readStored(deps, input.revert);
    if (!after.ok) return after;
    return ok({
      revert: input.revert,
      outcome: after.value.outcome,
      called: ran.value.called,
    });
  };
}
