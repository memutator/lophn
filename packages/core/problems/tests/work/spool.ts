import { RUNNER_LIMITS } from "./limits.ts";

const encoder = new TextEncoder();

export type SpoolRecord = {
  request_key: string;
  // redaction이 끝난 결과 canonical. 원문 출력은 넣지 않는다.
  result: string;
  written_at: string;
  confirmed: boolean;
};

export type SpoolFile = {
  path: string;
  mode: number;
};

// 작업 폴더 0700, spool 0600. credential 파일은 만들지 않는다.
export async function prepareWorkDir(root: string): Promise<void> {
  await Deno.mkdir(root, { recursive: true, mode: 0o700 });
  await Deno.chmod(root, 0o700);
}

export async function writeSpool(
  dir: string,
  record: SpoolRecord,
): Promise<SpoolFile> {
  await prepareWorkDir(dir);
  const path = `${dir}/result.spool`;
  const handle = await Deno.open(path, {
    create: true,
    write: true,
    truncate: true,
    mode: 0o600,
  });
  try {
    await handle.write(encoder.encode(`${JSON.stringify(record)}\n`));
  } finally {
    handle.close();
  }
  await Deno.chmod(path, 0o600);
  return { path, mode: (await Deno.stat(path)).mode ?? 0 };
}

// 확정된 작업 폴더는 바로 지운다. spool은 응답이 확정된 뒤에만 지운다.
export async function clearConfirmed(dir: string): Promise<void> {
  await Deno.remove(dir, { recursive: true });
}

export function spoolExpired(writtenAtMs: number, nowMs: number): boolean {
  return nowMs - writtenAtMs >= RUNNER_LIMITS.spool_ttl_ms;
}

export type RecoveryDecision =
  | { kind: "resend"; result: string }
  | { kind: "inconclusive" }
  | { kind: "unknown" };

// 결과 응답이 유실되면 같은 spool 결과를 다시 보낸다. 기한이 지나면
// 실제 시작한 요청만 inconclusive로 확정한다. 시작 여부를 모르면 결과를 만들지 않는다.
export function recoverSpool(
  record: SpoolRecord | null,
  started: boolean | null,
  nowMs: number,
): RecoveryDecision {
  if (started === null) return { kind: "unknown" };
  if (!started) return { kind: "unknown" };
  if (record && !record.confirmed) {
    const written = Date.parse(record.written_at);
    if (Number.isFinite(written) && !spoolExpired(written, nowMs)) {
      return { kind: "resend", result: record.result };
    }
    return { kind: "inconclusive" };
  }
  if (!record) return { kind: "inconclusive" };
  return { kind: "resend", result: record.result };
}
