import {
  type AgentRuntime,
  isHarnessRuntime,
} from "../../../../protocol/lophn-agent/agent-values.ts";
import { codingBuiltinOf } from "../../../../protocol/lophn-agent/workspaces.ts";
import {
  harnessVendorOf,
  type Vendor,
} from "../../parts/vendor-icon/vendors.ts";

/**
 * 내장 coding agent와 harness runtime agent의 얼굴은 그 제품의 아이콘이다. lophn agent처럼 꾸미지 않는다.
 * 해당하지 않으면 undefined. 아이콘 그림 대신 이름 표만 읽어 폰의 data 층도 이 파일을 쓴다.
 */
export function codingFaceOf(
  agent: string,
  runtime?: AgentRuntime,
): { readonly kind: "vendor"; readonly vendor: Vendor } | undefined {
  const coding = codingBuiltinOf(agent);
  const harness =
    coding !== null
      ? coding.harness
      : runtime !== undefined && isHarnessRuntime(runtime)
        ? runtime
        : undefined;
  const vendor = harness === undefined ? undefined : harnessVendorOf(harness);
  return vendor === undefined ? undefined : { kind: "vendor", vendor };
}
