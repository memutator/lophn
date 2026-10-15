import { z } from "zod";
import { canonicalize, err, ok, type Result } from "../../../../base/mod.ts";
import type { OptionAction } from "../../../../protocol/lophn-agent/mod.ts";
import {
  settingsDefinitions,
  settingsGet,
} from "../../../../protocol/config/mod.ts";
import { protectedSetting, settingsOptionAction } from "../questions/mod.ts";
import type { ContractCall } from "./common.ts";
import { bodyOf } from "./paging.ts";

// 질문 선택지의 고정 action을 모델이 싣지 않고 handler가 읽은 근거로 고정한다(question.submit).
// 모델은 대상과 새 값만 제안한다. 현재 값·revision·비교 기준은 여기서 소유 contract의 읽기로
// 얻고, 사람이 고르기 전에는 아무것도 바뀌지 않는다. 적용은 사람이
// 답을 확정한 뒤 machine이 소유 command로 한다.

// 설정 하나를 새 값으로 바꾸는 제안. 키와 값만 모델 몫이다.
export const fixedSettingChange = z.strictObject({
  key: z.string().regex(/\S/),
  value: z.json(),
});

type Run = { ports: ContractCall; run: string };

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

type SettingRead = {
  key: string;
  resolved?: boolean;
  value?: unknown;
};

export async function settingChangeAction(
  { ports, run }: Run,
  question: string,
  proposed: z.infer<typeof fixedSettingChange>,
): Promise<Result<OptionAction>> {
  if (protectedSetting(proposed.key) !== null) {
    return invalid("this setting is changed on its own screen");
  }
  const keys = { keys: [proposed.key] };
  const definitions = await ports.call(settingsDefinitions.name, keys, run);
  if (!definitions.ok) return definitions;
  const defined = bodyOf(definitions.value);
  const found = (defined["definitions"] as { key: string }[] | undefined)
    ?.some((definition) => definition.key === proposed.key);
  if (found !== true) {
    return err({ code: "not_found", message: "setting not found" });
  }
  const current = await ports.call(settingsGet.name, keys, run);
  if (!current.ok) return current;
  const body = bodyOf(current.value);
  const effective = (body["settings"] as SettingRead[] | undefined)?.find((
    setting,
  ) => setting.key === proposed.key);
  if (effective === undefined || effective.resolved !== true) {
    return invalid("the setting has no current value to change from");
  }
  if (canonicalize(effective.value) === canonicalize(proposed.value)) {
    return invalid("the setting already has this value");
  }
  return ok(settingsOptionAction({
    question,
    changes: [{
      layer: "common",
      key: proposed.key,
      action: "set",
      value: proposed.value,
    }],
    revision: body["revision"] as number,
    defaults_revision: defined["defaults_revision"] as string,
  }));
}
