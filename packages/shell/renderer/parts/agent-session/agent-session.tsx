// agent session 하나가 화면에 보이는 공통 모양: 얼굴(agent 아이콘)과 상태 점. sidebar 줄, 탭, 새 session 목록이
// 이것만 그린다. 점의 규칙은 activity.ts이고, lophn agent와 coding agent(터미널)에서 다른 것은 lophn.ts·coding.ts가 그 값으로 옮긴다.
// 그래서 점 규칙이나 아이콘을 고치면 sidebar와 탭이 같이 바뀐다.
import { Icon } from "@lophn/ui/primitives";

import type { AgentRuntime } from "../../../../protocol/lophn-agent/agent-values.ts";
import { shellIcons } from "../../icons/mod.ts";
import { Avatar, type AvatarLook } from "../avatar/avatar.tsx";
import { type Vendor, VendorIcon } from "../vendor-icon/vendor-icon.tsx";

export type AgentSessionKind = "lophn" | "coding";

export type AgentFace =
  | { readonly kind: "lophn"; readonly avatar: AvatarLook }
  | { readonly kind: "coding"; readonly vendor: Vendor | undefined };

/** 새 session을 열 수 있는 agent 하나: lophn에 정의된 agent(프로필)이거나 즐겨찾기 coding agent CLI다. */
export type AgentChoice =
  | {
      readonly kind: "agent";
      readonly id: string;
      readonly name: string;
      readonly runtime?: AgentRuntime;
      readonly face: AgentFace;
    }
  | {
      readonly kind: "coding";
      readonly id: string;
      readonly name: string;
      readonly face: AgentFace;
    };

// vendor를 모르는 coding agent는 터미널 아이콘이다. 탭 줄은 글자가 작아 vendor 아이콘도 14px이다.
export function AgentFaceIcon({
  face,
  vendorSize = 16,
}: {
  face: AgentFace;
  vendorSize?: 14 | 16;
}) {
  if (face.kind === "lophn") return <Avatar look={face.avatar} size="sm" />;
  return face.vendor === undefined ? (
    <Icon icon={shellIcons.terminal} pixels={14} />
  ) : (
    <VendorIcon vendor={face.vendor} size={vendorSize} />
  );
}
