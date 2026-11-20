// 들이기 결과를 사람의 글로 바꾼다. sidebar 줄의 한 줄과 Settings › Sync가 같이 쓴다.
import { t } from "@lophn/i18n";

import type { TakeInOutcome } from "./take-in.ts";

const FAILURE_KEY = {
  sync_off: "take-in.note.sync-off",
  sdk_missing: "take-in.note.sdk-missing",
  slug_in_use: "take-in.note.slug-in-use",
  dependency_missing: "take-in.note.dependency-missing",
  source_incomplete: "take-in.note.source-incomplete",
  failed: "take-in.note.failed",
} as const;

/** `machine`은 그 앱을 내놓았어야 할 컴퓨터의 이름이다(`sync_off`가 말한다). */
export function takeInText(
  outcome: TakeInOutcome,
  name: string,
  machine: string,
): string {
  return outcome.ok
    ? t("take-in.note.installed", { name })
    : t(FAILURE_KEY[outcome.reason], { name, machine });
}
