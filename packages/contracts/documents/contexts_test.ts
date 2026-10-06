import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import { EVENTS, ROUTES } from "./mod.ts";
import {
  CONTEXT_EVENTS,
  contextCreated,
  contextCreateInputSchema,
  contextItemSet,
  contextWatchedItemChanged,
  watchedItemComparisonSchema,
} from "./contexts.ts";
import {
  CONTEXT_DISPATCHABLE_COMMANDS,
  CONTEXT_ROUTES,
  contextCreate,
  contextRecordWatchChange,
} from "./context-routes.ts";
import { contextExportOutputSchema } from "./context-reads.ts";

const context = "ctx_01arz3ndektsv4rrffq69g5fav";
const document = "doc_01arz3ndektsv4rrffq69g5fav";
const version = "ver_01arz3ndektsv4rrffq69g5fav";
const app = "app_01arz3ndektsv4rrffq69g5fav";
const hash = "a".repeat(64);
const documentItem = {
  target: { kind: "document", document, section: null },
  perspective: "basis",
  reason: "판단이 따르는 자료",
};
const sectionItem = {
  target: { kind: "document", document, section: "범위" },
  perspective: "watch",
  reason: "같은 key의 변화를 본다",
};
const appItem = {
  target: { kind: "app_command", app, command: "status" },
  perspective: "reference",
  reason: "읽기 명령만 참고한다",
};
const create = {
  id: context,
  title: "범위",
  purpose: "이번 판단의 자료",
  items: [documentItem, sectionItem, appItem],
};

// deno-fmt-ignore
const contextRoutePaths = ["/v1/contexts/create", "/v1/contexts/update", "/v1/contexts/set_item", "/v1/contexts/remove_item", "/v1/contexts/archive", "/v1/contexts/unarchive", "/v1/contexts/record_watch_change", "/v1/contexts/list", "/v1/contexts/get", "/v1/contexts/related", "/v1/contexts/export", "/v1/contexts/watch"];
// deno-fmt-ignore
const contextEventTypes = ["ContextCreated", "ContextUpdated", "ContextItemSet", "ContextItemRemoved", "ContextArchived", "ContextUnarchived", "ContextWatchedItemChanged"];

Deno.test("documents/contexts#R5: route and event names match architecture", () => {
  assertEquals(CONTEXT_ROUTES.map(routePath), contextRoutePaths);
  assertEquals(CONTEXT_EVENTS.map((event) => event.type), contextEventTypes);
  assertEquals(
    ROUTES.filter((route) => route.resource === "contexts").map(routePath),
    contextRoutePaths,
  );
  assertEquals(
    EVENTS.filter((event) => event.type.startsWith("Context")).map((event) =>
      event.type
    ),
    contextEventTypes,
  );
  for (const route of CONTEXT_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
  assertEquals(contextCreate.actors, ["user", "agent"]);
  assertEquals(contextRecordWatchChange.actors, ["machine"]);
  assertEquals(
    CONTEXT_ROUTES.find((route) => route.method === "export")?.actors,
    ["user"],
  );
  for (const event of CONTEXT_EVENTS) {
    assert(event.subject.safeParse(context).success);
    assert(!event.subject.safeParse(context.replace("ctx_", "doc_")).success);
  }
});

Deno.test("documents/contexts#R1: perspectives stay distinct and empty lists are allowed", () => {
  assert(contextCreateInputSchema.safeParse(create).success);
  assert(
    contextCreateInputSchema.safeParse({ ...create, items: [] }).success,
  );
  assertEquals(
    create.items.map((item) => item.perspective),
    ["basis", "watch", "reference"],
  );
  assert(
    contextCreated.payload.safeParse({
      title: create.title,
      purpose: create.purpose,
      items: create.items,
    }).success,
  );
  assert(
    contextCreated.payload.safeParse({ hash, size_bytes: 1000 }).success,
  );
});

Deno.test("documents/contexts#R2: items accept stored documents, sections and read commands only", () => {
  for (
    const value of [
      { ...create, extra: true },
      { ...create, purpose: "   " },
      { ...create, id: context.replace("ctx_", "doc_") },
      {
        ...create,
        items: [{ ...documentItem, target: { kind: "folder", path: "/work" } }],
      },
      {
        ...create,
        items: [{
          ...appItem,
          target: { ...appItem.target, document },
        }],
      },
      { ...create, items: [documentItem, documentItem] },
    ]
  ) assert(!contextCreateInputSchema.safeParse(value).success);
});

Deno.test("documents/contexts#R3: a document and its section are different targets", () => {
  assert(
    contextCreateInputSchema.safeParse({
      ...create,
      items: [documentItem, sectionItem],
    }).success,
  );
  assert(
    contextItemSet.payload.safeParse({
      target: sectionItem.target,
      before_item: null,
      item: sectionItem,
      before_position: null,
      position: 1,
      before_revision: "4",
    }).success,
  );
});

Deno.test("documents/contexts#R9: a missing section stays the same target", () => {
  assert(
    contextWatchedItemChanged.payload.safeParse({
      target: sectionItem.target,
      before_version: version,
      after_version: version,
      source_seq: "8",
      change_kind: "section_missing",
    }).success,
  );
  assert(
    !contextWatchedItemChanged.payload.safeParse({
      target: documentItem.target,
      before_version: version,
      after_version: version,
      source_seq: "8",
      change_kind: "section_missing",
    }).success,
  );
});

Deno.test("documents/contexts#R10: confirmed watch changes keep fixed versions", () => {
  const comparison = {
    context,
    context_revision: "3",
    target: documentItem.target,
    source_seq: "8",
    before_version: version,
    after_version: version,
    result: "content_changed",
    before_hash: hash,
    after_hash: "b".repeat(64),
    module_hashes: { before: hash, after: hash },
    unverified_reason: null,
  };
  assert(watchedItemComparisonSchema.safeParse(comparison).success);
  assert(
    !watchedItemComparisonSchema.safeParse({
      ...comparison,
      before_hash: hash,
      after_hash: hash,
    }).success,
  );
  assert(
    !watchedItemComparisonSchema.safeParse({
      ...comparison,
      target: appItem.target,
    }).success,
  );
});

Deno.test("documents/contexts#R11: unverified comparisons are not recorded changes", () => {
  assert(
    watchedItemComparisonSchema.safeParse({
      context,
      context_revision: "3",
      target: sectionItem.target,
      source_seq: "8",
      before_version: version,
      after_version: version,
      result: "unverified",
      before_hash: null,
      after_hash: null,
      module_hashes: { before: hash, after: "b".repeat(64) },
      unverified_reason: "추출 실패",
    }).success,
  );
  assert(
    !watchedItemComparisonSchema.safeParse({
      context,
      context_revision: "3",
      target: sectionItem.target,
      source_seq: "8",
      before_version: null,
      after_version: version,
      result: "unverified",
      before_hash: null,
      after_hash: null,
      module_hashes: { before: null, after: hash },
      unverified_reason: null,
    }).success,
  );
  assert(
    !contextWatchedItemChanged.payload.safeParse({
      target: sectionItem.target,
      before_version: null,
      after_version: version,
      source_seq: "8",
      change_kind: "unverified",
    }).success,
  );
});

Deno.test("documents/contexts#R14: export keeps purpose, direct items and fixed versions", () => {
  assert(
    contextExportOutputSchema.safeParse({
      context: {
        ...create,
        revision: "3",
        status: "active",
      },
      items: [{
        perspective: "basis",
        reason: documentItem.reason,
        target: documentItem.target,
        fixed_version: version,
        section_status: "whole",
      }],
      glossary: [{ name: "범위", definition: "이번 판단의 대상" }],
      as_of_seq: "9",
      next_cursor: null,
    }).success,
  );
  assert(
    !contextExportOutputSchema.safeParse({
      context: { ...create, revision: "3", status: "active" },
      items: [{
        perspective: "reference",
        reason: appItem.reason,
        target: appItem.target,
        fixed_version: version,
        section_status: null,
      }],
      glossary: [],
      as_of_seq: "9",
      next_cursor: null,
    }).success,
  );
});

Deno.test("documents/contexts#R5: run revert가 보상으로 부르는 context command만 dispatchable이고 만들기·감시 기록·읽기는 아니다", () => {
  assertEquals(
    CONTEXT_DISPATCHABLE_COMMANDS.map((item) => item.route.name),
    [
      "context.update",
      "context.set_item",
      "context.remove_item",
      "context.archive",
      "context.unarchive",
    ],
  );
  for (const item of CONTEXT_DISPATCHABLE_COMMANDS) {
    assertEquals(item.dispatchable, true);
    assertEquals(item.route.kind, "command");
    // 보상은 사람 자격으로 부르는 같은 route다. 새 actor를 만들지 않는다.
    assertEquals(item.route.actors.includes("user"), true);
    assert(CONTEXT_ROUTES.includes(item.route as never));
  }
  const names = CONTEXT_DISPATCHABLE_COMMANDS.map((item) => item.route.name);
  assertEquals(names.includes(contextCreate.name), false);
  assertEquals(names.includes(contextRecordWatchChange.name), false);
});
