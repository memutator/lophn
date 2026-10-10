// 사람 지침(LOPHN.md) 읽기 통로의 core 쪽 길(lophn-agent/instructions). 등록된 지침 파일에 연결된
// 문서와 preset이 붙인 문서의 현재 확정 판(documents.latest_version)을 ledger 읽기 전용 connection으로
// 짧게 읽고, 본문 바이트는 blob 읽기 통로로 받는다. 읽기만 있다. 파일 생성·저장·연결 변경은 사람의
// documents command이고 agent는 만들 길이 없다(R3).
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  INSTRUCTION_FILE_MAX_BYTES,
  type InstructionFile,
  type InstructionFiles,
} from "../../packages/lophn-agent/instructions/mod.ts";
import {
  GLOBAL_INSTRUCTION_TARGET,
  projectInstructionTarget,
} from "../../packages/documents/file-tracking/instruction.ts";
import {
  loadDocument,
  loadFiles,
  loadInstructionDocuments,
} from "../../packages/documents/versions/store.ts";
import type { Sql } from "../../packages/contracts/platform/mod.ts";
import { openConnection } from "../../packages/platform/ledger/mod.ts";

type BlobRead = (
  hash: string,
  offset: number,
  length: number,
) => Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;

type Located = {
  document: string;
  version: string;
  hash: string;
  size: number;
};

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

export function instructionFilesEnvironment(input: {
  ledgerPath: string;
  read: BlobRead;
}): InstructionFiles {
  // ledger는 짧게만 연다. 바이트를 기다리는 동안 connection을 잡지 않는다.
  function locate(
    find: (sql: Sql) => Result<Located | null>,
  ): Result<Located | null> {
    const opened = openConnection(input.ledgerPath);
    if (!opened.ok) return unavailable("지침 문서를 읽지 못했다");
    try {
      return find(opened.value.sql);
    } catch {
      return unavailable("지침 문서를 읽지 못했다");
    } finally {
      opened.value.close();
    }
  }

  async function open(located: Located): Promise<Result<InstructionFile>> {
    // 상한을 넘는 파일은 끝까지 읽지 않는다. 크기만 알면 call을 멈춘다.
    const length = Math.min(located.size, INSTRUCTION_FILE_MAX_BYTES);
    if (length === 0) {
      return ok({
        document: located.document,
        version: located.version,
        size_bytes: located.size,
        bytes: new Uint8Array(),
      });
    }
    const read = await input.read(located.hash, 0, length);
    if (!read.ok) return unavailable("지침 본문을 읽지 못했다");
    return ok({
      document: located.document,
      version: located.version,
      size_bytes: located.size,
      bytes: read.value.bytes,
    });
  }

  return {
    async registered(location) {
      const target = location.layer === "global"
        ? GLOBAL_INSTRUCTION_TARGET
        : location.layer === "project"
        ? projectInstructionTarget(location.place)
        : undefined;
      // app 층은 앱 자리의 파일 등록이 생기기 전에는 연결 문서가 없어 부재다.
      if (target === undefined) return ok(null);
      const located = locate((sql) => {
        const linked = loadInstructionDocuments(sql);
        if (!linked.ok) return linked;
        const found = linked.value.find((entry) =>
          entry.document.file_source?.kind === "instruction_file" &&
          entry.document.file_source.instruction_target === target
        );
        return found === undefined
          ? ok(null)
          : primary(sql, found.document.id, found.document.latest_version);
      });
      if (!located.ok) return located;
      return located.value === null ? ok(null) : await open(located.value);
    },
    async attached(document) {
      const located = locate((sql) => {
        const loaded = loadDocument(sql, document);
        if (!loaded.ok) return loaded;
        if (loaded.value === null) {
          return err({ code: "not_found", message: "지침 문서가 없다" });
        }
        return primary(sql, document, loaded.value.latest_version);
      });
      if (!located.ok) return located;
      if (located.value === null) return unavailable("지침 본문이 없다");
      return await open(located.value);
    },
    // 앱과 project의 관계는 아직 어느 contract도 내놓지 않는다. 추측하지 않는다.
    projectOf: () => Promise.resolve(ok(null)),
  };
}

function primary(
  sql: Sql,
  document: string,
  version: string,
): Result<Located | null> {
  const files = loadFiles(sql, version);
  if (!files.ok) return files;
  const main = files.value.find((file) => file.primary);
  if (main === undefined) return unavailable("지침 본문이 없다");
  return ok({
    document,
    version,
    hash: main.blob_hash,
    size: main.bytes,
  });
}

// ReadInstructionFile이 답에 싣는 읽은 때의 ledger 위치다.
export function ledgerHead(ledgerPath: string): Result<string> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return unavailable("지침 문서를 읽지 못했다");
  try {
    const head = opened.value.sql.get(
      "select coalesce(max(seq), 0) as seq from events",
      [],
    );
    return ok(String(head?.["seq"] ?? 0));
  } catch {
    return unavailable("지침 문서를 읽지 못했다");
  } finally {
    opened.value.close();
  }
}

type Place = { kind: "global" | "project" | "app"; id: string | null };

function notFound(): Result<never> {
  return err({ code: "not_found", message: "instruction not found" });
}

// ReadInstructionFile을 부른 run이 읽을 수 있는 자리·문서인지 ledger로 정한다. 읽을 수 있는 것은
// 전역과 그 run의 작업 자리(세션이 있으면 세션의 자리, 없으면 assignment 범위)의 project·app 층, 그리고
// 그 run의 assignment preset(어느 판이든)이 붙인 지침 문서뿐이다. 그 밖은 없는 대상과 같은 not_found다.
export function instructionAccess(ledgerPath: string) {
  return (input: {
    run: string;
    location?: { layer: string; place: string };
    document?: string;
  }): Result<void> => {
    const opened = openConnection(ledgerPath);
    if (!opened.ok) return unavailable("지침 문서를 읽지 못했다");
    try {
      const { sql } = opened.value;
      const run = sql.get("select assignment, session from runs where id = ?", [
        input.run,
      ]);
      if (run === undefined) return notFound();
      const assignment = sql.get(
        "select preset_id, scope_kind, scope_id from assignments where id = ?",
        [String(run["assignment"])],
      );
      if (assignment === undefined) return notFound();
      if (input.document !== undefined) {
        const rows = sql.all(
          "select definition from preset_revisions where preset_id = ?",
          [String(assignment["preset_id"])],
        );
        for (const row of rows) {
          let definition: { instructions?: { document?: unknown }[] };
          try {
            definition = JSON.parse(String(row["definition"]));
          } catch {
            return unavailable("지침 문서를 읽지 못했다");
          }
          if (
            definition.instructions?.some((item) =>
              item.document === input.document
            )
          ) return ok(undefined);
        }
        return notFound();
      }
      const location = input.location;
      if (location === undefined) return notFound();
      if (location.layer === "global") return ok(undefined);
      let place: Place = {
        kind: String(assignment["scope_kind"]) === "all"
          ? "global"
          : String(assignment["scope_kind"]) as Place["kind"],
        id: assignment["scope_id"] === null
          ? null
          : String(assignment["scope_id"]),
      };
      if (run["session"] !== null) {
        const session = sql.get(
          "select work_place_kind, work_place_id from sessions where id = ?",
          [String(run["session"])],
        );
        if (session !== undefined) {
          place = {
            kind: String(session["work_place_kind"]) as Place["kind"],
            id: session["work_place_id"] === null
              ? null
              : String(session["work_place_id"]),
          };
        }
      }
      return place.kind === location.layer && place.id === location.place
        ? ok(undefined)
        : notFound();
    } catch {
      return unavailable("지침 문서를 읽지 못했다");
    } finally {
      opened.value.close();
    }
  };
}
