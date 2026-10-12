// /v1/agent-traces/export의 product serving(observability#R10, R12, R14, R16, R17).
// export는 ledger event가 없는 runtime 접수라 writer queue 앞의 처리기가 실행한다
// (connection test와 같은 모양). 대상 trace 조립은 observability/reads의 같은 accessor,
// 본문은 blob 참조에서, 안전화는 core 알려진 값 registry를 쓰는 제품 redactor다.
// destination은 로컬 파일 경로뿐이다(R12). 실패는 원본·run을 바꾸지 않는다(R17).
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  agentTraceExport,
  agentTraceExportInputSchema,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  type KnownSecretMatch,
  openConnection,
  type Writer,
} from "../../packages/platform/ledger/mod.ts";
import {
  createTraceExport,
  type ExportBodySource,
  type ExportRedactor,
  type TraceExportDeps,
} from "../../packages/lophn-agent/observability/work.ts";
import type {
  RedactionInput,
  RedactionResult,
} from "../../packages/protocol/platform/mod.ts";
import { createProductRedactor } from "./documents-redactor.ts";

export type TraceExportWriterDeps = {
  ledgerPath: string;
  // blob 바이트 읽기 통로(core가 보유한다). 없으면 내용을 고른 export는 제외된다.
  readBlob:
    | ((hash: string, offset: number, length: number) => Promise<
      Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>
    >)
    | undefined;
  // 알려진 secret 값의 matcher(core 프로세스의 secret store).
  known: () => KnownSecretMatch | undefined;
};

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

// destination에 NDJSON을 쓴다. 로컬 파일뿐이다(R12).
async function writeDestination(
  destination: string,
  lines: string,
): Promise<Result<number>> {
  if (!destination.startsWith("/") && !destination.startsWith("./")) {
    return unavailable("export destination is not a local file");
  }
  try {
    await Deno.writeTextFile(destination, lines);
    return ok(new TextEncoder().encode(lines).length);
  } catch {
    return unavailable("export destination is not writable");
  }
}

// blob 참조 행을 다시 읽는 통로다. ledger snapshot 열기 한 번이면 충분하다.
type RefRow = {
  owner_kind: unknown;
  owner_key: unknown;
  field: unknown;
  hash: unknown;
  size_bytes: unknown;
};

function bodyEditor(rows: readonly RefRow[]): ExportBodySource {
  const byKey = new Map<string, { hash: string; size_bytes: number }>();
  for (const row of rows) {
    if (
      typeof row.owner_kind !== "string" ||
      typeof row.owner_key !== "string" || typeof row.field !== "string" ||
      typeof row.hash !== "string" ||
      (typeof row.size_bytes !== "number" && typeof row.size_bytes !== "bigint")
    ) continue;
    byKey.set(
      `${row.owner_kind}:${row.owner_key}:${row.field}`,
      { hash: row.hash, size_bytes: Number(row.size_bytes) },
    );
  }
  return {
    ref(ownerKind, ownerKey, field) {
      return byKey.get(`${ownerKind}:${ownerKey}:${field}`);
    },
    bytes() {
      // export의 blob 바이트는 core의 읽기 통로에만 달려 있다. 참조 행은 열 때 모은다.
      return Promise.resolve(
        err({ code: "unavailable", message: "blob editor has no bytes" }),
      );
    },
  };
}

// writer queue 앞 처리기. 이 command만 가로채고 나머지 command와 Writer 동작은 그대로다.
export function withTraceExport(
  writer: Writer,
  deps: TraceExportWriterDeps,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      if (envelope.command !== agentTraceExport.name) {
        return await writer.command(ctx, envelope);
      }
      const parsed = agentTraceExportInputSchema.safeParse(envelope.input);
      if (!parsed.success) {
        return err({
          code: "invalid_input",
          message: "export 입력이 계약과 다르다",
        });
      }
      // 참조 행은 ledger를 요청마다 열어 읽는다(export 준비 동안 열어 두지 않는다).
      const opened = openConnection(deps.ledgerPath);
      if (!opened.ok) return opened;
      let refs: ReturnType<typeof bodyEditor>;
      try {
        const rows = opened.value.sql.all(
          `select owner_kind, owner_key, field, hash, size_bytes from blob_refs`,
          [],
        ) as unknown as Parameters<typeof bodyEditor>[0];
        refs = bodyEditor(rows);
      } finally {
        opened.value.close();
      }
      const body: ExportBodySource = {
        ...refs,
        bytes: (hash, offset, length) =>
          deps.readBlob?.(hash, offset, length) ??
            Promise.resolve(
              err({ code: "unavailable", message: "blob 읽기가 없다" }),
            ),
      };
      const product = createProductRedactor(deps.known());
      // 제품 redactor를 엔진 모양으로 감싼다. 끝내지 못한 안전화는 제외한다(fail-closed).
      const redactor: ExportRedactor = (
        input: RedactionInput,
        value: string,
      ): RedactionResult => {
        const safe = product(input.source, input.media_type, value);
        if (safe === null) {
          return {
            rule_revision: "product",
            status: "omitted",
            content: null,
            redacted_items: [],
            omissions: [{
              location: "body",
              reason: "redaction_failed",
              message: "export redaction did not finish",
            }],
          };
        }
        return {
          rule_revision: "product",
          status: "passed",
          content: { kind: "inline", value: safe },
          redacted_items: [],
          omissions: [],
        };
      };
      const exportDeps: TraceExportDeps = {
        snapshot(read) {
          const opened = openConnection(deps.ledgerPath);
          if (!opened.ok) return opened;
          try {
            return read(opened.value.sql) as never;
          } catch {
            return unavailable("ledger를 읽을 수 없다");
          } finally {
            opened.value.close();
          }
        },
        body,
        redactor,
        write: writeDestination,
      };
      const done = await createTraceExport(exportDeps, {
        now: () => new Date().toISOString(),
      }).export(parsed.data);
      if (!done.ok) return done;
      return ok({
        result: done.value,
        replayed: false,
        first_seq: null,
        last_seq: null,
        wake: false,
      });
    },
  };
}
