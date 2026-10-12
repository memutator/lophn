// 정지 유지보수 프로세스 입구.
// core 종료 조립이 세 정지 조건을 실제 관측으로 채워 이 프로세스를 띄운다.
// blob_refs는 writer를 닫은 뒤 read-only로 읽는다. 읽지 못하면 아무것도
// 지우지 않는다(fail-closed). 파일 작업은 core graph 밖인 이 프로세스의 몫이다.

import { err, ok, type Result } from "../../../base/mod.ts";
import { openReaderConnection } from "../../storage/ledger/reader-connection.ts";
import type { RetentionRule } from "../../storage/blobs/mod.ts";
import {
  runMaintenanceGc,
  type StoppedConditions,
} from "../../storage/blobs/worker/maintenance.ts";

type Request = {
  ledger: string;
  conditions: StoppedConditions;
  fields: readonly RetentionRule[];
  nowMs: number;
};

async function main(): Promise<void> {
  const raw = Deno.env.get("LOPHN_MAINTENANCE");
  if (raw === undefined) fail("유지보수 요청이 없다");
  const request = parseRequest(raw);
  if (request === undefined) fail("유지보수 요청 모양이 다르다");
  const home = Deno.env.get("LOPHN_HOME");
  // 요청의 ledger는 이 프로세스에 허용된 데이터 root 안만 읽는다. 밖이면
  // 관측 실패로 보고 아무것도 지우지 않는다(fail-closed).
  if (
    home === undefined || !request.ledger.startsWith(`${home}/`) ||
    request.ledger.split("/").includes("..")
  ) fail("유지보수 ledger가 데이터 root 밖이다");
  const opened = openReaderConnection(request.ledger);
  if (!opened.ok) fail(opened.error.message);
  const reader = opened.value;
  try {
    const outcome = await runMaintenanceGc({
      root: request.ledger.slice(0, request.ledger.lastIndexOf("/")),
      conditions: () => request.conditions,
      fields: () => request.fields,
      nowMs: () => request.nowMs,
      listReferenceRows: () => readBlobRefs(reader),
    });
    if (!outcome.ok) fail(outcome.error.message);
  } finally {
    reader.close();
  }
}

// reader 연결은 한 번에 500행까지만 돌려준다(reads.ts). 한 페이지를 꽉
// 채우면 다음이 있다고 보고 primary key 커서로 이어 읽는다.
const BLOB_REFS_PAGE = 500;

type BlobRefRow = { hash: string; owner_kind: string; field: string };

// 고정 blob_refs 전체. primary key(owner_kind, owner_key, field, hash) 커서
// 로 페이지를 이어 읽되, 한 read-only snapshot 안에서만 읽는다. 중간에
// 실패하거나 행 모양이 다르면 관측 실패다: 일부만 보고 지우지 않는다
// (fail-closed).
function readBlobRefs(
  reader: {
    begin(): string;
    end(): void;
    sql: {
      all(
        query: string,
        params: readonly unknown[],
      ): readonly Record<string, unknown>[];
    };
  },
): Promise<Result<readonly BlobRefRow[]>> {
  try {
    reader.begin();
  } catch {
    return Promise.resolve(err({
      code: "unavailable",
      message: "고정 blob_refs snapshot을 열지 못했다",
    }));
  }
  try {
    const found: BlobRefRow[] = [];
    let cursor: BlobRefRow & { owner_key: string } | undefined;
    for (;;) {
      const rows = reader.sql.all(
        `select owner_kind, owner_key, field, hash from blob_refs
         where (? is null)
            or (owner_kind, owner_key, field, hash) > (?, ?, ?, ?)
         order by owner_kind, owner_key, field, hash
         limit ${BLOB_REFS_PAGE}`,
        cursor === undefined ? [null, "", "", "", ""] : [
          1,
          cursor.owner_kind,
          cursor.owner_key,
          cursor.field,
          cursor.hash,
        ],
      );
      for (const row of rows) {
        if (
          typeof row["hash"] !== "string" ||
          typeof row["owner_kind"] !== "string" ||
          typeof row["owner_key"] !== "string" ||
          typeof row["field"] !== "string"
        ) {
          return Promise.resolve(err({
            code: "unavailable",
            message: "blob_refs 행을 읽지 못했다",
          }));
        }
        const parsed: BlobRefRow & { owner_key: string } = {
          hash: row["hash"],
          owner_kind: row["owner_kind"],
          owner_key: row["owner_key"],
          field: row["field"],
        };
        found.push(parsed);
        cursor = parsed;
      }
      if (rows.length < BLOB_REFS_PAGE) break;
    }
    return Promise.resolve(ok(found));
  } catch {
    return Promise.resolve(err({
      code: "unavailable",
      message: "고정 blob_refs를 읽지 못했다",
    }));
  } finally {
    reader.end();
  }
}

function parseRequest(raw: string): Request | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  const conditions = record["conditions"];
  if (
    typeof record["ledger"] !== "string" ||
    typeof record["nowMs"] !== "number" ||
    !Array.isArray(record["fields"]) ||
    conditions === null || typeof conditions !== "object"
  ) return undefined;
  const flags = conditions as Record<string, unknown>;
  if (
    typeof flags["preparationsBlocked"] !== "boolean" ||
    typeof flags["commandsBlocked"] !== "boolean" ||
    typeof flags["writerStopped"] !== "boolean"
  ) return undefined;
  return {
    ledger: record["ledger"],
    nowMs: record["nowMs"],
    fields: record["fields"] as RetentionRule[],
    conditions: {
      preparationsBlocked: flags["preparationsBlocked"],
      commandsBlocked: flags["commandsBlocked"],
      writerStopped: flags["writerStopped"],
    },
  };
}

function fail(message: string): never {
  Deno.stderr.writeSync(new TextEncoder().encode(message + "\n"));
  Deno.exit(1);
}

if (import.meta.main) {
  await main();
}
