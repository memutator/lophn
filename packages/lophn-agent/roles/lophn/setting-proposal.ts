import type {
  EffectiveSetting,
  SettingApplyAt,
  SettingDefinitionOutput,
} from "@lophn/contracts/platform";
import type { QuestionOption } from "@lophn/contracts/lophn-agent";
import { canonicalize } from "@lophn/base";
import { protectedSetting, settingsOptionAction } from "../../questions/mod.ts";
import { oneLine } from "./place-recommendation.ts";

// lophn의 설정 변경 제안(roles/lophn#R21, R22). 순수 함수다. 변경은 현재 값·새 값·영향·적용
// 시점이 고정된 선택지와 추천을 붙인 질문으로만 묻는다. 실제 적용은 사람이 고른 뒤 machine이
// 소유 command(ApplySettings)로 한다(questions#R13). 자유 답·침묵·추천은 어느 경로에도 action이
// 없으므로 값을 바꾸지 못한다. 권한 확대·secret 등록·외부 효과 설정은 선택지를 만들지 않고
// 소유 concern의 보호 화면을 안내한다(R22).

const APPLY_WORDS: Record<SettingApplyAt, string> = {
  next_run: "It takes effect from the next run.",
  current_check: "It takes effect at the next check of the current work.",
  next_call: "It takes effect from the next call.",
};

// 보호 화면의 사람이 읽는 이름.
const SCREEN_WORDS: Record<string, string> = {
  "platform/secrets": "the protected secret entry",
  "apps/permissions": "the app permissions screen",
  "lophn-agent/extensions": "the extensions screen",
  "coding-agent/harnesses": "the coding agent connection screen",
};

export type SettingQuestionDraft = {
  key: string;
  prompt: string;
  reason: string;
  options: QuestionOption[];
  recommendation: { option_key: string; explanation: string };
  // 사람이 화면에서 풀어 읽을 wording key. 문장으로 바꾸지 않고 그대로 싣는다.
  notes: { riskKey: string; revertKey: string };
};

export type SettingProposal =
  | { kind: "question"; draft: SettingQuestionDraft }
  // 보호 화면으로 안내한다. 선택지가 없다.
  | {
    kind: "protected";
    screen: string;
    guidance: string;
    options: [];
  }
  | { kind: "no_change" }
  | { kind: "unresolved" }
  | { kind: "mismatch" };

// 보호 설정은 일반 선택지로 우회하지 않고 소유 화면을 알려 준다.
export function protectedGuidance(
  definition: Pick<SettingDefinitionOutput, "key" | "description">,
): { screen: string; guidance: string } | null {
  const guarded = protectedSetting(definition.key);
  if (guarded === null) return null;
  const where = SCREEN_WORDS[guarded.screen] ?? guarded.screen;
  return {
    screen: guarded.screen,
    guidance:
      `This setting changes access, a secret or something outside lophn, so it can only be changed on ${where}. Open it there and check the change yourself.`,
  };
}

function show(value: unknown): string {
  return canonicalize(value);
}

export function settingChangeQuestion(input: {
  question: string;
  definition: SettingDefinitionOutput;
  effective: EffectiveSetting;
  newValue: unknown;
  revision: number;
  defaults_revision: string;
  // 이 값을 추천하는 이유. 한 줄로 접는다.
  why: string;
}): SettingProposal {
  const { definition, effective } = input;
  if (definition.key !== effective.key) return { kind: "mismatch" };
  const guarded = protectedGuidance(definition);
  if (guarded !== null) {
    return { kind: "protected", ...guarded, options: [] };
  }
  if (!effective.resolved) return { kind: "unresolved" };
  if (show(effective.value) === show(input.newValue)) {
    return { kind: "no_change" };
  }
  const action = settingsOptionAction({
    question: input.question,
    changes: [{
      layer: "common",
      key: definition.key,
      action: "set",
      value: input.newValue as never,
    }],
    revision: input.revision,
    defaults_revision: input.defaults_revision,
  });
  const impact = `It affects ${definition.affected_features.join(", ")}.`;
  const options: QuestionOption[] = [
    {
      key: "change",
      label: "Change it",
      description: `Change ${definition.key} from ${show(effective.value)} to ${
        show(input.newValue)
      }. ${definition.description} ${impact} ${
        APPLY_WORDS[definition.apply_at]
      }`,
      evidence: [],
      adoption: null,
      action,
    },
    {
      key: "keep",
      label: "Keep it as it is",
      description: `Keep ${definition.key} at ${
        show(effective.value)
      }. Nothing changes.`,
      evidence: [],
      adoption: null,
      action: null,
    },
  ];
  return {
    kind: "question",
    draft: {
      key: definition.key,
      prompt: `Change ${definition.key}?`,
      reason: `${definition.description} It is ${show(effective.value)} now.`,
      options,
      recommendation: {
        option_key: "change",
        explanation: oneLine(input.why),
      },
      notes: {
        riskKey: definition.risk_key,
        revertKey: definition.revert_key,
      },
    },
  };
}
