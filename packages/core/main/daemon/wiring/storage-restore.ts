// backup 묶음 복원. remove-platform이 이 file을 지운다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  backupStamp,
  planRestore,
  RESTORE_DECISION,
  restoreBinding,
  type RestoreOutcome,
} from "../../../storage/migration/mod.ts";
import { denoDir, repoRoot } from "../paths.ts";
import type { StoppedConditions, WiringFactory } from "./context.ts";

export const storageRestoreWiring: WiringFactory = () => {
  // restore가 정지 단계에서 할 일과 그 결과. 한 번에 하나만 받는다.
  let restoring = false;
  let pendingRestore:
    | { created_at: string; expectedCurrentSeq: string }
    | undefined;
  let restoreResult: Result<RestoreOutcome> | undefined;
  return {
    name: "storage-restore",
    // backups/list·get은 데이터 root의 manifest를 읽는다.
    environment: (ctx) => ({
      backups: { root: ctx.root.path, ledgerPath: ctx.ledgerPath },
    }),
    build(ctx) {
      return ok({
        core: {
          async restorePlan(createdAt) {
            if (ctx.stopped || !ctx.ready) {
              return err({
                code: "unavailable",
                message: "core가 아직 준비되지 않았다",
              });
            }
            const planned = await planRestore(
              ctx.root.path,
              ctx.ledgerPath,
              createdAt,
              ctx.schemaSteps.length,
            );
            if (!planned.ok) return planned;
            return ok({
              plan: planned.value,
              binding: await restoreBinding(planned.value),
            });
          },
          restoreStopped: () => pendingRestore !== undefined,
          async restore(request) {
            if (ctx.stopped || restoring) {
              return err({ code: "conflict", message: "이미 멈추는 중이다" });
            }
            if (!ctx.ready) {
              return err({
                code: "unavailable",
                message: "core가 아직 준비되지 않았다",
              });
            }
            restoring = true;
            // 묶음이 복원 가능한지와 잃을 범위는 정지 전에 본다. 사람이 본 범위가 바로 이 값이다.
            const planned = await planRestore(
              ctx.root.path,
              ctx.ledgerPath,
              request.created_at,
              ctx.schemaSteps.length,
            );
            if (!planned.ok) {
              restoring = false;
              return planned;
            }
            const binding = await restoreBinding(planned.value);
            // 확인은 writer의 registry가 대상·내용·결정을 맞춰 보고 한 번에 소비한다. 맞지 않으면
            // 아무것도 멈추지 않는다.
            const used = await ctx.runtime.confirmation({
              action: "consume",
              request: {
                ref: request.confirmation,
                decision: RESTORE_DECISION,
                binding,
              },
            });
            if (!used.ok) {
              restoring = false;
              return used;
            }
            pendingRestore = {
              created_at: request.created_at,
              expectedCurrentSeq: planned.value.current_through_seq,
            };
            await ctx.shutdown();
            return restoreResult ?? err({
              code: "unavailable",
              message: "복원을 시작하지 못했다",
            });
          },
        },
      });
    },
    // restore는 같은 정지 조건 위에서만 돈다. 이번 종료에는 blob GC를 하지 않는다.
    async stopped(ctx, conditions) {
      if (pendingRestore === undefined) return;
      restoreResult = await runStoppedRestore({
        dataRoot: ctx.root.path,
        ledgerPath: ctx.ledgerPath,
        request: pendingRestore,
        conditions,
        supportedSchema: ctx.schemaSteps.length,
        nowIso: ctx.clock.now(),
      });
      return "handled";
    },
  };
};

// restore 프로세스 입구(packages/core/main/worker/restore-entry.ts)를 띄워 정지한 data root를
// 복원한다. 파일 복사·hash·검증은 core graph 밖 프로세스의 몫이다.
// 어떤 실패도 현재 자료를 바꾸지 않은 채 오류로 돌아온다.
const RESTORE_TIMEOUT_MS = 10 * 60_000;

async function runStoppedRestore(input: {
  dataRoot: string;
  ledgerPath: string;
  request: { created_at: string; expectedCurrentSeq: string };
  conditions: StoppedConditions;
  supportedSchema: number;
  nowIso: string;
}): Promise<Result<RestoreOutcome>> {
  const { preparationsBlocked, commandsBlocked, writerStopped } =
    input.conditions;
  if (!(preparationsBlocked && commandsBlocked && writerStopped)) {
    return err({
      code: "unavailable",
      message: "정지를 확인하지 못해 복원하지 않았다",
    });
  }
  const stamp = backupStamp(input.nowIso);
  if (!stamp.ok) return stamp;
  const entry = new URL(
    "../../worker/restore-entry.ts",
    import.meta.url,
  )
    .pathname;
  let outcome: Deno.CommandOutput;
  try {
    outcome = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        `--allow-read=${input.dataRoot},${repoRoot()},${denoDir()}`,
        `--allow-write=${input.dataRoot}`,
        "--allow-env=LOPHN_HOME,LOPHN_RESTORE,HOME,PATH",
        "--no-prompt",
        entry,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      clearEnv: true,
      signal: AbortSignal.timeout(RESTORE_TIMEOUT_MS),
      env: {
        ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
        ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
        LOPHN_HOME: input.dataRoot,
        LOPHN_RESTORE: JSON.stringify({
          ledger: input.ledgerPath,
          createdAt: input.request.created_at,
          expectedCurrentSeq: input.request.expectedCurrentSeq,
          stamp: stamp.value,
          supportedSchema: input.supportedSchema,
          conditions: input.conditions,
          now: input.nowIso,
        }),
      },
    }).output();
  } catch {
    return err({
      code: "unavailable",
      message:
        "복원 프로세스가 끝나지 않았다. 현재 자료는 확인 전까지 믿지 않는다",
    });
  }
  const text = new TextDecoder().decode(outcome.stdout).trim();
  try {
    const reply = JSON.parse(text.slice(text.lastIndexOf("\n") + 1)) as {
      ok?: boolean;
      value?: RestoreOutcome;
      error?: { code?: string; message?: string };
    };
    if (reply.ok === true && reply.value !== undefined) {
      return ok(reply.value);
    }
    return err({
      code: reply.error?.code === "conflict" ? "conflict" : "unavailable",
      message: reply.error?.message ?? "복원하지 못했다",
    });
  } catch {
    return err({ code: "unavailable", message: "복원 결과를 읽지 못했다" });
  }
}
