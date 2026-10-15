import type { DIAGNOSTIC_COMPONENTS } from "../../protocol/diagnostics/mod.ts";

// 구성 요소 하나의 지금 상태를 보는 점검이다. 각 owner의 wiring이 `WiringContext.componentChecks`에
// 더하고, `diagnostics/status`가 부를 때마다 모두 돌린다. reason에는 경로·key·값을 담지 않는다.
export type ComponentCheck = {
  component: (typeof DIAGNOSTIC_COMPONENTS)[number];
  check(): Promise<{ available: boolean; reason?: string }>;
};
