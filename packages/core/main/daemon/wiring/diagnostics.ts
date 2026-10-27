import process from "node:process";
import { ok } from "../../../../base/mod.ts";
import type { Diagnostic } from "../../../../protocol/supervision/mod.ts";
import {
  DIAGNOSTICS_WRITE_OP,
  diagnosticsList,
  diagnosticsStatus,
} from "../../../../protocol/diagnostics/mod.ts";
import {
  CRASH_LOCATIONS,
  crashDiagnostic,
  createComponentChecks,
  createLogRecordSource,
  diagnosticsListRead,
  diagnosticsStatusHandler,
  installCrashHandler,
  type StatusSource,
} from "../../../diagnostics/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "../../../storage/ledger/mod.ts";
import { createProductRedactor, type WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// 죽기 직전의 쓰기는 이 시간 안에 못 받으면 stderr로만 둔다.
const WRITE_DEADLINE_MS = 2000;

export const diagnosticsWiring: WiringFactory = () => {
  let uninstallCrash: (() => void) | undefined;
  return {
    name: "diagnostics",
    prepare(ctx) {
      // core와 ledger는 여기서 짓는다. 나머지 구성 요소는 owner의 wiring이 componentChecks에 더한다.
      ctx.componentChecks.push(...createComponentChecks({
        ready: () => ctx.ready,
        runtime: () => ctx.peek.runtime,
      }));
      const source: StatusSource = {
        get ready() {
          return ctx.ready;
        },
        schema: LEDGER_SCHEMA_STEPS.length + ctx.assembled.schemaSteps.length,
        dataRoot: ctx.root.path,
        // ledger를 만들거나 복원할 때마다 새로 정한 식별(data root의 ledger-id). 내용은 노출하지 않는다.
        // derived는 출처에 이 값을 적고 다르면 버리고 다시 만든다.
        ledgerId: ctx.ledgerId,
        checks: () => ctx.componentChecks,
      };
      ctx.provide("statusSource", source);

      // I/O worker의 응답을 request_id로 맞춰 쓰기 호출에 돌려준다.
      const pending = new Map<string, (accepted: boolean) => void>();
      let sequence = 0;
      ctx.ioListeners.push({
        onMessage(message) {
          if (message.type !== "worker_response") return;
          pending.get(message.request_id)?.(message.ok);
        },
      });
      ctx.provide("diagnosticsWrite", (diagnostic: Diagnostic) => {
        // io는 supervision wiring이 채우므로 호출 때 읽는다.
        const io = ctx.peek.io;
        if (io === undefined) return Promise.resolve(false);
        const requestId = `diag-${++sequence}`;
        return new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => settle(false), WRITE_DEADLINE_MS);
          const settle = (accepted: boolean) => {
            clearTimeout(timer);
            pending.delete(requestId);
            resolve(accepted);
          };
          pending.set(requestId, settle);
          io.send("platform/io", {
            type: "worker_request",
            request_id: requestId,
            op: DIAGNOSTICS_WRITE_OP,
            payload: { records: [diagnostic], dropped: 0 },
          }).then((sent) => {
            if (!sent.ok) settle(false);
          }, () => settle(false));
        });
      });

      // I/O worker가 뜨기 전의 crash는 write가 false로 끝나 stderr + 종료까지만 남는다.
      // 알려진 secret이 아직 준비되지 않으면 pattern 규칙만으로 가린다.
      const redact = (text: string) => {
        const source = {
          concern: "diagnostics/crash",
          revision: "1",
          scope: "stderr",
        };
        return createProductRedactor(ctx.peek.knownSecrets)(
          source,
          "text/plain",
          text,
        ) ?? createProductRedactor()(source, "text/plain", text) ?? "";
      };
      uninstallCrash = installCrashHandler({
        target: globalThis,
        write: () =>
          ctx.diagnosticsWrite(crashDiagnostic({
            component: "platform/core",
            location: CRASH_LOCATIONS.daemon,
            at: ctx.clock.now(),
          })),
        stderr: Deno.stderr.writable,
        redact,
        exit: process.exit,
      });
    },
    build(ctx) {
      const list = diagnosticsListRead(
        createLogRecordSource(ctx.root.path, ctx.clock),
      );
      return ok({
        memory: [[
          key(diagnosticsStatus),
          diagnosticsStatusHandler(() => ctx.componentChecks, ctx.clock),
        ]],
        reads: (reads) => reads.set(key(diagnosticsList), list),
      });
    },
    // 정상 종료 중의 예외가 exit(1)로 바뀌지 않게 가장 먼저 푼다.
    closeIntake() {
      uninstallCrash?.();
    },
  };
};
