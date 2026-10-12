// /v1/apps/export의 product serving. reader pool은 동기 handler만 받고 export
// 준비는 파일·DB 작업이라 pool로 못 돈다. 그래서 worker route target으로 core의 worker route
// map에 직접 붙인다. ledger 읽기·요청 자격 재검사·앱 접근 판정은 core 안에서 하고(ledger
// 연결은 요청마다 열고 읽은 뒤 닫는다), 앱 DB를 여는 준비 본체는 core graph 밖 프로세스
// (packages/core/main/worker/export-entry.ts)가 한다. node:sqlite는 core graph에서 ledger만 쓴다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type RequestContext,
  TargetAuthorization,
} from "../../../protocol/server/mod.ts";
import { createExportTarget, type ExportJob } from "./reads.ts";
import {
  createTargetAuthorizer,
  openConnection,
} from "../../storage/ledger/mod.ts";
import type { WorkerRouteTarget } from "../../supervision/responsiveness/mod.ts";
import { denoDir, repoRoot } from "../control.ts";

const EXPORT_TIMEOUT_MS = 10 * 60_000;

export type AppExportWiring = {
  dataRoot: string;
  ledgerPath: string;
  current(credentialRef: string): Result<RequestContext>;
  observedAt(): string;
};

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

// export 준비 프로세스 한 번. 데이터 root 안에서만 읽고 쓰며 network·run 권한이 없다.
async function runExportProcess(
  dataRoot: string,
  job: ExportJob,
): Promise<Result<void>> {
  const entry = new URL("../../main/worker/export-entry.ts", import.meta.url)
    .pathname;
  try {
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        `--allow-read=${dataRoot},${repoRoot()},${denoDir()}`,
        `--allow-write=${dataRoot}`,
        "--allow-env=LOPHN_HOME,HOME,PATH",
        "--no-prompt",
        entry,
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
      clearEnv: true,
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
      env: {
        ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
        ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
        LOPHN_HOME: dataRoot,
      },
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(JSON.stringify(job)));
    await writer.close();
    const outcome = await child.output();
    const text = new TextDecoder().decode(outcome.stdout).trim();
    const reply = JSON.parse(text.slice(text.lastIndexOf("\n") + 1)) as {
      ok?: boolean;
      message?: string;
    };
    return reply.ok === true
      ? ok(undefined)
      : unavailable(reply.message ?? "app export failed");
  } catch {
    return unavailable("app export process did not finish");
  }
}

export function appExportWorkers(
  wiring: AppExportWiring,
): ReadonlyMap<string, WorkerRouteTarget> {
  const target = createExportTarget({
    current: wiring.current,
    // 요청마다 ledger 연결을 열고 읽기 transaction 안에서 읽는다. close가 닫는다.
    snapshot: (ctx) => {
      const opened = openConnection(wiring.ledgerPath);
      if (!opened.ok) return opened;
      const connection = opened.value;
      try {
        connection.exec("begin");
      } catch {
        connection.close();
        return unavailable("ledger를 읽을 수 없다");
      }
      const authorizer = createTargetAuthorizer(ctx);
      return ok({
        as_of_seq: "0",
        sql: connection.sql,
        port<T>(key: unknown): T {
          if (!Object.is(key, TargetAuthorization)) {
            throw new Error("unregistered port");
          }
          return authorizer as unknown as T;
        },
        close: () => connection.close(),
      } as never);
    },
    dataRoot: wiring.dataRoot,
    prepare: (job) => runExportProcess(wiring.dataRoot, job),
    observedAt: wiring.observedAt,
  });
  return new Map([["apps/export", target as unknown as WorkerRouteTarget]]);
}
