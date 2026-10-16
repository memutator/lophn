// GetSnapshotLogs가 core 안에서 읽는 통로. 증거 행은 ledger를
// 읽기 전용 connection으로 짧게 열어 읽고, 바이트는 blob store의 읽기 통로로 받는다.
// core만 import한다(reader Worker와 settings 조립은 sqlite 의존을 끌어오지 않는다).
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ApiReadDefinition,
  TargetAuthorization,
} from "../../../protocol/server/mod.ts";
import {
  problemGetOccurrence,
  REPORTING_LIMITS,
} from "../../../protocol/problems/mod.ts";
import {
  createTargetAuthorizer,
  openConnection,
} from "../../storage/ledger/mod.ts";
import { readOccurrence, withMessagePreview } from "../reporting/occurrence.ts";
import {
  logsRowOf,
  snapshotBlobStatus,
  type SnapshotLogsEnvironment,
} from "./mod.ts";
type BlobBytesRead = (
  hash: string,
  offset: number,
  length: number,
) => Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;

// 제품 HTTP가 부르는 발생 읽기. snapshotLogsEnvironment가 붙기 전에는 비어 있다.
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
      const parsed = problemGetOccurrence.input.safeParse(body);
      if (!parsed.success) {
        return err({
          code: "invalid_input",
          message: "occurrence input is invalid",
        });
      }
      const opened = openConnection(input.ledgerPath);
      if (!opened.ok) return opened;
      let found: ReturnType<typeof readOccurrence>;
      try {
        const head = opened.value.sql.get(
          "select coalesce(max(seq), 0) as seq from events",
          [],
        );
        found = readOccurrence(
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
        return err({ code: "unavailable", message: "발생을 읽지 못했다" });
      } finally {
        // SQL은 바이트를 기다리기 전에 닫는다.
        opened.value.close();
      }
      if (!found.ok) return found;
      if (found.value.message === null) return ok(found.value.view);
      const text = await environment.blobs(found.value.message.hash);
      return ok(
        withMessagePreview(
          found.value,
          text.status === "available" ? text.bytes : null,
        ),
      );
    },
  };
  attached = environment;
  return environment;
}

// `problem.get_occurrence`는 글 앞부분을 blob store에서 읽으므로 ledger snapshot에 묶지 않는
// apiRead다.
export function occurrenceApiRead(): ApiReadDefinition<
  typeof problemGetOccurrence
> {
  return {
    route: problemGetOccurrence,
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
