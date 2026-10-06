// 이전 release와의 비교(apps/releases#R9, R10, R11, R18). 고정 blueprint 둘의 정적 비교다.
// 같은 입력 schema라는 이유로 호환을 주장하지 않는다: 효과·확인·되돌림이 바뀌면 동작 변경이고,
// 이름·설명만 바뀐 것은 따로 낸다. 업무 의미의 동일성은 증명하지 않으므로 바뀐 것이 있으면
// `review_required`다. 데이터 계약은 apps/data 근거(`data_schema`·`data_changes`), 접근 요청은
// apps/permissions 근거(`added_permissions`)로 나눠 낸다.
import {
  type Blueprint,
  canonicalJson,
  type CommandDeclaration,
  type InputSchema,
} from "../blueprint/mod.ts";
import type {
  CommandChange,
  DataChange,
  ReleaseComparison,
} from "../../contracts/apps/mod.ts";
import { permissionLabel } from "./facts.ts";

export type ComparedRelease = {
  id: string;
  blueprint: Blueprint;
  data_schema: number;
};

function same(a: unknown, b: unknown): boolean {
  return canonicalJson(a as never) === canonicalJson(b as never);
}

function requiredOf(schema: InputSchema | null): string[] {
  return schema === null ? [] : [...(schema.required ?? [])];
}

// 이전 command에 없던 필수 입력 이름. 이전 입력이 없던 명령이 필수 입력을 얻어도 포함한다.
function newRequiredInputs(
  before: CommandDeclaration,
  after: CommandDeclaration,
): string[] {
  const had = new Set(requiredOf(before.input));
  return requiredOf(after.input).filter((name) => !had.has(name)).sort();
}

function commandChange(
  before: CommandDeclaration,
  after: CommandDeclaration,
): CommandChange | undefined {
  const kinds: CommandChange["kinds"] = [];
  if (!same(before.input, after.input)) kinds.push("input");
  if (before.effect !== after.effect) kinds.push("effect");
  if (before.confirm !== after.confirm) kinds.push("confirm");
  if (!same(before.revert, after.revert)) kinds.push("revert");
  if (kinds.length === 0) return undefined;
  return {
    command: after.key,
    kinds,
    effect_from: before.effect === after.effect ? null : before.effect,
    effect_to: before.effect === after.effect ? null : after.effect,
    new_required_inputs: newRequiredInputs(before, after),
  };
}

function byKey<T extends { key: string }>(
  values: readonly T[],
): Map<string, T> {
  return new Map(values.map((value) => [value.key, value]));
}

function diffKeys<T extends { key: string }>(
  before: readonly T[],
  after: readonly T[],
  equal: (a: T, b: T) => boolean,
): { added: string[]; removed: string[]; changed: string[] } {
  const was = byKey(before);
  const now = byKey(after);
  const added = [...now.keys()].filter((key) => !was.has(key)).sort();
  const removed = [...was.keys()].filter((key) => !now.has(key)).sort();
  const changed = [...now.keys()].filter((key) => {
    const old = was.get(key);
    return old !== undefined && !equal(old, now.get(key)!);
  }).sort();
  return { added, removed, changed };
}

export function compareReleases(input: {
  previous: ComparedRelease | null;
  blueprint: Blueprint;
  data_schema: number;
  data_changes: readonly DataChange[];
}): ReleaseComparison {
  const { previous, blueprint } = input;
  const before: Blueprint | null = previous?.blueprint ?? null;
  const beforeCommands = before?.commands ?? [];
  const wasPermissions = new Set(
    (before?.permissions ?? []).map(permissionLabel),
  );
  const nowPermissions = new Set(blueprint.permissions.map(permissionLabel));
  const commands = diffKeys(
    beforeCommands,
    blueprint.commands,
    (a, b) =>
      a.label === b.label && a.description === b.description &&
      commandChange(a, b) === undefined,
  );
  const commandChanges: CommandChange[] = [];
  const descriptionOnly: string[] = [];
  const was = byKey(beforeCommands);
  for (const command of blueprint.commands) {
    const old = was.get(command.key);
    if (old === undefined) continue;
    const change = commandChange(old, command);
    if (change !== undefined) commandChanges.push(change);
    else if (
      old.label !== command.label || old.description !== command.description
    ) descriptionOnly.push(command.key);
  }
  commandChanges.sort((a, b) => a.command.localeCompare(b.command));
  const external = blueprint.commands.filter((command) => {
    if (command.effect !== "external") return false;
    return was.get(command.key)?.effect !== "external";
  }).map((command) => command.key).sort();
  const automations = diffKeys(
    before?.automatic_tasks ?? [],
    blueprint.automatic_tasks,
    (a, b) =>
      a.label === b.label && a.command === b.command &&
      same(a.when, b.when) && same(a.input ?? null, b.input ?? null),
  );
  const screens = diffKeys(
    before?.screens ?? [],
    blueprint.screens,
    (a, b) =>
      a.label === b.label && a.path === b.path && same(a.sizes, b.sizes),
  );
  // 열린 problem 여부는 problems의 몫이다. 선언이 삭제되거나 바뀐 code를 모두 경고로 올리고
  // 이것은 문제를 고쳤다는 근거도 닫힘도 아니다(R18).
  const warnings: string[] = [];
  const nowCodes = new Map(
    blueprint.problem_codes.map((entry) => [entry.code, entry]),
  );
  for (const old of before?.problem_codes ?? []) {
    const current = nowCodes.get(old.code);
    if (current === undefined) warnings.push(`removed:${old.code}`);
    else if (!same(old, current)) warnings.push(`changed:${old.code}`);
  }
  warnings.sort();
  const comparison: ReleaseComparison = {
    previous_release: previous?.id ?? null,
    added_permissions: [...nowPermissions].filter((label) =>
      !wasPermissions.has(label)
    ).sort(),
    removed_permissions: [...wasPermissions].filter((label) =>
      !nowPermissions.has(label)
    ).sort(),
    added_commands: commands.added,
    removed_commands: commands.removed,
    changed_commands: commandChanges.map((change) => change.command),
    command_changes: commandChanges,
    external_commands: external,
    description_only_commands: descriptionOnly.sort(),
    added_automations: automations.added,
    removed_automations: automations.removed,
    changed_automations: automations.changed,
    added_screens: screens.added,
    removed_screens: screens.removed,
    changed_screens: screens.changed,
    added_problem_code_warnings: warnings,
    data_schema: { from: previous?.data_schema ?? 0, to: input.data_schema },
    data_changes: [...input.data_changes],
    review_required: false,
  };
  comparison.review_required = previous === null || reviewNeeded(comparison);
  return comparison;
}

// 동작·접근·자동 실행·화면·데이터가 바뀐 것이 있으면 사람이 본다. 설명만 바뀐 것은 해당하지 않는다.
function reviewNeeded(comparison: ReleaseComparison): boolean {
  return comparison.added_permissions.length > 0 ||
    comparison.removed_permissions.length > 0 ||
    comparison.added_commands.length > 0 ||
    comparison.removed_commands.length > 0 ||
    comparison.changed_commands.length > 0 ||
    comparison.added_automations.length > 0 ||
    comparison.removed_automations.length > 0 ||
    comparison.changed_automations.length > 0 ||
    comparison.added_screens.length > 0 ||
    comparison.removed_screens.length > 0 ||
    comparison.changed_screens.length > 0 ||
    comparison.added_problem_code_warnings.length > 0 ||
    comparison.data_changes.length > 0 ||
    comparison.data_schema.from !== comparison.data_schema.to;
}
