// 일곱 제품의 배포 catalog다. 위치·format은
// docs/domain-model/coding-agent/harnesses.md의 일곱 adapter 표를 따르고
// 검증 근거는 docs/research/coding-agent-harness-integration.md 9절이다.
// [미확인] capability는 unverified로 남고 성공으로 나오지 않는다.
// 정의는 제품별 파일(claude·codex·opencode·gemini·hermes·pi·openclaw)이
// 갖고 이 파일은 그 모음과 export만 둔다.
import type { HarnessDefinition } from "../model.ts";
import type { HarnessId } from "../../../protocol/coding-agent/mod.ts";
import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import { gemini } from "./gemini.ts";
import { hermes } from "./hermes.ts";
import { openclaw } from "./openclaw.ts";
import { pi } from "./pi.ts";
import { opencode } from "./opencode.ts";

export const HARNESS_CATALOG: readonly HarnessDefinition[] = [
  claude,
  codex,
  opencode,
  gemini,
  hermes,
  pi,
  openclaw,
];

export function catalogOf(
  harness_id: HarnessId,
): HarnessDefinition | undefined {
  return HARNESS_CATALOG.find((entry) => entry.harness_id === harness_id);
}
