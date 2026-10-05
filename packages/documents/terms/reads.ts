// Term read. list는 context의 활성 정의와 후보를 나눠 읽고(정의 첫 page 30개와
// cursor), get은 보관된 용어까지 정의·고정 근거를 읽는다. 읽기는 아무것도 쓰지 않는다:
// 앱 read command를 항목으로 가진 context의 정의를 읽어도 앱 blueprint는 바뀌지 않는다.
// 근거는 고정 판 참조일 뿐 본문이 아니다. 읽을 수 없는 문서의 근거는 빼고, 범위 밖
// context와 용어는 없는 것과 같이 답한다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  GLOSSARY_PAGE_LIMIT,
  type Term,
  type TermEvidence,
  termGet,
  termList,
} from "../../contracts/documents/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type ReadSnapshot,
  type RequestContext,
  type Sql,
  TargetAuthorization,
} from "../../contracts/platform/mod.ts";
import { authorizeDocument, loadDocument } from "../versions/mod.ts";
import { decodeGlossaryCursor, encodeGlossaryCursor } from "./model.ts";
import { listActive, loadTerm } from "./store.ts";

function rejected(code: string, message: string): Result<never> {
  return err({ code: code as "not_found", message });
}

function readActorAllowed(
  ctx: RequestContext,
  allowed: readonly string[],
): boolean {
  const kind = parseActor(ctx.actor)?.kind;
  return kind !== undefined && allowed.includes(kind);
}

// context 범위 판정. 범위 밖과 없는 context는 같은 false다.
function contextVisible(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  context: string,
): Result<boolean> {
  const sql = snapshot.sql as unknown as Sql;
  if (
    sql.get(`SELECT 1 AS found FROM contexts WHERE id = ?`, [context]) ===
      undefined
  ) return ok(false);
  const decision = snapshot.port(TargetAuthorization)(
    ctx,
    operation,
    { context },
  );
  if (!decision.ok) {
    return decision.error.code === "forbidden" ||
        decision.error.code === "not_found"
      ? ok(false)
      : decision;
  }
  return ok(true);
}

// 근거가 가리키는 문서를 읽을 수 없으면 그 근거는 응답에서 빠진다(없는 것과 같다).
function visibleEvidence(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  items: readonly TermEvidence[],
): Result<TermEvidence[]> {
  const sql = snapshot.sql as unknown as Sql;
  const visible: TermEvidence[] = [];
  for (const item of items) {
    const document = loadDocument(sql, item.document);
    if (!document.ok) return document;
    if (document.value === null) continue;
    const access = authorizeDocument(snapshot.port, ctx, operation, {
      kind: "document",
      document: document.value,
    });
    if (!access.ok) {
      if (
        access.error.code === "forbidden" || access.error.code === "not_found"
      ) continue;
      return access;
    }
    visible.push(item);
  }
  return ok(visible);
}

function shown(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  term: Term,
): Result<Term> {
  const evidence = visibleEvidence(snapshot, ctx, operation, term.evidence);
  if (!evidence.ok) return evidence;
  return ok({ ...term, evidence: evidence.value });
}

export function createTermReads(): {
  list: ReadDefinition<typeof termList>;
  get: ReadDefinition<typeof termGet>;
} {
  return {
    list: {
      route: termList,
      handle(snapshot, ctx, input) {
        if (!readActorAllowed(ctx, termList.actors)) {
          return rejected("forbidden", "actor cannot read terms");
        }
        const limit = input.limit ?? GLOSSARY_PAGE_LIMIT;
        const position = decodeGlossaryCursor(input.cursor);
        if (position === null) {
          return rejected("invalid_input", "cursor is invalid");
        }
        const visible = contextVisible(
          snapshot,
          ctx,
          termList.name,
          input.context,
        );
        if (!visible.ok) return visible;
        if (!visible.value) return rejected("not_found", "context not found");
        const sql = snapshot.sql as unknown as Sql;
        // 정의와 후보를 따로 한 칸 더 읽어 이어 읽을 것이 있는지 안다.
        const definitions = listActive(sql, input.context, "definitions", {
          offset: position.definitions,
          limit: limit + 1,
        });
        if (!definitions.ok) return definitions;
        const candidates = listActive(sql, input.context, "candidates", {
          offset: position.candidates,
          limit: limit + 1,
        });
        if (!candidates.ok) return candidates;
        const pageDefinitions: Term[] = [];
        for (const term of definitions.value.slice(0, limit)) {
          const value = shown(snapshot, ctx, termList.name, term);
          if (!value.ok) return value;
          pageDefinitions.push(value.value);
        }
        const pageCandidates: Term[] = [];
        for (const term of candidates.value.slice(0, limit)) {
          const value = shown(snapshot, ctx, termList.name, term);
          if (!value.ok) return value;
          pageCandidates.push(value.value);
        }
        const more = definitions.value.length > limit ||
          candidates.value.length > limit;
        return ok({
          definitions: pageDefinitions,
          candidates: pageCandidates,
          complete: !more,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: more
            ? encodeGlossaryCursor({
              definitions: position.definitions + pageDefinitions.length,
              candidates: position.candidates + pageCandidates.length,
            })
            : null,
        } as never);
      },
    },
    get: {
      route: termGet,
      handle(snapshot, ctx, input) {
        if (!readActorAllowed(ctx, termGet.actors)) {
          return rejected("forbidden", "actor cannot read terms");
        }
        const sql = snapshot.sql as unknown as Sql;
        const loaded = loadTerm(sql, input.term);
        if (!loaded.ok) return loaded;
        if (loaded.value === null) {
          return rejected("not_found", "term not found");
        }
        const visible = contextVisible(
          snapshot,
          ctx,
          termGet.name,
          loaded.value.context,
        );
        if (!visible.ok) return visible;
        if (!visible.value) return rejected("not_found", "term not found");
        const term = shown(snapshot, ctx, termGet.name, loaded.value);
        if (!term.ok) return term;
        return ok({
          term: term.value,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        } as never);
      },
    },
  };
}
