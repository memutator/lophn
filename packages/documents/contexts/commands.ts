// Context ledger command. 생성·제목과 목적 변경·항목 추가·제거·보관·해제다.
// 항목 대상은 저장 판이 있는 문서·그 section·앱 read command만이다. 구성 변경은
// base_revision CAS로 기존 변경을 덮지 않는다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Context,
  contextArchive,
  contextArchived,
  contextCreate,
  contextCreated,
  type ContextItem,
  contextItemRemoved,
  contextItemSet,
  contextRecordWatchChange,
  contextRemoveItem,
  contextSetItem,
  contextUnarchive,
  contextUnarchived,
  contextUpdate,
  contextUpdated,
  contextWatchedItemChanged,
} from "../../contracts/documents/mod.ts";
import {
  type CommandDefinition,
  type Input,
  parseActor,
  type RequestContext,
  type Sql,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { authorizeDocument, loadDocument } from "../versions/mod.ts";
import { targetKey } from "./model.ts";
import { loadConfigEvents, pendingWatches } from "./work.ts";
import {
  type ContextItemRow,
  type ContextRow,
  insertContext,
  insertItems,
  listItems,
  loadContext,
  loadContextRow,
  replaceItems,
  updateContext,
} from "./store.ts";

// 앱 command 효과 검사는 apps blueprint read가 들어오기 전 test double로만 한다.
// double이 없거나 false를 내면 fail-closed다.
export type ContextCommandDeps = {
  appCommand?: (app: string, command: string) => boolean;
};

function rejected(code: string, message: string): Result<never> {
  return err({ code: code as "conflict", message });
}

function actorAllowed(
  ctx: RequestContext,
  allowed: readonly string[],
): boolean {
  const kind = parseActor(ctx.actor)?.kind;
  return kind !== undefined && allowed.includes(kind);
}

// 관점 편집은 사람과 허용된 Context Engineer agent다(route actors: user·agent).
const EDITOR_ACTORS = ["user", "agent"] as const;

// run 없는 agent 편집은 새 대상 변경이 아닌 미완성 제출이다(versions precedent).
function agentRunMissing(ctx: RequestContext): boolean {
  return ctx.actor.startsWith("agent:") && ctx.run === undefined;
}

export function createContextCommands(deps: ContextCommandDeps = {}): {
  create: CommandDefinition<typeof contextCreate>;
  update: CommandDefinition<typeof contextUpdate>;
  setItem: CommandDefinition<typeof contextSetItem>;
  removeItem: CommandDefinition<typeof contextRemoveItem>;
  archive: CommandDefinition<typeof contextArchive>;
  unarchive: CommandDefinition<typeof contextUnarchive>;
  recordWatchChange: CommandDefinition<typeof contextRecordWatchChange>;
} {
  return {
    create: {
      route: contextCreate,
      handle(tx, ctx, input, compare) {
        if (!actorAllowed(ctx, EDITOR_ACTORS)) {
          return rejected("forbidden", "actor cannot create contexts");
        }
        if (agentRunMissing(ctx)) {
          return rejected("invalid_input", "agent edit needs its run");
        }
        if (Object.keys(compare).length !== 0) {
          return rejected("invalid_input", "create takes no compare fields");
        }
        const existing = loadContextRow(tx.sql, input.id);
        if (!existing.ok) return existing;
        if (existing.value !== null) {
          return rejected("conflict", "context already exists");
        }
        // 항목 대상 검사는 event 앞에서 한다. 거절은 아무것도 남기지 않는다.
        for (const item of input.items) {
          const valid = validTarget(tx, ctx, deps, item.target);
          if (!valid.ok) return valid;
        }
        const seq = tx.emit(contextCreated, input.id, {
          title: input.title,
          purpose: input.purpose,
          items: input.items.map((item) => ({
            target: recordOf(item.target),
            perspective: item.perspective,
            reason: item.reason,
          })),
        });
        insertContext(tx, {
          id: input.id,
          title: input.title,
          purpose: input.purpose,
          revision: seq,
          status: "active",
        });
        insertItems(tx, input.id, input.items);
        return contextOutput(tx.sql, input.id);
      },
    },
    update: {
      route: contextUpdate,
      handle(tx, ctx, input, compare) {
        if (!actorAllowed(ctx, EDITOR_ACTORS)) {
          return rejected("forbidden", "actor cannot update contexts");
        }
        if (agentRunMissing(ctx)) {
          return rejected("invalid_input", "agent edit needs its run");
        }
        const current = loadContextRow(tx.sql, input.context);
        if (!current.ok) return current;
        if (current.value === null) {
          return rejected("not_found", "context not found");
        }
        if (current.value.revision !== compare.base_revision) {
          return rejected("conflict", "context revision changed");
        }
        const before: { title?: string; purpose?: string } = {};
        const after: { title?: string; purpose?: string } = {};
        if (input.title !== undefined) {
          before.title = current.value.title;
          after.title = input.title;
        }
        if (input.purpose !== undefined) {
          before.purpose = current.value.purpose;
          after.purpose = input.purpose;
        }
        const seq = tx.emit(contextUpdated, current.value.id, {
          before,
          after,
          before_revision: current.value.revision,
        });
        const next: ContextRow = {
          ...current.value,
          title: input.title ?? current.value.title,
          purpose: input.purpose ?? current.value.purpose,
          revision: seq,
        };
        updateContext(tx, next);
        return contextOutput(tx.sql, input.context);
      },
    },
    setItem: {
      route: contextSetItem,
      handle(tx, ctx, input, compare) {
        if (!actorAllowed(ctx, EDITOR_ACTORS)) {
          return rejected("forbidden", "actor cannot edit context items");
        }
        if (agentRunMissing(ctx)) {
          return rejected("invalid_input", "agent edit needs its run");
        }
        const current = loadContextRow(tx.sql, input.context);
        if (!current.ok) return current;
        if (current.value === null) {
          return rejected("not_found", "context not found");
        }
        const items = listItems(tx.sql, input.context);
        if (!items.ok) return items;
        if (current.value.revision !== compare.base_revision) {
          return rejected("conflict", "context revision changed");
        }
        const valid = validTarget(tx, ctx, deps, input.item.target);
        if (!valid.ok) return valid;
        const key = targetKey(input.item.target);
        const before = items.value.find((item) => item.target_key === key) ??
          null;
        // 새 target은 지정 자리에 넣고 뒤 항목을 민다. 기존 target은 관점·이유만
        // 바꾸고 자리는 그대로다.
        const shifted = before === null
          ? shiftedFrom(items.value, input.position ?? items.value.length)
          : items.value;
        const next: ContextItemRow[] = before === null
          ? [
            ...shifted.filter((item) => item.target_key !== key),
            {
              target_key: key,
              position: input.position ?? items.value.length,
              target: input.item.target,
              perspective: input.item.perspective,
              reason: input.item.reason,
            },
          ]
          : items.value.map((item) =>
            item.target_key === key
              ? {
                ...item,
                perspective: input.item.perspective,
                reason: input.item.reason,
              }
              : item
          );
        const position = next.find((item) => item.target_key === key)
          ?.position ?? 0;
        const seq = tx.emit(contextItemSet, current.value.id, {
          target: recordOf(input.item.target),
          before_item: before === null ? null : itemRecord(before),
          item: itemRecord(input.item),
          before_position: before?.position ?? null,
          position,
          before_revision: current.value.revision,
        });
        replaceItems(tx, input.context, next);
        // revision은 마지막 구성 변경 seq다. 항목 변경도 CAS 기준을 옮긴다.
        updateContext(tx, { ...current.value, revision: seq });
        return contextOutput(tx.sql, input.context);
      },
    },
    removeItem: {
      route: contextRemoveItem,
      handle(tx, ctx, input, compare) {
        if (!actorAllowed(ctx, EDITOR_ACTORS)) {
          return rejected("forbidden", "actor cannot edit context items");
        }
        if (agentRunMissing(ctx)) {
          return rejected("invalid_input", "agent edit needs its run");
        }
        const current = loadContextRow(tx.sql, input.context);
        if (!current.ok) return current;
        if (current.value === null) {
          return rejected("not_found", "context not found");
        }
        const items = listItems(tx.sql, input.context);
        if (!items.ok) return items;
        if (current.value.revision !== compare.base_revision) {
          return rejected("conflict", "context revision changed");
        }
        const key = targetKey(input.target);
        const removed = items.value.find((item) => item.target_key === key);
        if (removed === undefined) {
          return rejected("not_found", "context item not found");
        }
        const next: ContextItemRow[] = items.value
          .filter((item) => item.target_key !== key)
          .map((item) =>
            item.position > removed.position
              ? { ...item, position: item.position - 1 }
              : item
          );
        const seq = tx.emit(contextItemRemoved, current.value.id, {
          target: recordOf(removed.target),
          before_item: itemRecord(removed),
          before_position: removed.position,
          before_revision: current.value.revision,
        });
        replaceItems(tx, input.context, next);
        updateContext(tx, { ...current.value, revision: seq });
        return contextOutput(tx.sql, input.context);
      },
    },
    archive: {
      route: contextArchive,
      handle: (tx, ctx, input, compare) =>
        transition(tx, ctx, input.context, compare.base_revision, "archive"),
    },
    unarchive: {
      route: contextUnarchive,
      handle: (tx, ctx, input, compare) =>
        transition(tx, ctx, input.context, compare.base_revision, "unarchive"),
    },
    recordWatchChange: {
      route: contextRecordWatchChange,
      handle: (tx, ctx, input, compare) =>
        recordWatchChange(tx, ctx, input, compare.base_revision),
    },
  };
}

type WatchComparison = Input<typeof contextRecordWatchChange>;

// 확인된 문서 watch 변화 하나를 기록한다. 기록은 구성 변경이 아니라서 context revision을
// 바꾸지 않는다. 같은 `(context, target, after_version)`의 재전달은 event 하나만 남긴다.
function recordWatchChange(
  tx: Tx,
  ctx: RequestContext,
  input: WatchComparison,
  base: string,
): Result<{ id: string; revision: string; status: "active" | "archived" }> {
  if (parseActor(ctx.actor)?.kind !== "machine") {
    return rejected("forbidden", "watch changes are machine only");
  }
  // 확인된 변화만 event가 된다. 같음·미확인은 기록하지 않는다(contexts#R11).
  if (
    input.result !== "content_changed" && input.result !== "section_added" &&
    input.result !== "section_missing"
  ) {
    return rejected("invalid_input", "only a confirmed change is recorded");
  }
  if (input.context_revision !== base) {
    return rejected("invalid_input", "comparison revision must match base");
  }
  const target = input.target;
  if (target.kind !== "document") {
    return rejected("invalid_input", "watch change needs a document target");
  }
  const current = loadContextRow(tx.sql, input.context);
  if (!current.ok) return current;
  if (current.value === null) {
    return rejected("not_found", "context not found");
  }
  const output = {
    id: current.value.id,
    revision: current.value.revision,
    status: current.value.status,
  };
  const key = targetKey(target);
  // 이미 기록한 변화의 재전달은 같은 결과다. 그 뒤 구성이 바뀌어도 기록은 그대로다.
  const known = tx.sql.get(
    `SELECT 1 AS found FROM context_watch_changes
     WHERE context = ? AND target_key = ? AND after_version = ?`,
    [input.context, key, input.after_version],
  );
  if (known !== undefined) return ok(output);
  if (current.value.status !== "active") {
    return rejected("conflict", "context is archived");
  }
  if (current.value.revision !== base) {
    return rejected("conflict", "context revision changed");
  }
  // 원래 저장(또는 복원) event가 이 비교의 전후 판을 정한다.
  const source = tx.sql.get(
    "SELECT type, subject, payload FROM events WHERE seq = ?",
    [input.source_seq],
  );
  const saved = source === undefined ||
      (source.type !== "DocumentSaved" && source.type !== "DocumentRestored")
    ? null
    : savedPayload(source.payload);
  if (
    saved === null || source?.subject !== target.document ||
    saved.version !== input.after_version ||
    saved.previous_version !== input.before_version
  ) {
    return rejected("invalid_input", "comparison does not match its save");
  }
  // 저장 당시 watch였고 그 뒤 바뀌지 않은 항목만이다. 비교 중 관점·대상을 바꾸거나 보관했거나
  // 저장 뒤에 추가한 항목이면 낡은 결과다(contexts#R12).
  const events = loadConfigEvents(tx.sql, input.context);
  if (!events.ok) return events;
  const pending = pendingWatches(
    events.value,
    target.document,
    input.source_seq,
  );
  if (!pending.ok) return pending;
  if (!pending.value.some((watch) => targetKey(watch.target) === key)) {
    return rejected("conflict", "context watch item changed since the save");
  }
  const seq = tx.emit(contextWatchedItemChanged, input.context, {
    target: recordOf(target),
    before_version: input.before_version,
    after_version: input.after_version,
    source_seq: input.source_seq,
    change_kind: input.result,
  });
  tx.sql.run(
    `INSERT INTO context_watch_changes
       (context, target_key, after_version, source_seq, before_version,
        event_seq, comparison)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.context,
      key,
      input.after_version,
      input.source_seq,
      input.before_version,
      seq,
      JSON.stringify(input),
    ],
  );
  return ok(output);
}

function savedPayload(
  value: unknown,
): { version: string; previous_version: string | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    return null;
  }
  const body = parsed as { version?: unknown; previous_version?: unknown };
  if (typeof body !== "object" || body === null) return null;
  if (typeof body.version !== "string") return null;
  const previous = body.previous_version;
  if (previous !== null && typeof previous !== "string") return null;
  return { version: body.version, previous_version: previous };
}

function transition(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  base: string,
  action: "archive" | "unarchive",
): Result<Context> {
  if (!actorAllowed(ctx, EDITOR_ACTORS)) {
    return rejected("forbidden", "actor cannot change context archive state");
  }
  if (agentRunMissing(ctx)) {
    return rejected("invalid_input", "agent edit needs its run");
  }
  const current = loadContextRow(tx.sql, id);
  if (!current.ok) return current;
  if (current.value === null) {
    return rejected("not_found", "context not found");
  }
  if (current.value.revision !== base) {
    return rejected("conflict", "context revision changed");
  }
  const expected = action === "archive" ? "active" : "archived";
  if (current.value.status !== expected) {
    return rejected("conflict", "context status changed");
  }
  const seq = tx.emit(
    action === "archive" ? contextArchived : contextUnarchived,
    current.value.id,
    { before_revision: current.value.revision },
  );
  const next: ContextRow = {
    ...current.value,
    status: action === "archive" ? "archived" : "active",
    revision: seq,
  };
  updateContext(tx, next);
  return contextOutput(tx.sql, id);
}

// 새 target의 지정 자리 이상 항목을 한 칸 민다.
function shiftedFrom(
  items: readonly ContextItemRow[],
  at: number,
): ContextItemRow[] {
  return items.map((item) =>
    item.position >= at ? { ...item, position: item.position + 1 } : item
  );
}

// 항목 대상 검사. 문서 가지는 저장 판이 있는 문서만, 앱 가지는 read command만이다.
function validTarget(
  tx: Tx,
  ctx: RequestContext,
  deps: ContextCommandDeps,
  target: ContextItem["target"],
): Result<void> {
  if (target.kind === "document") {
    // 저장 판이 있는 문서만 대상이다. 미추적 파일·project 폴더 형상은 아니다.
    const document = loadDocument(tx.sql, target.document);
    if (!document.ok) return document;
    if (document.value === null) {
      return rejected("invalid_input", "context item needs a stored document");
    }
    // 항목 추가가 읽기 권한을 주지 않는다. 편집자가 대상 문서를 볼 수 있는지는
    // port가 판정한다. 범위 밖 문서는 없는 문서와 똑같이 답한다.
    const access = authorizeDocument(tx.port, ctx, contextCreate.name, {
      kind: "document",
      document: document.value,
    });
    if (!access.ok) {
      return access.error.code === "forbidden" ||
          access.error.code === "not_found"
        ? rejected("invalid_input", "context item needs a stored document")
        : access;
    }
    return ok(undefined);
  }
  // 앱 command 효과는 apps blueprint read를 따른다. 그 전까지는 주입한 test
  // double만 본다. double이 없으면 fail-closed다.
  const allowed = deps.appCommand;
  if (typeof allowed !== "function" || !allowed(target.app, target.command)) {
    return rejected("invalid_input", "context item needs a read app command");
  }
  return ok(undefined);
}

function contextOutput(sql: Sql, id: string): Result<Context> {
  const value = loadContext(sql, id);
  if (!value.ok) return value;
  if (value.value === null) {
    return err({ code: "internal", message: "stored context is missing" });
  }
  return ok(value.value);
}

function itemRecord(
  item: ContextItemRow | ContextItem,
): ContextItem {
  return {
    target: item.target,
    perspective: item.perspective as ContextItem["perspective"],
    reason: item.reason,
  };
}

// event payload의 target record. section: null을 생략하지 않는다.
function recordOf(target: ContextItem["target"]): ContextItem["target"] {
  return target.kind === "document"
    ? { kind: "document", document: target.document, section: target.section }
    : { kind: "app_command", app: target.app, command: target.command };
}
