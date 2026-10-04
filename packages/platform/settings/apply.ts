// settings apply·reload·history의 command handler와 read(platform/settings#R17-R25).
// TOML parse와 큰 검증 준비는 command 밖에서 한다(domain model command 표).

import { err, ok, type Result } from "../../base/mod.ts";
import {
  applySettings,
  reloadSettings,
  type SettingChoice,
  type SettingDefinition,
  type SettingMutation,
  settingsChanged,
  settingsHistory,
  settingsReloaded,
  type SettingsRevision,
} from "../../contracts/platform/mod.ts";
import type {
  CommandDefinition,
  ReadDefinition,
  RequestContext as _RequestContext,
  Tx,
} from "../../contracts/platform/mod.ts";
import { validateChoice, validateConstraints } from "./model.ts";
import type { SettingRegistry } from "./registry.ts";

// settings_state는 현재 적용 판 singleton이다(domain model ledger 표).
type StateRow = { revision: number; defaults_revision: string };

function readState(tx: Tx): StateRow {
  const row = tx.sql.get(
    "select revision, defaults_revision from settings_state where key = 1",
    [],
  );
  // 선택 없는 시작은 row가 없다. revision 0으로 본다(domain model).
  return row === undefined ? { revision: 0, defaults_revision: "pending" } : {
    revision: Number(row["revision"]),
    defaults_revision: String(row["defaults_revision"]),
  };
}

// 편집을 시작한 판이 현재 판이어야 한다(R19). 충돌하면 현재 판을 알려 다시 확인하게 한다.
function compareAgrees(
  state: StateRow,
  compare: { revision: number; defaults_revision: string },
): Result<void> {
  if (state.revision !== compare.revision) {
    return err({
      code: "conflict",
      message: "편집을 시작한 판이 현재 판이 아니다",
      details: { current_revision: state.revision },
    });
  }
  return ok(undefined);
}

function loadChoices(
  sql: Tx["sql"],
  keys?: readonly string[],
): { layer: "common"; key: string; value: unknown }[] {
  if (keys === undefined) {
    return sql.all(
      "select layer, key, value from setting_choices order by key",
      [],
    ).map(choiceRow);
  }
  return keys.flatMap((key) =>
    sql.all(
      "select layer, key, value from setting_choices where key = ?",
      [key],
    ).map(choiceRow)
  );
}

function choiceRow(row: Record<string, unknown>): {
  layer: "common";
  key: string;
  value: unknown;
} {
  return {
    layer: "common",
    key: String(row["key"]),
    value: JSON.parse(String(row["value"])),
  };
}

// 영향 concern은 공개 설정 registry가 계산한다(domain model SettingsRevision).
function affectedConcerns(
  registry: SettingRegistry,
  keys: readonly string[],
): string[] {
  const owners = new Set<string>();
  for (const key of keys) {
    const definition = registry.definition(key);
    if (definition !== undefined) owners.add(definition.owner);
  }
  return [...owners].sort();
}

// 같은 layer·key 중복과 모르는 항목을 먼저 거절한다(R12, R18).
function prepareMutations(
  registry: SettingRegistry,
  mutations: readonly SettingMutation[],
): Result<Map<string, SettingMutation>> {
  const prepared = new Map<string, SettingMutation>();
  for (const mutation of mutations) {
    if (registry.has(mutation.key) === false) {
      return err({
        code: "invalid_input",
        message: "등록되지 않은 설정 항목이다",
        details: { key: mutation.key },
      });
    }
    if (prepared.has(mutation.key)) {
      return err({
        code: "invalid_input",
        message: "같은 항목의 변경이 두 개다",
        details: { key: mutation.key },
      });
    }
    prepared.set(mutation.key, mutation);
  }
  return ok(prepared);
}

// 모든 영향 concern의 적용값까지 검증한 뒤 전부 저장 또는 전부 거절한다(R17, R18).
// apply는 사람의 명시 apply만 받는다. agent 제안·문서 변경은 이 route에 오지 않는다(R17).
export function createSettingsCommands(
  registry: SettingRegistry,
): {
  apply: CommandDefinition<typeof applySettings>;
  reload: CommandDefinition<typeof reloadSettings>;
} {
  return {
    apply: {
      route: applySettings,
      handle(tx, ctx, input, compare) {
        // apply는 user만이다(route actors). machine reload와 구별한다(R17).
        const actor = ctx.actor;
        if (actor !== "user" && !actor.startsWith("user:")) {
          return err({
            code: "forbidden",
            message: "설정 apply는 user만 한다",
          });
        }
        if (compare === undefined || compare === null) {
          return err({
            code: "invalid_input",
            message: "적용 기준 revision이 없다",
          });
        }
        const base = compare as { revision: number; defaults_revision: string };
        if (base.defaults_revision !== registry.defaultsRevision) {
          return err({
            code: "conflict",
            message: "설정 registry 판이 바뀌었다. 다시 읽고 편집한다",
          });
        }
        const state = readState(tx);
        const agreed = compareAgrees(state, {
          ...base,
          revision: base.revision,
        });
        if (!agreed.ok) return agreed;
        const prepared = prepareMutations(registry, input.changes);
        if (!prepared.ok) return prepared;
        const mutations = prepared.value;
        // 각 변경을 choice schema로 검사한다(R11, R15).
        const validated: {
          mutation: SettingMutation;
          choice: SettingChoice | undefined;
        }[] = [];
        for (const mutation of mutations.values()) {
          if (mutation.action === "delete") {
            validated.push({ mutation, choice: undefined });
            continue;
          }
          const checked = validateChoice(registry.definitions, {
            layer: "common",
            key: mutation.key,
            value: mutation.value,
          });
          if (!checked.ok) return checked;
          validated.push({ mutation, choice: checked.value.choice });
        }
        // 병합 뒤 필수값·항목 관계 검사(R11 후반). 현재 선택·기본값·새 선택으로 effective를 본다.
        const beforeChoices = new Map(
          loadChoices(tx.sql, [...mutations.keys()]).map((choice) => [
            choice.key,
            choice.value,
          ]),
        );
        const appliedKeys = [...mutations.keys()];
        for (const key of appliedKeys) {
          const mutation = mutations.get(key)!;
          const definition = registry.definition(key)!;
          // apply 뒤 이 항목의 값. delete는 선택이 없어진다.
          const after = mutation.action === "set" ? mutation.value : undefined;
          if (after === undefined) {
            // 선택 삭제는 낮은 층을 따른다(R9). builtin 기본값이 없으면 검사하지 않는다.
            if (!definition.default_present) continue;
            const checked = validateResolved(
              definition,
              definition.default,
            );
            if (!checked.ok) return checked;
            continue;
          }
          const checked = validateResolved(definition, after);
          if (!checked.ok) return checked;
        }
        // 같은 내용으로 다시 apply하면 새 판이 아니다(R20).
        const changed = validated.some(({ mutation, choice }) => {
          const before = beforeChoices.get(mutation.key);
          if (mutation.action === "delete") return before !== undefined;
          return JSON.stringify(before) !== JSON.stringify(choice?.value);
        });
        if (!changed) {
          return ok({
            revision: state.revision,
            changed: false,
            applied: [],
          });
        }
        // 바뀐 항목만 revision에 남긴다(R20).
        const changedMutations = validated.filter(({ mutation, choice }) => {
          const before = beforeChoices.get(mutation.key);
          if (mutation.action === "delete") return before !== undefined;
          return JSON.stringify(before) !== JSON.stringify(choice?.value);
        });
        const revision = state.revision + 1;
        const concerns = affectedConcerns(
          registry,
          changedMutations.map((
            { mutation },
          ) => mutation.key),
        );
        ensureInitialRecord(tx, registry);
        const changes = changedMutations.map(({ mutation, choice }) => ({
          layer: "common" as const,
          key: mutation.key,
          before_present: beforeChoices.has(mutation.key),
          action: mutation.action,
          before: (beforeChoices.get(mutation.key) ?? null) as never,
          after: (mutation.action === "set" ? choice?.value : null) as never,
        }));
        tx.emit(settingsChanged, null, {
          revision,
          changes,
          affected_concerns: concerns,
          applied: appliedKeys.map((key) => ({
            key,
            apply_at: registry.definition(key)!.apply_at,
          })),
        });
        tx.sql.run(
          "insert into setting_revisions (revision, previous_revision, changes, affected_concerns, defaults_revision, actor, at) values (?, ?, ?, ?, ?, ?, ?)",
          [
            revision,
            state.revision,
            JSON.stringify(changes),
            JSON.stringify(concerns),
            registry.defaultsRevision,
            ctx.actor,
            tx.now(),
          ],
        );
        // 선택 원본은 setting_choices에만 둔다(R2). 적용값을 다시 저장하지 않는다.
        for (const { mutation, choice } of changedMutations) {
          if (mutation.action === "delete") {
            tx.sql.run(
              "delete from setting_choices where layer = 'common' and key = ?",
              [mutation.key],
            );
            continue;
          }
          tx.sql.run(
            "insert into setting_choices (layer, key, value) values ('common', ?, ?) on conflict (layer, key) do update set value = excluded.value",
            [mutation.key, JSON.stringify(choice?.value)],
          );
        }
        const recorded: StateRow = {
          revision,
          defaults_revision: registry.defaultsRevision,
        };
        if (state.revision === 0 && !stateExists(tx)) {
          tx.sql.run(
            "insert into settings_state (key, revision, defaults_revision) values (1, ?, ?)",
            [recorded.revision, recorded.defaults_revision],
          );
        } else {
          tx.sql.run(
            "update settings_state set revision = ?, defaults_revision = ? where key = 1",
            [recorded.revision, recorded.defaults_revision],
          );
        }
        return ok({
          revision,
          changed: true,
          applied: appliedKeys.map((key) => ({
            key,
            apply_at: registry.definition(key)!.apply_at,
          })),
        });
      },
    },
    reload: {
      route: reloadSettings,
      handle(tx, ctx, _input, _compare) {
        // reload는 user·machine이다(route actors).
        const actor = ctx.actor;
        if (
          actor !== "user" && actor !== "machine" && !actor.startsWith("user:")
        ) {
          return err({
            code: "forbidden",
            message: "설정 reload는 user·machine만 한다",
          });
        }
        const state = readState(tx);
        // reload는 저장 선택과 현재 내장 기본값을 처음부터 병합해 통째로 교체한다(R21).
        const choices = loadChoices(tx.sql);
        const keys = choices.map((choice) => choice.key);
        for (const choice of choices) {
          const definition = registry.definition(choice.key);
          // 저장 선택이 현재 registry에 없으면 전체를 거절하고 마지막 성공 판을 유지한다(R22).
          if (definition === undefined) {
            return err({
              code: "invalid_input",
              message: "저장 선택이 현재 registry에 없다",
              details: {
                validation: registry.validation(
                  choice.key,
                  "registered setting",
                  "저장된 선택을 지우거나 registry에 항목을 되돌린다",
                ),
              },
            });
          }
          const checked = validateChoice(registry.definitions, choice);
          if (!checked.ok) return checked;
          // 병합 뒤 범위를 다시 검사한다(R22). 기본값이 바뀌어도 마지막 성공 판을 유지한다.
          if (definition.default_present) {
            const range = validateConstraints(definition, choice.value);
            if (!range.ok) return range;
          }
        }
        // 선택과 registry 판이 마지막 성공 판과 같으면 새 판이 아니다(R20).
        if (state.defaults_revision === registry.defaultsRevision) {
          return ok({
            revision: state.revision,
            changed: false,
            applied: [],
          });
        }
        // 여기까지 오면 현재 선택·기본값이 검증을 모두 통과했다. 실패면 위에서 이미 거절했다(R22).
        const revision = state.revision + 1;
        const concerns = affectedConcerns(registry, keys);
        ensureInitialRecord(tx, registry);
        tx.emit(settingsReloaded, null, {
          revision,
          defaults_revision: registry.defaultsRevision,
          keys,
          affected_concerns: concerns,
          applied: keys.map((key) => ({
            key,
            apply_at: registry.definition(key)!.apply_at,
          })),
        });
        tx.sql.run(
          "insert into setting_revisions (revision, previous_revision, changes, affected_concerns, defaults_revision, actor, at) values (?, ?, ?, ?, ?, ?, ?)",
          [
            revision,
            state.revision,
            JSON.stringify([]),
            JSON.stringify(concerns),
            registry.defaultsRevision,
            ctx.actor,
            tx.now(),
          ],
        );
        replaceState(tx, {
          revision,
          defaults_revision: registry.defaultsRevision,
        });
        return ok({
          revision,
          changed: true,
          applied: keys.map((key) => ({
            key,
            apply_at: registry.definition(key)!.apply_at,
          })),
        });
      },
    },
  };
}

function stateExists(tx: Tx): boolean {
  return tx.sql.get("select key from settings_state where key = 1", []) !==
    undefined;
}

// 선택 없는 시작 revision 0은 초기 record다(domain model settings_state).
// previous_revision의 FK가 revision 0 행을 보므로 첫 apply·reload 기록 전에 심는다.
function ensureInitialRecord(tx: Tx, registry: SettingRegistry): void {
  const row = tx.sql.get(
    "select revision from setting_revisions where revision = 0",
    [],
  );
  if (row !== undefined) return;
  tx.sql.run(
    "insert into setting_revisions (revision, previous_revision, changes, affected_concerns, defaults_revision, actor, at) values (0, null, '[]', '[]', ?, 'machine', ?)",
    [registry.defaultsRevision, tx.now()],
  );
}

function replaceState(tx: Tx, state: StateRow): void {
  if (stateExists(tx)) {
    tx.sql.run(
      "update settings_state set revision = ?, defaults_revision = ? where key = 1",
      [state.revision, state.defaults_revision],
    );
    return;
  }
  tx.sql.run(
    "insert into settings_state (key, revision, defaults_revision) values (1, ?, ?)",
    [state.revision, state.defaults_revision],
  );
}

// apply 뒤 적용값에 대한 병합 뒤 검사(R11 후반). 저장된 데이터로 다시 본다.
function validateResolved(
  definition: SettingDefinition,
  value: unknown,
): Result<void> {
  return validateConstraints(definition, value);
}

export function settingsHistoryRead(
  _registry: SettingRegistry,
): ReadDefinition<typeof settingsHistory> {
  return {
    route: settingsHistory,
    handle(snapshot, _ctx, input) {
      const limit = input.limit ?? 100;
      const after = input.after_revision;
      const rows = after === undefined
        ? snapshot.sql.all(
          "select revision, previous_revision, changes, affected_concerns, defaults_revision, actor, at from setting_revisions order by revision desc limit ?",
          [limit],
        )
        : snapshot.sql.all(
          "select revision, previous_revision, changes, affected_concerns, defaults_revision, actor, at from setting_revisions where revision > ? order by revision desc limit ?",
          [after, limit],
        );
      // 첫 시작과 unchanged reload는 setting_revisions에 row가 없다(R20, R23).
      const revisions = rows.map((row) => settingRevision(row));
      return ok({
        revisions,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  };
}

function settingRevision(row: Record<string, unknown>): SettingsRevision {
  return {
    revision: Number(row["revision"]),
    previous_revision: row["previous_revision"] === null
      ? null
      : Number(row["previous_revision"]),
    changes: JSON.parse(String(row["changes"])) as never,
    affected_concerns: JSON.parse(String(row["affected_concerns"])),
    defaults_revision: String(row["defaults_revision"]),
    actor: String(row["actor"]) as never,
    at: String(row["at"]),
  };
}
