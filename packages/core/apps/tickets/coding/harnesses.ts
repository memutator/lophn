// shell main이 감지한 harness. 감지 결과는 메모리 표에만 두고 `harness.list`가 제품마다 보이는 값을 낸다.
import {
  canDeliverMessages,
  canLaunch,
} from "../../../../protocol/coding-agent/harness-adapter.ts";
import {
  HARNESS_IDS,
  type HarnessDetection,
} from "../../../../protocol/coding-agent/harnesses.ts";
import type { HarnessListItem } from "../../../../protocol/coding-agent/harness-report.ts";

// 제품마다 가장 나중에 보고된 감지 하나를 쓴다.
export function detectionsByHarness(
  detections: readonly HarnessDetection[],
): Map<HarnessDetection["harness_id"], HarnessDetection> {
  return new Map(
    detections.map((detection) => [detection.harness_id, detection]),
  );
}

export function harnessList(
  detections: readonly HarnessDetection[],
): HarnessListItem[] {
  const found = detectionsByHarness(detections);
  return HARNESS_IDS.map((harness) => {
    const detection = found.get(harness);
    return {
      harness,
      detected: detection?.discovery === "detected",
      version: detection?.version.value ?? null,
      login: detection?.auth.result ?? "unknown",
      can_launch: canLaunch(harness),
      can_deliver_messages: canDeliverMessages(harness),
    };
  });
}
