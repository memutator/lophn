// 선언 목록과 값 검사. 키가 겹치면 만들 때 던진다.
import type { z } from "zod";
import {
  type SettingDeclaration,
  type SettingRejection,
} from "../../protocol/config/mod.ts";

export type SettingChange =
  | { key: string; action: "set"; value: unknown }
  | { key: string; action: "unset" };

export interface SettingsRegistry {
  declarations(): readonly SettingDeclaration[];
  get(key: string): SettingDeclaration | undefined;
  /** 거절된 key와 reason. 모두 통과하면 빈 목록이다. 값은 싣지 않는다. */
  validate(changes: readonly SettingChange[]): SettingRejection[];
}

export function createSettingsRegistry(
  list: readonly SettingDeclaration[],
): SettingsRegistry {
  const byKey = new Map<string, SettingDeclaration>();
  for (const declaration of list) {
    if (byKey.has(declaration.key)) {
      throw new Error(`setting declared twice: ${declaration.key}`);
    }
    byKey.set(declaration.key, declaration);
  }
  return {
    declarations: () => list,
    get: (key) => byKey.get(key),
    validate(changes) {
      const rejected: SettingRejection[] = [];
      for (const change of changes) {
        const declaration = byKey.get(change.key);
        if (declaration === undefined) {
          rejected.push({ key: change.key, reason: "unknown_key" });
        } else if (change.action === "set") {
          const reason = rejectionOf(declaration.type, change.value);
          if (reason !== undefined) rejected.push({ key: change.key, reason });
        }
      }
      return rejected;
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
