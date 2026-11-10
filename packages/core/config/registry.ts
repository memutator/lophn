// 선언 목록과 값 검사. 키가 겹치면 만들 때 던진다.
import type { z } from "zod";
import {
  SETTING_ENTRY_ID,
  type SettingDeclaration,
  type SettingFolderDeclaration,
  type SettingNote,
  type SettingRejection,
  type SettingsView,
} from "../../protocol/config/mod.ts";

export type SettingChange =
  | { key: string; action: "set"; value: unknown }
  | { key: string; action: "unset" };

/** folder 설정의 항목 하나를 가리킨다. */
export interface SettingEntryRef {
  readonly folder: SettingFolderDeclaration;
  readonly id: string;
}

export interface SettingsRegistry {
  declarations(): readonly SettingDeclaration[];
  folders(): readonly SettingFolderDeclaration[];
  get(key: string): SettingDeclaration | undefined;
  /** `<folder key>.<id>` 꼴이고 id가 규칙에 맞으면 그 항목이다. */
  entry(key: string): SettingEntryRef | undefined;
  /** 사람만 바꾸는 key인가. 모르는 key는 false다(unknown_key로 거절된다). */
  locked(key: string): boolean;
  /** 거절된 key와 reason. 모두 통과하면 빈 목록이다. 값은 싣지 않는다. type만 본다. */
  validate(changes: readonly SettingChange[]): SettingRejection[];
  /** type을 통과한 변경의 뜻 검사. view는 변경을 모두 적용한 뒤의 값이다. */
  check(
    changes: readonly SettingChange[],
    view: SettingsView,
  ): { rejected: SettingRejection[]; notes: SettingNote[] };
}

export function createSettingsRegistry(
  list: readonly SettingDeclaration[],
  folderList: readonly SettingFolderDeclaration[] = [],
): SettingsRegistry {
  const byKey = new Map<string, SettingDeclaration>();
  for (const declaration of list) {
    if (byKey.has(declaration.key)) {
      throw new Error(`setting declared twice: ${declaration.key}`);
    }
    byKey.set(declaration.key, declaration);
  }
  const folderNames = new Set<string>();
  for (const folder of folderList) {
    // 항목 key가 다른 선언의 key와 겹치지 않게 folder key 아래에는 선언을 두지 않는다.
    const clash = [...byKey.keys()].find(
      (key) => key === folder.key || key.startsWith(`${folder.key}.`),
    );
    if (clash !== undefined || folderNames.has(folder.folder)) {
      throw new Error(`setting folder declared twice: ${folder.key}`);
    }
    folderNames.add(folder.folder);
  }
  const entry = (key: string): SettingEntryRef | undefined => {
    for (const folder of folderList) {
      if (!key.startsWith(`${folder.key}.`)) continue;
      const id = key.slice(folder.key.length + 1);
      return SETTING_ENTRY_ID.test(id) ? { folder, id } : undefined;
    }
    return undefined;
  };
  return {
    declarations: () => list,
    folders: () => folderList,
    get: (key) => byKey.get(key),
    entry,
    locked: (key) =>
      (byKey.get(key)?.locked ?? entry(key)?.folder.locked) === true,
    validate(changes) {
      const rejected: SettingRejection[] = [];
      for (const change of changes) {
        const type =
          byKey.get(change.key)?.type ?? entry(change.key)?.folder.type;
        if (type === undefined) {
          rejected.push({ key: change.key, reason: "unknown_key" });
        } else if (change.action === "set") {
          const reason = rejectionOf(type, change.value);
          if (reason !== undefined) rejected.push({ key: change.key, reason });
        }
      }
      return rejected;
    },
    check(changes, view) {
      const rejected: SettingRejection[] = [];
      const notes: SettingNote[] = [];
      for (const change of changes) {
        if (change.action !== "set") continue;
        const declaration = byKey.get(change.key);
        const ref = declaration === undefined ? entry(change.key) : undefined;
        const issues =
          declaration !== undefined
            ? (declaration.check?.(
                declaration.type.parse(change.value),
                view,
              ) ?? [])
            : ref !== undefined
              ? (ref.folder.check?.(
                  ref.folder.type.parse(change.value),
                  view,
                  ref.id,
                ) ?? [])
              : [];
        const refusal = issues.find((issue) => issue.level === "reject");
        if (refusal !== undefined) {
          rejected.push({
            key: change.key,
            reason: "invalid_value",
            message: refusal.message,
          });
          continue;
        }
        for (const issue of issues) {
          notes.push({ key: change.key, message: issue.message });
        }
      }
      return { rejected, notes };
    },
  };
}

/** 값이 선언의 type을 통과하는지. 통과하면 undefined다. */
function rejectionOf(
  type: z.ZodType,
  value: unknown,
): SettingRejection["reason"] | undefined {
  const parsed = type.safeParse(value);
  if (parsed.success) return undefined;
  switch (parsed.error.issues[0]?.code) {
    case "invalid_type":
      return "wrong_type";
    case "too_small":
    case "too_big":
    case "invalid_value":
      return "out_of_range";
    default:
      return "invalid_value";
  }
}
