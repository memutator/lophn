// context watch 계산(documents#T24). ledger 밖에서 하는 순수 계산이다: source_seq 당시의 구성을
// event로 재생해 그때 watch였던 항목을 가리고, 전후 고정 판의 내용을 비교한다(domain-model
// contexts "정책"). 이 파일은 파일·DB·network를 열지 않는다. command(commands.ts)와 coordinator
// consumer가 같은 규칙을 쓴다. 유사도로 대상을 바꾸지 않고, 모르는 것은 미확인으로 남긴다.
import type { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  contextArchived,
  contextCreated,
  contextItemRemoved,
  contextItemSet,
  type ContextTarget,
  contextUnarchived,
  contextUpdated,
  type watchedItemComparisonSchema,
} from "../../contracts/documents/mod.ts";
import type { Sql } from "../../contracts/platform/mod.ts";
import {
  compareSectionKey,
  type DerivedSectionState,
  type SectionSnapshot,
  WATCH_PENDING_REASON,
} from "../outline-and-search/mod.ts";
import { targetKey } from "./model.ts";

export type WatchedItemComparison = z.output<
  typeof watchedItemComparisonSchema
>;

// 구성(항목·보관)을 바꾸는 event. 변화 event(ContextWatchedItemChanged)는 구성이 아니다.
export const CONTEXT_CONFIG_EVENTS = [
  contextCreated.type,
  contextUpdated.type,
  contextItemSet.type,
  contextItemRemoved.type,
  contextArchived.type,
  contextUnarchived.type,
] as const;

export type ContextConfigEvent = {
  seq: string;
  type: string;
  subject: string | null;
  payload: unknown;
};

// ledger의 구성 event를 seq 순서로 읽는다. context를 주면 그 context만이다.
export function loadConfigEvents(
  sql: Pick<Sql, "all">,
  context?: string,
): Result<ContextConfigEvent[]> {
  const marks = CONTEXT_CONFIG_EVENTS.map(() => "?").join(", ");
  const rows = sql.all(
    `SELECT CAST(seq AS TEXT) AS seq, type, subject, payload FROM events
     WHERE type IN (${marks})${context === undefined ? "" : " AND subject = ?"}
     ORDER BY events.seq`,
    context === undefined
      ? [...CONTEXT_CONFIG_EVENTS]
      : [...CONTEXT_CONFIG_EVENTS, context],
  );
  const events: ContextConfigEvent[] = [];
  for (const row of rows) {
    let payload: unknown;
    try {
      payload = JSON.parse(String(row.payload));
    } catch {
      return err({ code: "internal", message: "stored event is invalid" });
    }
    events.push({
      seq: String(row.seq),
      type: String(row.type),
      subject: typeof row.subject === "string" ? row.subject : null,
      payload,
    });
  }
  return ok(events);
}

export type ReplayedContext = {
  // 마지막 구성 event의 seq. context revision이다.
  revision: string;
  status: "active" | "archived";
  // target_key → 관점. 문서와 앱 항목을 모두 담는다.
  items: ReadonlyMap<string, { target: ContextTarget; perspective: string }>;
};

function unreplayable(): Result<never> {
  return err({
    code: "internal",
    message: "context composition cannot be replayed",
  });
}

// 구성 event를 순서대로 적용한다. until(포함하지 않음)이 있으면 그 seq 앞까지만이다.
export function replayContexts(
  events: readonly ContextConfigEvent[],
  until?: string,
): Result<Map<string, ReplayedContext>> {
  const contexts = new Map<
    string,
    {
      revision: string;
      status: "active" | "archived";
      items: Map<string, { target: ContextTarget; perspective: string }>;
    }
  >();
  for (const event of events) {
    if (until !== undefined && BigInt(event.seq) >= BigInt(until)) break;
    const id = event.subject;
    if (id === null) return unreplayable();
    if (event.type === contextCreated.type) {
      const payload = contextCreated.payload.safeParse(event.payload);
      // blob 참조로만 남은 구성은 여기서 풀 수 없다.
      if (!payload.success || !("items" in payload.data)) return unreplayable();
      const items = new Map<
        string,
        { target: ContextTarget; perspective: string }
      >();
      for (const item of payload.data.items) {
        items.set(targetKey(item.target), {
          target: item.target,
          perspective: item.perspective,
        });
      }
      contexts.set(id, { revision: event.seq, status: "active", items });
      continue;
    }
    const current = contexts.get(id);
    if (current === undefined) return unreplayable();
    current.revision = event.seq;
    if (event.type === contextArchived.type) current.status = "archived";
    if (event.type === contextUnarchived.type) current.status = "active";
    if (event.type === contextItemSet.type) {
      const payload = contextItemSet.payload.safeParse(event.payload);
      if (!payload.success) return unreplayable();
      current.items.set(targetKey(payload.data.item.target), {
        target: payload.data.item.target,
        perspective: payload.data.item.perspective,
      });
    }
    if (event.type === contextItemRemoved.type) {
      const payload = contextItemRemoved.payload.safeParse(event.payload);
      if (!payload.success) return unreplayable();
      current.items.delete(targetKey(payload.data.target));
    }
  }
  return ok(contexts);
}

export type PendingWatch = {
  context: string;
  // 지금 구성의 revision. command의 base_revision과 입력의 context_revision이다.
  context_revision: string;
  target: { kind: "document"; document: string; section: string | null };
};

// source_seq(DocumentSaved)가 기록될 때 watch였고, 그 뒤 지금까지 그 항목과 보관 상태가
// 바뀌지 않은 문서 항목이다. 그 뒤에 추가한 항목을 과거부터 있던 항목으로 보지 않고,
// 관점·대상을 바꾸거나 보관한 항목의 낡은 변화는 내지 않는다(contexts#R12).
// 앱 항목은 watch여도 변화를 만들지 않는다(contexts#R13).
export function pendingWatches(
  events: readonly ContextConfigEvent[],
  document: string,
  sourceSeq: string,
): Result<PendingWatch[]> {
  const then = replayContexts(events, sourceSeq);
  if (!then.ok) return then;
  const now = replayContexts(events);
  if (!now.ok) return now;
  const pending: PendingWatch[] = [];
  for (const [context, before] of then.value) {
    const current = now.value.get(context);
    if (before.status !== "active" || current?.status !== "active") continue;
    for (const [key, item] of before.items) {
      if (
        item.perspective !== "watch" || item.target.kind !== "document" ||
        item.target.document !== document
      ) continue;
      if (current.items.get(key)?.perspective !== "watch") continue;
      if (changedAfter(events, context, key, sourceSeq)) continue;
      pending.push({
        context,
        context_revision: current.revision,
        target: {
          kind: "document",
          document,
          section: item.target.section,
        },
      });
    }
  }
  return ok(pending);
}

// source_seq 뒤에 이 항목이나 보관 상태를 건드린 구성 변경이 있는가.
function changedAfter(
  events: readonly ContextConfigEvent[],
  context: string,
  key: string,
  sourceSeq: string,
): boolean {
  for (const event of events) {
    if (event.subject !== context || BigInt(event.seq) <= BigInt(sourceSeq)) {
      continue;
    }
    if (
      event.type === contextArchived.type ||
      event.type === contextUnarchived.type
    ) return true;
    if (event.type === contextItemSet.type) {
      const payload = contextItemSet.payload.safeParse(event.payload);
      if (!payload.success || targetKey(payload.data.target) === key) {
        return true;
      }
    }
    if (event.type === contextItemRemoved.type) {
      const payload = contextItemRemoved.payload.safeParse(event.payload);
      if (!payload.success || targetKey(payload.data.target) === key) {
        return true;
      }
    }
  }
  return false;
}

export type WatchVersion = {
  version: string;
  content_hash: string;
  module_hash: string;
};

// 한 판의 한 section 상태. ready는 그 key의 section(없으면 빈 목록)이고, unknown은 추출
// 미완료·실패·미지원·미확인이라 section을 말할 수 없는 판이다(contexts#R11).
export type WatchSectionState = DerivedSectionState;

export type WatchComparisonInput = {
  context: string;
  context_revision: string;
  target: PendingWatch["target"];
  source_seq: string;
  before: WatchVersion | null;
  after: WatchVersion;
  // section target일 때만 쓴다. before가 null이면 before 상태도 없다.
  sections?: { before: WatchSectionState | null; after: WatchSectionState };
};

export const UNVERIFIED_PENDING = WATCH_PENDING_REASON;
export const UNVERIFIED_MODULE_CHANGED = "format module changed";

// 두 판의 section 상태로 비교의 의미를 말할 수 없는 이유. 비교할 수 있으면 null이다. 추출
// 미완료·실패·미지원·미확인, 또는 비교 규약을 알 수 없는 module 변경이다(contexts#R11).
// consumer가 미확인 목록을 다시 확인할 때도 같은 판정을 쓴다.
export function unverifiedReason(
  states: { before: WatchSectionState | null; after: WatchSectionState },
  hasBefore: boolean,
): string | null {
  if (states.after.kind === "unknown") {
    return `after version: ${states.after.reason}`;
  }
  if (hasBefore) {
    if (states.before === null) return UNVERIFIED_PENDING;
    if (states.before.kind === "unknown") {
      return `before version: ${states.before.reason}`;
    }
    if (
      states.before.snapshot.module_hash !== states.after.snapshot.module_hash
    ) {
      return UNVERIFIED_MODULE_CHANGED;
    }
  }
  return null;
}

// 전후 고정 판의 비교. 문서 전체는 content_hash, section은 같은 key의 body_hash다.
// 제목이나 format만 바뀌어 hash가 같으면 내용 변화로 꾸미지 않는다(contexts#R10).
export function compareWatchedItem(
  input: WatchComparisonInput,
): WatchedItemComparison {
  const base = {
    context: input.context,
    context_revision: input.context_revision,
    target: input.target,
    source_seq: input.source_seq,
    before_version: input.before?.version ?? null,
    after_version: input.after.version,
    module_hashes: {
      before: input.before?.module_hash ?? null,
      after: input.after.module_hash,
    },
  };
  const unverified = (reason: string): WatchedItemComparison => ({
    ...base,
    result: "unverified",
    before_hash: null,
    after_hash: null,
    unverified_reason: reason,
  });
  const settled = (
    result:
      | "content_changed"
      | "section_added"
      | "section_missing"
      | "unchanged",
    beforeHash: string | null,
    afterHash: string | null,
  ): WatchedItemComparison => ({
    ...base,
    result,
    before_hash: beforeHash,
    after_hash: afterHash,
    unverified_reason: null,
  });
  const section = input.target.section;
  if (section === null) {
    // 처음 판에는 비교할 앞이 없다.
    if (input.before === null) return settled("unchanged", null, null);
    return input.before.content_hash === input.after.content_hash
      ? settled(
        "unchanged",
        input.before.content_hash,
        input.after.content_hash,
      )
      : settled(
        "content_changed",
        input.before.content_hash,
        input.after.content_hash,
      );
  }
  const states = input.sections;
  if (states === undefined) return unverified(UNVERIFIED_PENDING);
  const reason = unverifiedReason(states, input.before !== null);
  if (reason !== null) return unverified(reason);
  const compared = compareSectionKey(
    states.before !== null && states.before.kind === "ready"
      ? states.before.snapshot
      : null,
    (states.after as { snapshot: SectionSnapshot }).snapshot,
    section,
  );
  if (!compared.comparable) return unverified(UNVERIFIED_MODULE_CHANGED);
  const change = compared.change;
  if (change === null || change.status === "unchanged") {
    return settled(
      "unchanged",
      change?.before?.body_hash ?? null,
      change?.after?.body_hash ?? null,
    );
  }
  const beforeHash = change.before?.body_hash ?? null;
  const afterHash = change.after?.body_hash ?? null;
  if (change.status === "added") {
    return settled("section_added", null, afterHash);
  }
  if (change.status === "missing") {
    return settled("section_missing", beforeHash, null);
  }
  return settled("content_changed", beforeHash, afterHash);
}
