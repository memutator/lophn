// GetSnapshotLogs가 core 안에서 읽는 통로(snapshots#R13, R16, R17). 증거 행은 ledger를
// 읽기 전용 connection으로 짧게 열어 읽고, 바이트는 blob store의 읽기 통로로 받는다.
// 정리된 첨부(PNG·로그 조각·stack)는 store가 구별한 pruned를 GetSnapshot의 "정리됨"으로 잇는다.
// core만 import한다(reader Worker와 settings 조립은 sqlite 의존을 끌어오지 않는다).
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ApiReadDefinition,
  TargetAuthorization,
} from "../../../protocol/server/mod.ts";
import {
  getSnapshot,
  getSnapshotInputSchema,
  REPORTING_LIMITS,
} from "../../../protocol/problems/mod.ts";
import {
  createTargetAuthorizer,
  openConnection,
} from "../../storage/ledger/mod.ts";
import { getSnapshotRead } from "../reporting/reads.ts";
import {
  applyPrunedSnapshotAbsence,
  logsRowOf,
  type PrunedAttachments,
  snapshotBlobStatus,
  type SnapshotLogsEnvironment,
} from "./mod.ts";
export type BlobBytesRead = (
  hash: string,
  offset: number,
  length: number,
) => Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;

// 제품 HTTP가 부르는 GetSnapshot. snapshotLogsEnvironment가 붙기 전에는 비어 있다.
let attached: SnapshotLogsEnvironment | undefined;

export function snapshotLogsEnvironment(input: {
  ledgerPath: string;
  read: BlobBytesRead;
}): SnapshotLogsEnvironment {
  const environment: SnapshotLogsEnvironment = {
    evidence(snapshot) {
      const opened = openConnection(input.ledgerPath);
      if (!opened.ok) return opened;
      try {
        const head = opened.value.sql.get(
          "select coalesce(max(seq), 0) as seq from events",
          [],
        );
        return ok(
          logsRowOf(opened.value.sql, snapshot, String(head?.["seq"] ?? 0)),
        );
      } catch {
        return err({ code: "unavailable", message: "snapshot을 읽지 못했다" });
      } finally {
        opened.value.close();
      }
    },
    async blobs(hash) {
      // 로그 조각은 log_bytes 안이라 한 번에 읽는다. pruned는 store가 구별한 그대로다.
      const read = await input.read(hash, 0, REPORTING_LIMITS.log_bytes);
      return read.ok
        ? { status: "available", bytes: read.value.bytes }
        : { status: "unavailable", reason: snapshotBlobStatus(read.error) };
    },
    async view(ctx, body) {
      const parsed = getSnapshotInputSchema.safeParse(body);
      if (!parsed.success) {
        return err({
          code: "invalid_input",
          message: "snapshot input is invalid",
        });
      }
      const opened = openConnection(input.ledgerPath);
      if (!opened.ok) return opened;
      let found: ReturnType<typeof getSnapshotRead.handle>;
      try {
        const head = opened.value.sql.get(
          "select coalesce(max(seq), 0) as seq from events",
          [],
        );
        found = getSnapshotRead.handle(
          {
            sql: opened.value.sql,
            as_of_seq: String(head?.["seq"] ?? 0),
            port<T>(key: unknown): T {
              if (!Object.is(key, TargetAuthorization)) {
                throw new Error("등록되지 않은 port다");
              }
              return createTargetAuthorizer(ctx) as unknown as T;
            },
          },
          ctx,
          parsed.data,
        );
      } catch {
        return err({ code: "unavailable", message: "snapshot을 읽지 못했다" });
      } finally {
        // SQL은 바이트를 기다리기 전에 닫는다.
        opened.value.close();
      }
      if (!found.ok) return found;
      const pruned = await prunedAttachments(environment, found.value.blobs);
      return ok(
        applyPrunedSnapshotAbsence(found.value, pruned, parsed.data.item),
      );
    },
  };
  attached = environment;
  return environment;
}

async function prunedAttachments(
  environment: SnapshotLogsEnvironment,
  blobs: readonly { purpose: string; hash: string }[],
): Promise<PrunedAttachments> {
  const pruned = async (purpose: string) => {
    const hash = blobs.find((blob) => blob.purpose === purpose)?.hash;
    if (hash === undefined) return false;
    const read = await environment.blobs(hash);
    return read.status === "unavailable" && read.reason === "pruned";
  };
  return {
    stack: await pruned("snapshot_stack"),
    logs: await pruned("snapshot_logs"),
    screenshot: await pruned("feedback_screenshot"),
  };
}

// sync GetSnapshot과 같은 route다. problems 등록은 reads에서 sync handler를 빼고
// 이 apiRead만 남긴다. 둘을 같이 두면 기동이 거절된다.
export function snapshotViewApiRead(): ApiReadDefinition<typeof getSnapshot> {
  return {
    route: getSnapshot,
    handle(ctx, input) {
      const view = attached?.view;
      if (view === undefined) {
        return err({
          code: "unavailable",
          message: "snapshot 읽기 통로가 붙어 있지 않다",
        });
      }
      return view(ctx, input);
    },
  };
}
