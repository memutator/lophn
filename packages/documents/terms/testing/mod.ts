// leaf unit fixture. writer Worker·current credential·core API 증거는 아니다.
// 실제 file SQLite ledger(addressing·versions·contexts·terms 표) 위에서 command를 돌린다.
import { DatabaseSync } from "node:sqlite";
import type { Result } from "../../../base/mod.ts";
import { outlineAndSearchSchemaSteps } from "../../outline-and-search/mod.ts";
import { termsSchemaSteps } from "../mod.ts";

const HASH = "ab".repeat(32);

// ULID 문자 집합(Crockford base32: i·l·o·u 없음)으로 n번째 term id를 만든다.
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
function termId(n: number): string {
  let rest = n;
  let body = "";
  do {
    body = CROCKFORD[rest % 32] + body;
    rest = Math.floor(rest / 32);
  } while (rest > 0);
  return `trm_${body.padStart(26, "0")}`;
}

export const ids = {
  context: "ctx_01arz3ndektsv4rrffq69g5fav",
  context2: "ctx_01arz3ndektsv4rrffq69g5faw",
  doc: "doc_01arz3ndektsv4rrffq69g5fav",
  app: "app_01arz3ndektsv4rrffq69g5fav",
  run: "run_01arz3ndektsv4rrffq69g5fav",
  context3: "ctx_01arz3ndektsv4rrffq69g5fax",
  doc2: "doc_01arz3ndektsv4rrffq69g5faw",
  version1: "ver_01arz3ndektsv4rrffq69g5fa1",
  version2: "ver_01arz3ndektsv4rrffq69g5fa2",
  version3: "ver_01arz3ndektsv4rrffq69g5fa3",
  term: termId,
};

export function userContext(actor = "user", run?: string) {
  return {
    principal: "person",
    actor,
    scope: { operations: [], targets: {} },
    conditions: {},
    credential_ref: "current",
    ...(run === undefined ? {} : { run }),
  };
}

export function keep<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

// 다른 leaf의 fixture는 그 leaf의 *_test.ts가 만들어 넘긴다(leaf의 testing/은
// *_test.ts에서만 import한다). base는 addressing·versions·contexts 표를 연 ledger다.
export function termFixture<
  B extends { db: DatabaseSync; seedDocument(id: string): void },
>(base: B) {
  for (const step of termsSchemaSteps) base.db.exec(step.sql);
  return {
    ...base,
    // context 행. 용어는 context 안에서만 있다.
    seedContext(id = ids.context, status = "active") {
      base.db.prepare(
        `INSERT INTO contexts (id, title, purpose, revision, status)
         VALUES (?, 'Notes', '기준 자료', '1', ?)`,
      ).run(id, status);
    },
    // 고정 판. 문서 행은 seedDocument가 심은 것을 쓴다.
    seedVersion(document: string, version: string, number: number) {
      base.db.prepare(
        `INSERT INTO versions (id, document, number, files_hash, primary_path,
           file_count, content_hash, format_name, module_hash, format_explicit,
           saved_by, saved_at)
         VALUES (?, ?, ?, ?, 'a.md', 1, ?, 'document', ?, 1, 'user',
           '2026-10-05T00:00:00.000Z')`,
      ).run(version, document, number, HASH, HASH, HASH);
    },
  };
}

// 문서 판의 추출 결과를 담는 derived store. coordinator의 쓰기 대신 직접 심는다.
export function derivedFixture() {
  const directory = Deno.makeTempDirSync({ prefix: "terms-derived-" });
  const db = new DatabaseSync(`${directory}/documents.sqlite`);
  for (const step of outlineAndSearchSchemaSteps) db.exec(step.sql);
  return {
    db,
    sql: {
      get: (statement: string, params: readonly unknown[]) =>
        db.prepare(statement).get(...(params as never[])) as
          | Record<string, unknown>
          | undefined,
    },
    // text는 줄바꿈으로 줄을 나눈다. sections의 range는 1-based 줄이다.
    extract(
      document: string,
      version: string,
      text: string,
      sections: { key: string; start: number; end: number }[],
      status = "ready",
    ) {
      const lineCount = text.split("\n").length;
      db.prepare(
        `INSERT INTO derived_versions (version, document, content_hash, module_hash,
           extraction_status, text_hash, line_count, section_count, failure_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        version,
        document,
        HASH,
        HASH,
        status,
        status === "ready" ? HASH : null,
        status === "ready" ? lineCount : null,
        sections.length,
        status === "failed" ? "extractor failed" : null,
      );
      if (status !== "ready") return;
      db.prepare(
        `INSERT INTO derived_texts (version, text_hash, text, line_offsets)
         VALUES (?, ?, ?, '[]')`,
      ).run(version, HASH, text);
      sections.forEach((section, position) => {
        const range = JSON.stringify([
          { start_line: section.start, end_line: section.end },
        ]);
        db.prepare(
          `INSERT INTO derived_sections (version, key, title, parent, position, level,
             anchor, own_ranges, subtree_range, characters, estimated_tokens,
             body_hash, children_count)
           VALUES (?, ?, ?, NULL, ?, 1, NULL, ?, ?, 0, 0, ?, 0)`,
        ).run(
          version,
          section.key,
          section.key,
          position,
          range,
          JSON.stringify({ start_line: section.start, end_line: section.end }),
          HASH,
        );
      });
    },
    close() {
      db.close();
      Deno.removeSync(directory, { recursive: true });
    },
  };
}
