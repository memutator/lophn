import { codingBuiltinOf } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { AvatarProfile } from "../../parts/avatar/avatar.tsx";
import { harnessVendorOf } from "../../parts/vendor-icon/vendor-icon.tsx";

/**
 * 내장 coding agent의 얼굴은 사람이 쓰는 그 제품의 아이콘이다. lophn agent처럼 꾸미지 않는다.
 * 내장 coding agent가 아니면 undefined.
 */
export function codingFaceOf(agent: string): AvatarProfile | undefined {
  const coding = codingBuiltinOf(agent);
  const vendor = coding === null ? undefined : harnessVendorOf(coding.harness);
  return vendor === undefined ? undefined : { kind: "vendor", vendor };
}
