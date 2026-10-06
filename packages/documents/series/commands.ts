// Series ledger command. 생성·가족 변경·draft·멤버 가입·변경·제거·보관·해제다.
// 멤버는 같은 place·같은 format의 확정 Document만이다. key 예약은 제거 뒤에도
// 남는다. 구성 변경은 base_revision CAS로 기존 변경을 덮지 않는다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Series,
  seriesAddInstance,
  seriesArchive,
  seriesArchived,
  seriesClearDraft,
  seriesCreate,
  seriesCreated,
  type SeriesDraft,
  seriesDraftCleared,
  seriesDraftSet,
  seriesInstanceAdded,
  seriesInstanceRemoved,
  seriesInstanceSchema,
  seriesInstanceUpdated,
  seriesRemoveInstance,
  seriesSetDraft,
  seriesUnarchive,
  seriesUnarchived,
  seriesUpdate,
  seriesUpdated,
  seriesUpdateInstance,
} from "../../contracts/documents/mod.ts";
import {
  type CommandDefinition,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { actingApp, isAppPlace } from "../addressing/mod.ts";
import { loadDocument, loadLatestVersion } from "../versions/mod.ts";
import { draftKeyConflicts } from "./model.ts";
import {
  deleteInstance,
  insertInstance,
  insertKeyReservation,
  insertSeries,
  listInstances,
  listReservedKeys,
  loadInstance,
  loadKeyReservation,
  loadSeries,
  loadSeriesByName,
  updateSeries,
} from "./store.ts";

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

// 가족 가입·변경은 사람과 허용된 coding agent·app이다(route actors).
const MEMBER_ACTORS = ["user", "coding_agent", "app"] as const;

// lophn agent는 가족 mutation tool이 없다(series#R9).
function isLophnAgent(ctx: RequestContext): boolean {
  return parseActor(ctx.actor)?.kind === "agent";
}

type InstanceRow = {
  series: string;
  document: string;
  key: string;
  order_value: string | number | null;
  order_version: string | null;
  revision: string;
};

export function createSeriesCommands(): {
  create: CommandDefinition<typeof seriesCreate>;
  update: CommandDefinition<typeof seriesUpdate>;
  setDraft: CommandDefinition<typeof seriesSetDraft>;
  clearDraft: CommandDefinition<typeof seriesClearDraft>;
  addInstance: CommandDefinition<typeof seriesAddInstance>;
  updateInstance: CommandDefinition<typeof seriesUpdateInstance>;
  removeInstance: CommandDefinition<typeof seriesRemoveInstance>;
  archive: CommandDefinition<typeof seriesArchive>;
  unarchive: CommandDefinition<typeof seriesUnarchive>;
} {
  return {
    create: {
      route: seriesCreate,
      handle(tx, ctx, input, compare) {
        if (!actorAllowed(ctx, MEMBER_ACTORS)) {
          return rejected("forbidden", "actor cannot create series");
        }
        if (Object.keys(compare).length !== 0) {
          return rejected("invalid_input", "create takes no compare fields");
        }
        // 앱은 자기 앱 place에만 가족을 등록한다(series#R1, versions#R14의 앱 범위).
        const app = actingApp(ctx);
        if (app !== null && !isAppPlace(app, input.place)) {
          return rejected("forbidden", "app registers series in its own place");
        }
        const existing = loadSeries(tx.sql, input.id);
        if (!existing.ok) return existing;
        if (existing.value !== null) {
          return rejected("conflict", "series already exists");
        }
        const byName = loadSeriesByName(tx.sql, input.place, input.name);
        if (!byName.ok) return byName;
        if (byName.value !== null) {
          return rejected("conflict", "series name is already reserved");
        }
        const seq = tx.emit(seriesCreated, input.id, {
          place: input.place,
          name: input.name,
          title: input.title,
          format: input.format,
          order: input.order,
          next_rule: input.next_rule,
        });
        const value: Series = {
          id: input.id,
          place: input.place,
          name: input.name,
          title: input.title,
          format: input.format,
          order: input.order,
          next_rule: input.next_rule,
          draft: null,
          revision: seq,
          status: "active",
        };
        insertSeries(tx, value);
        return ok(value);
      },
    },
    update: {
      route: seriesUpdate,
      handle(tx, ctx, input, compare) {
        return changeFamily(tx, ctx, input.series, compare.base_revision, (
          current,
        ) => {
          // format 변경은 모든 멤버 최신 판의 format 이름과 같을 때만이다.
          if (input.format !== undefined && input.format !== current.format) {
            const membership = listInstances(tx.sql, current.id);
            if (!membership.ok) return membership;
            for (const instance of membership.value) {
              const latest = loadLatestVersion(tx.sql, instance.document);
              if (!latest.ok) return latest;
              if (latest.value === null) {
                return rejected(
                  "invalid_input",
                  "member document has no stored version",
                );
              }
              if (latest.value.format.name !== input.format) {
                return rejected(
                  "conflict",
                  "member latest version format differs",
                );
              }
            }
          }
          // format_field order로 바꾸면 필요한 정렬 값·근거 판이 준비돼 있어야 한다.
          if (input.order?.kind === "format_field") {
            if (input.instances === undefined) {
              return rejected(
                "invalid_input",
                "format field order needs prepared instances",
              );
            }
            for (const prepared of input.instances) {
              const checked = checkOrderBasis(
                tx.sql,
                current,
                prepared.document,
                prepared.order_version,
              );
              if (!checked.ok) return checked;
            }
          }
          const changed: string[] = [];
          if (input.title !== undefined) changed.push("title");
          if (input.format !== undefined) changed.push("format");
          if (input.order !== undefined) changed.push("order");
          if (input.next_rule !== undefined) changed.push("next_rule");
          if (changed.length === 0) {
            return rejected("invalid_input", "series does not change");
          }
          return ok(changed);
        }, (current, changed) => {
          const changedList = changed as string[];
          const before: Record<string, unknown> = {};
          if (changedList.includes("title")) before.title = current.title;
          if (changedList.includes("format")) before.format = current.format;
          if (changedList.includes("order")) before.order = current.order;
          if (changedList.includes("next_rule")) {
            before.next_rule = current.next_rule;
          }
          const seq = tx.emit(
            seriesUpdated,
            current.id,
            {
              before: pickFields(before, changedList),
              after: pickFields({
                title: input.title ?? current.title,
                format: input.format ?? current.format,
                order: input.order ?? current.order,
                next_rule: input.next_rule ?? current.next_rule,
              }, changedList),
              before_revision: current.revision,
              order_basis: input.instances === undefined
                ? null
                : input.instances.map((instance) => ({
                  document: instance.document,
                  order_value: instance.order_value,
                  order_version: instance.order_version,
                })),
            },
          );
          const next: Series = {
            ...current,
            title: input.title ?? current.title,
            format: input.format ?? current.format,
            order: input.order ?? current.order,
            next_rule: input.next_rule ?? current.next_rule,
            revision: seq,
          };
          // 준비된 정렬 값은 각 멤버의 order_value로 고정한다.
          if (input.instances !== undefined) {
            applyOrderValues(tx, current.id, input.instances, seq);
          }
          return ok(next);
        });
      },
    },
    setDraft: {
      route: seriesSetDraft,
      handle(tx, ctx, input, compare) {
        if (parseActor(ctx.actor)?.kind !== "user") {
          return rejected("forbidden", "series draft is user only");
        }
        return changeFamily(tx, ctx, input.series, compare.base_revision, (
          current,
        ) => {
          if (input.draft.format.name !== current.format) {
            return rejected("invalid_input", "draft format differs");
          }
          if (input.draft.base_version !== null) {
            const base = loadLatestVersion(tx.sql, input.draft.document);
            if (!base.ok) return base;
            if (
              base.value === null ||
              base.value.id !== input.draft.base_version
            ) {
              return rejected("invalid_input", "draft base version is stale");
            }
          }
          const membership = listInstances(tx.sql, current.id);
          if (!membership.ok) return membership;
          const reserved = listReservedKeys(tx.sql, current.id);
          if (!reserved.ok) return reserved;
          if (
            draftKeyConflicts(membership.value, reserved.value, input.draft)
          ) {
            return rejected("conflict", "draft key is already taken");
          }
          return ok(undefined);
        }, (current) => {
          const seq = tx.emit(seriesDraftSet, current.id, {
            before_draft: current.draft,
            draft: outputDraft(input.draft),
            before_revision: current.revision,
          });
          return ok({ ...current, draft: input.draft, revision: seq });
        });
      },
    },
    clearDraft: {
      route: seriesClearDraft,
      handle(tx, ctx, input, compare) {
        if (parseActor(ctx.actor)?.kind !== "user") {
          return rejected("forbidden", "series draft is user only");
        }
        return changeFamily(tx, ctx, input.series, compare.base_revision, (
          current,
        ) => {
          if (current.draft === null) {
            return rejected("conflict", "series draft is empty");
          }
          return ok(undefined);
        }, (current) => {
          // validate가 draft 존재를 확인했다. T가 값을 못 전하므로 다시 좁힌다.
          const before = current.draft;
          if (before === null) {
            return rejected("conflict", "series draft is empty");
          }
          const seq = tx.emit(seriesDraftCleared, current.id, {
            before_draft: outputDraft(before),
            before_revision: current.revision,
          });
          return ok({ ...current, draft: null, revision: seq });
        });
      },
    },
    addInstance: {
      route: seriesAddInstance,
      handle(tx, ctx, input, compare) {
        return changeFamily(tx, ctx, input.series, compare.base_revision, (
          current,
        ) => {
          const joinable = checkJoin(tx, current, input.document, input.key);
          if (!joinable.ok) return joinable;
          const orderValue = input.order_value ?? null;
          const orderVersion = input.order_version ?? null;
          if (orderVersion !== null) {
            const checkedOrder = checkOrderBasis(
              tx.sql,
              current,
              input.document,
              orderVersion,
            );
            if (!checkedOrder.ok) return checkedOrder;
          }
          return ok({ orderValue, orderVersion });
        }, (current, checked) => {
          const basis = checked as {
            orderValue: string | number | null;
            orderVersion: string | null;
          };
          return applyJoin(
            tx,
            current,
            input.document,
            input.key,
            basis.orderValue,
            basis.orderVersion,
          );
        });
      },
    },
    updateInstance: {
      route: seriesUpdateInstance,
      handle(tx, ctx, input, compare) {
        return changeFamily(tx, ctx, input.series, compare.base_revision, (
          current,
        ) => {
          const existing = loadInstance(tx.sql, current.id, input.document);
          if (!existing.ok) return existing;
          if (existing.value === null) {
            return rejected(
              "not_found",
              "member document is not in the series",
            );
          }
          if (input.key !== undefined && input.key !== existing.value.key) {
            const reserved = loadKeyReservation(tx.sql, current.id, input.key);
            if (!reserved.ok) return reserved;
            if (reserved.value !== null) {
              return rejected("conflict", "key is already reserved");
            }
            const membership = listInstances(tx.sql, current.id);
            if (!membership.ok) return membership;
            for (const instance of membership.value) {
              if (instance.key === input.key) {
                return rejected("conflict", "key is already taken");
              }
            }
          }
          if (input.order_version !== undefined) {
            const checkedOrder = checkOrderBasis(
              tx.sql,
              current,
              input.document,
              input.order_version,
            );
            if (!checkedOrder.ok) return checkedOrder;
          }
          return ok(existing.value);
        }, (current, checked) => {
          const before = checked as InstanceRow;
          const seq = tx.emit(seriesInstanceUpdated, current.id, {
            document: input.document,
            before_instance: before,
            instance: {
              series: current.id,
              document: input.document,
              key: input.key ?? before.key,
              order_value: input.order_value ?? before.order_value,
              order_version: input.order_version ?? before.order_version,
              revision: before.revision,
            },
            before_revision: current.revision,
          });
          const next = seriesInstanceSchema.safeParse({
            series: current.id,
            document: input.document,
            key: input.key ?? before.key,
            order_value: input.order_value ?? before.order_value,
            order_version: input.order_version ?? before.order_version,
            revision: seq,
          });
          if (!next.success) {
            return rejected("internal", "series instance is invalid");
          }
          // key 변경은 이전 key 예약을 남기고 새 key 예약을 더한다. 대소문자·공백도
          // 별개 key다. 가입 행은 교체(replace)다.
          insertKeyReservation(
            tx,
            current.id,
            next.data.key,
            input.document,
            seq,
          );
          deleteInstance(tx, current.id, input.document);
          insertInstance(tx, next.data);
          return ok({ ...current, revision: seq });
        });
      },
    },
    removeInstance: {
      route: seriesRemoveInstance,
      handle(tx, ctx, input, compare) {
        if (parseActor(ctx.actor)?.kind !== "user") {
          return rejected("forbidden", "member removal is user only");
        }
        return changeFamily(tx, ctx, input.series, compare.base_revision, (
          current,
        ) => {
          const existing = loadInstance(tx.sql, current.id, input.document);
          if (!existing.ok) return existing;
          if (existing.value === null) {
            return rejected(
              "not_found",
              "member document is not in the series",
            );
          }
          return ok(existing.value);
        }, (current, checked) => {
          const before = checked as InstanceRow;
          const seq = tx.emit(seriesInstanceRemoved, current.id, {
            before_instance: before,
            before_revision: current.revision,
          });
          // 가입 관계만 제거한다. key 예약과 문서·판은 남는다(series#R2, R13).
          deleteInstance(tx, current.id, input.document);
          return ok({ ...current, revision: seq });
        });
      },
    },
    archive: {
      route: seriesArchive,
      handle: (tx, ctx, input, compare) =>
        transition(tx, ctx, input.series, compare.base_revision, "archive"),
    },
    unarchive: {
      route: seriesUnarchive,
      handle: (tx, ctx, input, compare) =>
        transition(tx, ctx, input.series, compare.base_revision, "unarchive"),
    },
  };
}

type SeriesCallback<R> = (current: Series) => Result<R>;
// event와 쓰기는 apply가 한다. apply는 자기 event를 내고 돌아온 seq를 revision으로 둔다(
// contexts·versions precedent). changeFamily는 검사 뒤 apply만 부른다.
type SeriesApply<R> = (
  current: Series,
  checked: R,
) => Result<Series>;

// 공통 가족 변경 앞막이. lophn agent 거절, 존재, 활성 가족, base_revision CAS.
// event와 쓰기는 apply가 한다. apply의 거절은 아무것도 남기지 않는다.
function changeFamily<R>(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  base: string,
  validate: SeriesCallback<R>,
  apply: SeriesApply<R>,
): Result<Series> {
  if (isLophnAgent(ctx)) {
    return rejected("forbidden", "lophn agent cannot change series");
  }
  const current = loadSeries(tx.sql, id);
  if (!current.ok) return current;
  const value = current.value;
  // 앱은 자기 앱 place의 가족만 바꾼다. 다른 자리의 가족은 없는 가족과 같다.
  const app = actingApp(ctx);
  if (value === null || (app !== null && !isAppPlace(app, value.place))) {
    return rejected("not_found", "series not found");
  }
  if (value.status !== "active") {
    return rejected("conflict", "archived series takes no change");
  }
  if (value.revision !== base) {
    return rejected("conflict", "series revision changed");
  }
  const checked = validate(value);
  if (!checked.ok) return checked;
  const applied = apply(value, checked.value);
  if (applied instanceof Promise) {
    return rejected("internal", "series apply is not synchronous");
  }
  if (!applied.ok) return applied;
  const final = applied.value;
  updateSeries(tx, final);
  return ok(final);
}

function transition(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  base: string,
  action: "archive" | "unarchive",
): Result<Series> {
  if (parseActor(ctx.actor)?.kind !== "user") {
    return rejected("forbidden", "archive change is user only");
  }
  const current = loadSeries(tx.sql, id);
  if (!current.ok) return current;
  const value = current.value;
  if (value === null) {
    return rejected("not_found", "series not found");
  }
  if (value.revision !== base) {
    return rejected("conflict", "series revision changed");
  }
  const expected = action === "archive" ? "active" : "archived";
  if (value.status !== expected) {
    return rejected("conflict", "series status changed");
  }
  const seq = tx.emit(
    action === "archive" ? seriesArchived : seriesUnarchived,
    value.id,
    { before_revision: value.revision },
  );
  const next: Series = {
    ...value,
    status: action === "archive" ? "archived" : "active",
    revision: seq,
  };
  updateSeries(tx, next);
  return ok(next);
}

type OrderBasis = {
  document: string;
  order_value: string | number;
  order_version: string;
};

function applyOrderValues(
  tx: Tx,
  series: string,
  instances: readonly OrderBasis[],
  seq: string,
): void {
  for (const instance of instances) {
    const existing = loadInstance(tx.sql, series, instance.document);
    if (!existing.ok || existing.value === null) continue;
    const parsed = seriesInstanceSchema.safeParse({
      ...existing.value,
      order_value: instance.order_value,
      order_version: instance.order_version,
      revision: seq,
    });
    if (!parsed.success) continue;
    deleteInstance(tx, series, instance.document);
    insertInstance(tx, parsed.data);
  }
}

function pickFields(
  record: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    picked[field] = record[field];
  }
  return picked;
}

// event payload의 draft는 output shape다. input draft의 format은 그대로 옮긴다.
function outputDraft(
  draft: SeriesDraft,
): SeriesDraft {
  return {
    document: draft.document,
    key: draft.key,
    base_version: draft.base_version,
    format: draft.format,
    content: draft.content,
  };
}

// 멤버 검사. 같은 자리·같은 format의 확정 문서만 가입한다(series#R2, R3).
function checkMembership(
  tx: Tx,
  current: Series,
  document: string,
): Result<void> {
  const row = loadDocument(tx.sql, document);
  if (!row.ok) return row;
  if (row.value === null) {
    return rejected("invalid_input", "member document needs a stored document");
  }
  const place = row.value.place;
  if (
    place === null || place.kind !== current.place.kind ||
    place.id !== current.place.id
  ) {
    return rejected("invalid_input", "member needs the family place");
  }
  const latest = loadLatestVersion(tx.sql, document);
  if (!latest.ok) return latest;
  if (latest.value === null) {
    return rejected("invalid_input", "member document has no stored version");
  }
  if (latest.value.format.name !== current.format) {
    return rejected("invalid_input", "member format differs");
  }
  return ok(undefined);
}

// format_field 정렬 값의 고정 판 근거를 검사한다. 근거 판은 그 Document의 최신 판이다.
function checkOrderBasis(
  sql: Parameters<typeof loadLatestVersion>[0],
  current: Series,
  document: string,
  order_version: string,
): Result<void> {
  const latest = loadLatestVersion(sql, document);
  if (!latest.ok) return latest;
  if (latest.value === null || latest.value.id !== order_version) {
    return rejected("invalid_input", "order version is not the latest");
  }
  if (latest.value.format.name !== current.format) {
    return rejected("invalid_input", "order version format differs");
  }
  return ok(undefined);
}

// 가입 검사. 이미 멤버·다른 문서가 예약한 key·가족 안 중복 key·자리와 format이다.
// 제거된 key 예약은 남는다. 다른 Document가 같은 key를 다시 쓰면 거절이다(R2, R3).
export function checkJoin(
  tx: Tx,
  current: Series,
  document: string,
  key: string,
): Result<void> {
  const existing = loadInstance(tx.sql, current.id, document);
  if (!existing.ok) return existing;
  if (existing.value !== null) {
    return rejected("conflict", "document is already a member");
  }
  const reserved = loadKeyReservation(tx.sql, current.id, key);
  if (!reserved.ok) return reserved;
  if (reserved.value !== null && reserved.value.document !== document) {
    return rejected("conflict", "key is already reserved");
  }
  const membership = listInstances(tx.sql, current.id);
  if (!membership.ok) return membership;
  for (const instance of membership.value) {
    if (instance.key === key) {
      return rejected("conflict", "key is already taken");
    }
  }
  return checkMembership(tx, current, document);
}

// 가입 확정. 일치 draft(document·key)는 가입과 함께 비운다(T17).
// series.add_instance와 document.save의 가입이 같은 쓰기를 쓴다.
// 돌려주는 가족은 draft·revision이 반영된 값이고 가족 행 갱신은 호출자가 한다.
export function applyJoin(
  tx: Tx,
  current: Series,
  document: string,
  key: string,
  orderValue: string | number | null,
  orderVersion: string | null,
): Result<Series> {
  const draft = current.draft;
  const cleared = draft !== null && draft.document === document &&
    draft.key === key;
  if (cleared) {
    tx.emit(seriesDraftCleared, current.id, {
      before_draft: outputDraft(draft),
      before_revision: current.revision,
    });
  }
  const seq = tx.emit(seriesInstanceAdded, current.id, {
    document,
    key,
    order_value: orderValue,
    order_version: orderVersion,
    before_revision: current.revision,
  });
  const parsed = seriesInstanceSchema.safeParse({
    series: current.id,
    document,
    key,
    order_value: orderValue,
    order_version: orderVersion,
    revision: seq,
  });
  if (!parsed.success) {
    return rejected("internal", "series instance is invalid");
  }
  insertInstance(tx, parsed.data);
  // 첫 예약만 더한다. 남아 있는 예약의 재가입은 같은 first_seq를 유지한다(R2).
  const held = loadKeyReservation(tx.sql, current.id, key);
  if (!held.ok) return held;
  if (held.value === null) {
    insertKeyReservation(tx, current.id, key, document, seq);
  }
  return ok({
    ...current,
    draft: cleared ? null : current.draft,
    revision: seq,
  });
}
