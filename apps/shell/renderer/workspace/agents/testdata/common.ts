// Agents 탭과 Operator editor test가 함께 쓰는 입력. project phroner와 model 선택, 출처, 이름 풀이 fake다.
import type { ValueSource } from "../../../../../../packages/protocol/lophn-agent/agent-values.ts";
import type { ModelChoice } from "../../../../../../packages/protocol/lophn-agent/models.ts";
import { ANTHROPIC } from "../../../conversation/testdata/model-picker.ts";
import type { ImageSrc, ModelLabel } from "../views.ts";

// 카드와 editor가 같은 agent를 가리키는 assignment id.
export const LOPHN_ID = "asg_01arz3ndektsv4rrffq69g5fa1";
export const ENGINEER_ID = "asg_01arz3ndektsv4rrffq69g5fa2";
export const RELEASE_ID = "asg_01arz3ndektsv4rrffq69g5fa3";
export const DIGEST_ID = "asg_01arz3ndektsv4rrffq69g5fa4";

export const PROJECT_NAME = "phroner";
export const PROJECT_ID = "prj_01arz3ndektsv4rrffq69g5fa1";

export const PROJECT_PLACE = { kind: "project", id: PROJECT_ID } as const;
export const FROM_WORKSPACE: ValueSource = { layer: "workspace", place: null };
export const FROM_PROJECT: ValueSource = {
  layer: "place",
  place: PROJECT_PLACE,
};

export const SONNET_MEDIUM: ModelChoice = {
  provider: ANTHROPIC,
  model_name: "Sonnet 5.5",
  option_values: { effort: "medium" },
};
export const HAIKU_PLAIN: ModelChoice = {
  provider: ANTHROPIC,
  model_name: "Haiku 5.5",
  option_values: {},
};

/** "Sonnet 5.5 · Medium": model 이름 뒤에 effort 값을 이어 붙인다. catalog가 하는 일을 이 fake가 흉내 낸다. */
export const modelLabel: ModelLabel = (choice) => {
  const effort = choice.option_values.effort;
  return effort === undefined
    ? choice.model_name
    : `${choice.model_name} · ${effort[0].toUpperCase()}${effort.slice(1)}`;
};

export const imageSrc: ImageSrc = (assignment, image) =>
  `lophn-agent://profiles/${assignment}/${image}`;

/** LOPHN.md. 첫 줄만 탭에 보인다. */
export const LOPHN_MD = [
  "# phroner",
  "Answer in short paragraphs.",
  "Never edit files under /archive.",
  "Ask before you delete a document.",
  "Prefer the glossary's words.",
].join("\n");
