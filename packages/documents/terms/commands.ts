// Term ledger command. 후보 제안·정의 확정·수정·보관·해제다.
// 정의 확정과 정의된 이름·뜻의 수정은 사람(actor=user)만 한다. Context Engineer
// agent는 후보의 이름·근거만 다룬다. 후보의 근거는 저장 판이 있는 문서의 고정 판이고
// section 또는 줄 범위를 가리킨다. 본문 출현 확인은 derived가 필요해 route가 command
// 앞에서 한다(질문 Q8, occurrence.ts). command는 고정 판의 존재와 참조, base_revision
// CAS만 확인한다. 정의를 지워 후보로 되돌리는 command는 없다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Term,
  termArchive,
  termArchived,
  termDefine,
  termDefined,
  type TermEvidence,
  termPropose,
  termProposed,
  termUnarchive,
  termUnarchived,
  termUpdate,
  termUpdated,
} from "../../contracts/documents/mod.ts";
import {
  parseActor,
  type RequestContext,
  type Sql,
  TargetAuthorization,
  type TargetAuthorizer,
  type Tx,
} from "../../contracts/platform/mod.ts";
import type { CommandDefinition } from "../../contracts/platform/mod.ts";
import { authorizeDocument, loadDocument } from "../versions/mod.ts";
import { sameEvidence, sameName, validCandidateEvidence } from "./model.ts";
import {
  activeNameOwner,
  insertEvidence,
  insertTerm,
  loadTerm,
  replaceEvidence,
  updateTerm,
} from "./store.ts";

function rejected(code: string, message: string): Result<never> {
  return err({ code: code as "conflict", message });
}

function actorKind(ctx: RequestContext): string | undefined {
  return parseActor(ctx.actor)?.kind;
}

// 후보 제안·후보 수정·보관은 사람과 허용된 Context Engineer agent다.
function editorAllowed(ctx: RequestContext): boolean {
  const kind = actorKind(ctx);
  return kind === "user" || kind === "agent";
}

// run 없는 agent 편집은 미완성 제출이다(contexts·versions precedent).
function agentRunMissing(ctx: RequestContext): boolean {
  return ctx.actor.startsWith("agent:") && ctx.run === undefined;
}

// route schema가 이미 막지만 handler도 공백 이름·뜻을 쓰지 않는다. 정의를 null이나
// 빈 문자열로 쓰는 입력은 정의를 지우는 요청이 되므로 여기서 거절한다.
function blank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

function isAgent(ctx: RequestContext): boolean {
  return actorKind(ctx) === "agent";
}

// context 범위는 platform이 주입한 TargetAuthorization port가 판정한다. 범위 밖은
// 없는 context와 같은 not_found다(존재를 새지 않는다).
function authorizeContext(
  tx: Tx,
  ctx: RequestContext,
  operation: string,
  context: string,
): Result<void> {
  const exists = tx.sql.get(`SELECT 1 AS found FROM contexts WHERE id = ?`, [
    context,
  ]);
  if (exists === undefined) return rejected("not_found", "context not found");
  let authorize: TargetAuthorizer;
  try {
    authorize = tx.port(TargetAuthorization);
  } catch {
    return rejected("unavailable", "term authorization unavailable");
  }
  if (typeof authorize !== "function") {
    return rejected("unavailable", "term authorization unavailable");
  }
  let decision: Result<void>;
  try {
    decision = authorize(ctx, operation, { context });
  } catch {
    return rejected("unavailable", "term authorization unavailable");
  }
  if (
    typeof decision !== "object" || decision === null || !("ok" in decision)
  ) {
    return rejected("unavailable", "term authorization unavailable");
  }
  if (decision.ok) return ok(undefined);
  return decision.error.code === "forbidden" ||
      decision.error.code === "not_found"
    ? rejected("not_found", "context not found")
    : decision;
}

// 근거는 저장 판이 있는 문서의 그 문서 판이어야 한다. 최신 주소로 바꿔치기하지
// 않는다. 문서가 없거나 판이 다른 문서의 것이거나 범위 밖이면 같은 invalid_input이다.
function checkEvidence(
  tx: Tx,
  ctx: RequestContext,
  operation: string,
  items: readonly TermEvidence[],
): Result<void> {
  for (const item of items) {
    const version = tx.sql.get(`SELECT document FROM versions WHERE id = ?`, [
      item.version,
    ]);
    const missing = () =>
      rejected("invalid_input", "term evidence needs a stored fixed version");
    if (version === undefined || version.document !== item.document) {
      return missing();
    }
    const document = loadDocument(tx.sql, item.document);
    if (!document.ok) return document;
    if (document.value === null) return missing();
    const access = authorizeDocument(tx.port, ctx, operation, {
      kind: "document",
      document: document.value,
    });
    if (!access.ok) {
      return access.error.code === "forbidden" ||
          access.error.code === "not_found"
        ? missing()
        : access;
    }
  }
  return ok(undefined);
}

function recordsOf(items: readonly TermEvidence[]): TermEvidence[] {
  return items.map((item) => ({
    document: item.document,
    version: item.version,
    section: item.section,
    start_line: item.start_line,
    end_line: item.end_line,
  }));
}

function output(sql: Sql, id: string): Result<Term> {
  const value = loadTerm(sql, id);
  if (!value.ok) return value;
  if (value.value === null) {
    return err({ code: "internal", message: "stored term is missing" });
  }
  return ok(value.value);
}

function loadForChange(
  tx: Tx,
  ctx: RequestContext,
  operation: string,
  id: string,
  base: string,
): Result<Term> {
  const current = loadTerm(tx.sql, id);
  if (!current.ok) return current;
  if (current.value === null) return rejected("not_found", "term not found");
  const scope = authorizeContext(tx, ctx, operation, current.value.context);
  if (!scope.ok) {
    return scope.error.code === "not_found"
      ? rejected("not_found", "term not found")
      : scope;
  }
  if (current.value.revision !== base) {
    return rejected("conflict", "term revision changed");
  }
  return ok(current.value);
}

export function createTermCommands(): {
  propose: CommandDefinition<typeof termPropose>;
  define: CommandDefinition<typeof termDefine>;
  update: CommandDefinition<typeof termUpdate>;
  archive: CommandDefinition<typeof termArchive>;
  unarchive: CommandDefinition<typeof termUnarchive>;
} {
  return {
    propose: {
      route: termPropose,
      handle(tx, ctx, input, compare) {
        if (!editorAllowed(ctx)) {
          return rejected("forbidden", "actor cannot propose terms");
        }
        if (agentRunMissing(ctx)) {
          return rejected("invalid_input", "agent edit needs its run");
        }
        if (Object.keys(compare).length !== 0) {
          return rejected("invalid_input", "propose takes no compare fields");
        }
        if (blank(input.name)) {
          return rejected("invalid_input", "term name is blank");
        }
        const scope = authorizeContext(
          tx,
          ctx,
          termPropose.name,
          input.context,
        );
        if (!scope.ok) return scope;
        if (!validCandidateEvidence(input.evidence)) {
          return rejected(
            "invalid_input",
            "a candidate needs section or line range evidence",
          );
        }
        const existing = loadTerm(tx.sql, input.id);
        if (!existing.ok) return existing;
        if (existing.value !== null) {
          return rejected("conflict", "term already exists");
        }
        if (activeNameOwner(tx.sql, input.context, input.name) !== null) {
          return rejected("conflict", "term name is already active");
        }
        const checked = checkEvidence(
          tx,
          ctx,
          termPropose.name,
          input.evidence,
        );
        if (!checked.ok) return checked;
        const seq = tx.emit(termProposed, input.id, {
          context: input.context,
          name: input.name,
          evidence: recordsOf(input.evidence),
        });
        insertTerm(tx, {
          id: input.id,
          context: input.context,
          name: input.name,
          definition: null,
          revision: seq,
          status: "active",
        });
        insertEvidence(tx, input.id, input.evidence);
        return output(tx.sql, input.id);
      },
    },
    define: {
      route: termDefine,
      // 정의 확정은 사람(actor=user)만이다. 사람 답을 적용하는 machine도 platform이
      // QuestionActionEvidence를 검증해 user actor로 기록한 뒤에만 여기에 온다.
      handle(tx, ctx, input, compare) {
        if (actorKind(ctx) !== "user") {
          return rejected("forbidden", "only a person defines terms");
        }
        if (blank(input.name) || blank(input.definition)) {
          return rejected(
            "invalid_input",
            "term name and definition are needed",
          );
        }
        if (input.term !== undefined) {
          return defineExisting(tx, ctx, {
            term: input.term,
            name: input.name,
            definition: input.definition,
            evidence: input.evidence,
          }, compare.base_revision);
        }
        // 새 등록은 비교할 판이 없다. route compare가 base_revision을 요구하므로
        // 값은 받되 CAS 기준은 아니다(새 ID·활성 이름 미존재가 기준이다).
        return defineNew(tx, ctx, {
          id: input.id as string,
          context: input.context as string,
          name: input.name,
          definition: input.definition,
          evidence: input.evidence ?? [],
        });
      },
    },
    update: {
      route: termUpdate,
      handle(tx, ctx, input, compare) {
        if (!editorAllowed(ctx)) {
          return rejected("forbidden", "actor cannot update terms");
        }
        if (agentRunMissing(ctx)) {
          return rejected("invalid_input", "agent edit needs its run");
        }
        // agent가 definition을 쓰려는 입력은 어떤 상태에서도 forbidden이다.
        if (isAgent(ctx) && input.definition !== undefined) {
          return rejected("forbidden", "an agent cannot write a definition");
        }
        if (
          (input.name !== undefined && blank(input.name)) ||
          (input.definition !== undefined && blank(input.definition))
        ) {
          return rejected(
            "invalid_input",
            "term name and definition are not blank",
          );
        }
        const loaded = loadForChange(
          tx,
          ctx,
          termUpdate.name,
          input.term,
          compare.base_revision,
        );
        if (!loaded.ok) return loaded;
        return updateTermFields(tx, ctx, loaded.value, input);
      },
    },
    archive: {
      route: termArchive,
      handle: (tx, ctx, input, compare) =>
        transition(tx, ctx, input.term, compare.base_revision, "archive"),
    },
    unarchive: {
      route: termUnarchive,
      handle: (tx, ctx, input, compare) =>
        transition(tx, ctx, input.term, compare.base_revision, "unarchive"),
    },
  };
}

function defineNew(
  tx: Tx,
  ctx: RequestContext,
  input: {
    id: string;
    context: string;
    name: string;
    definition: string;
    evidence: readonly TermEvidence[];
  },
): Result<Term> {
  const scope = authorizeContext(tx, ctx, termDefine.name, input.context);
  if (!scope.ok) return scope;
  const existing = loadTerm(tx.sql, input.id);
  if (!existing.ok) return existing;
  if (existing.value !== null) {
    return rejected("conflict", "term already exists");
  }
  if (activeNameOwner(tx.sql, input.context, input.name) !== null) {
    return rejected("conflict", "term name is already active");
  }
  const checked = checkEvidence(tx, ctx, termDefine.name, input.evidence);
  if (!checked.ok) return checked;
  const seq = tx.emit(termDefined, input.id, {
    context: input.context,
    name: input.name,
    before_definition: null,
    definition: input.definition,
    before_revision: null,
  });
  insertTerm(tx, {
    id: input.id,
    context: input.context,
    name: input.name,
    definition: input.definition,
    revision: seq,
    status: "active",
  });
  insertEvidence(tx, input.id, input.evidence);
  return output(tx.sql, input.id);
}

function defineExisting(
  tx: Tx,
  ctx: RequestContext,
  input: {
    term: string;
    name: string;
    definition: string;
    evidence: readonly TermEvidence[] | undefined;
  },
  base: string,
): Result<Term> {
  const loaded = loadForChange(tx, ctx, termDefine.name, input.term, base);
  if (!loaded.ok) return loaded;
  const current = loaded.value;
  // 정의 확정은 활성 후보에서만이다. 정의된 용어의 수정은 term.update, 보관된 용어는
  // 다시 활성으로 돌린 뒤다.
  if (current.status !== "active") {
    return rejected("conflict", "term status changed");
  }
  if (current.definition !== null) {
    return rejected("conflict", "term is already defined");
  }
  // 이름 변경은 term.update의 몫이다. TermDefined event는 이름을 바꾼 기록이 아니다.
  if (!sameName(current.name, input.name)) {
    return rejected("invalid_input", "defining a term does not rename it");
  }
  // TermDefined event는 근거를 싣지 않는다. 근거 변경은 term.update로 한다.
  if (input.evidence !== undefined) {
    return rejected(
      "invalid_input",
      "defining a term does not change evidence",
    );
  }
  const seq = tx.emit(termDefined, current.id, {
    context: current.context,
    name: current.name,
    before_definition: null,
    definition: input.definition,
    before_revision: current.revision,
  });
  updateTerm(tx, {
    id: current.id,
    context: current.context,
    name: current.name,
    definition: input.definition,
    revision: seq,
    status: "active",
  });
  return output(tx.sql, current.id);
}

function updateTermFields(
  tx: Tx,
  ctx: RequestContext,
  current: Term,
  input: { name?: string; definition?: string; evidence?: TermEvidence[] },
): Result<Term> {
  if (current.status !== "active") {
    return rejected("conflict", "term status changed");
  }
  const candidate = current.definition === null;
  // agent는 후보의 이름·근거만 바꾼다. 정의된 용어의 이름·뜻은 사람의 결정이다.
  if (isAgent(ctx) && !candidate) {
    return rejected("forbidden", "an agent cannot change a defined term");
  }
  // 후보에 뜻을 주는 일은 정의 확정이라 term.define이다.
  if (candidate && input.definition !== undefined) {
    return rejected("invalid_input", "a candidate is defined with term.define");
  }
  const changed = {
    name: input.name !== undefined && !sameName(input.name, current.name)
      ? input.name
      : undefined,
    definition:
      input.definition !== undefined && input.definition !== current.definition
        ? input.definition
        : undefined,
    evidence: input.evidence !== undefined &&
        !sameEvidence(input.evidence, current.evidence)
      ? input.evidence
      : undefined,
  };
  if (
    changed.name === undefined && changed.definition === undefined &&
    changed.evidence === undefined
  ) {
    return rejected("invalid_input", "update changes nothing");
  }
  // 후보의 근거는 어느 actor가 바꿔도 section 또는 줄 범위를 가리키는 1개 이상이다.
  if (
    candidate && changed.evidence !== undefined &&
    !validCandidateEvidence(changed.evidence)
  ) {
    return rejected(
      "invalid_input",
      "a candidate needs section or line range evidence",
    );
  }
  if (changed.name !== undefined) {
    const owner = activeNameOwner(tx.sql, current.context, changed.name);
    if (owner !== null && owner !== current.id) {
      return rejected("conflict", "term name is already active");
    }
  }
  if (changed.evidence !== undefined) {
    const checked = checkEvidence(
      tx,
      ctx,
      termUpdate.name,
      changed.evidence,
    );
    if (!checked.ok) return checked;
  }
  const before: {
    name?: string;
    definition?: string;
    evidence?: TermEvidence[];
  } = {};
  const after: typeof before = {};
  if (changed.name !== undefined) {
    before.name = current.name;
    after.name = changed.name;
  }
  if (changed.definition !== undefined) {
    // 정의된 용어만 여기에 온다(후보의 definition 입력은 위에서 거절했다).
    before.definition = current.definition as string;
    after.definition = changed.definition;
  }
  if (changed.evidence !== undefined) {
    before.evidence = recordsOf(current.evidence);
    after.evidence = recordsOf(changed.evidence);
  }
  const seq = tx.emit(termUpdated, current.id, {
    before,
    after,
    before_revision: current.revision,
  });
  updateTerm(tx, {
    id: current.id,
    context: current.context,
    name: changed.name ?? current.name,
    definition: changed.definition ?? current.definition,
    revision: seq,
    status: "active",
  });
  if (changed.evidence !== undefined) {
    replaceEvidence(tx, current.id, changed.evidence);
  }
  return output(tx.sql, current.id);
}

// 보관·해제는 정의·근거를 지우지 않는다. 상태와 revision만 바꾼다.
function transition(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  base: string,
  action: "archive" | "unarchive",
): Result<Term> {
  if (!editorAllowed(ctx)) {
    return rejected("forbidden", "actor cannot change term archive state");
  }
  if (agentRunMissing(ctx)) {
    return rejected("invalid_input", "agent edit needs its run");
  }
  const operation = action === "archive"
    ? termArchive.name
    : termUnarchive.name;
  const loaded = loadForChange(tx, ctx, operation, id, base);
  if (!loaded.ok) return loaded;
  const current = loaded.value;
  const expected = action === "archive" ? "active" : "archived";
  if (current.status !== expected) {
    return rejected("conflict", "term status changed");
  }
  if (action === "unarchive") {
    // 그 사이 같은 이름이 active로 쓰였으면 해제할 수 없다.
    const owner = activeNameOwner(tx.sql, current.context, current.name);
    if (owner !== null && owner !== current.id) {
      return rejected("conflict", "term name is already active");
    }
  }
  const seq = tx.emit(
    action === "archive" ? termArchived : termUnarchived,
    current.id,
    { context: current.context, before_revision: current.revision },
  );
  updateTerm(tx, {
    id: current.id,
    context: current.context,
    name: current.name,
    definition: current.definition,
    revision: seq,
    status: action === "archive" ? "archived" : "active",
  });
  return output(tx.sql, current.id);
}
