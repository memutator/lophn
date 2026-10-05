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
  contextRemoveItem,
  contextSetItem,
  contextUnarchive,
  contextUnarchived,
  contextUpdate,
  contextUpdated,
} from "../../contracts/documents/mod.ts";
import {
  type CommandDefinition,
  parseActor,
  type RequestContext,
  type Sql,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { authorizeDocument, loadDocument } from "../versions/mod.ts";
import { targetKey } from "./model.ts";
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
        tx.emit(contextItemSet, current.value.id, {
          target: recordOf(input.item.target),
          before_item: before === null ? null : itemRecord(before),
          item: itemRecord(input.item),
          before_position: before?.position ?? null,
          position,
          before_revision: current.value.revision,
        });
        replaceItems(tx, input.context, next);
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
        tx.emit(contextItemRemoved, current.value.id, {
          target: recordOf(removed.target),
          before_item: itemRecord(removed),
          before_position: removed.position,
          before_revision: current.value.revision,
        });
        replaceItems(tx, input.context, next);
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
  };
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
