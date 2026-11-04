// agent session 하나가 화면에 보이는 공통 모양: 얼굴(agent 아이콘)과 상태 점. sidebar 줄, 탭, 새 session 목록이
// 이것만 그린다. lophn agent와 coding agent(터미널)에서 다른 것은 lophn.ts·coding.ts가 이 값으로 옮긴다.
// 그래서 점 규칙이나 아이콘을 고치면 sidebar와 탭이 같이 바뀐다.
import { Icon } from "@lophn/ui/primitives";

import { shellIcons } from "../../icons/mod.ts";
import { Avatar, type AvatarProfile } from "../avatar/avatar.tsx";
import type { TabDot } from "../tab-state-dot/tab-state-dot.tsx";
import { type Vendor, VendorIcon } from "../vendor-icon/vendor-icon.tsx";

export type AgentSessionKind = "lophn" | "coding";

/** session 안 agent의 지금. unseen은 사람이 보지 않는 사이 turn이 끝난 것이다. */
export interface AgentSessionActivity {
  readonly state: "running" | "waiting" | "idle" | "unknown";
  readonly unseen: boolean;
  readonly ended: boolean;
}

/** 도는 중이나 기다리는 중이 먼저고, 아니면 못 본 turn 끝이 finished다. */
export function activityDot(activity: AgentSessionActivity): TabDot | null {
  if (activity.ended) return "ended";
  if (activity.state === "running") return "working";
  if (activity.state === "waiting") return "waiting";
  return activity.unseen ? "finished" : null;
}

export type AgentFace =
  | { readonly kind: "lophn"; readonly profile: AvatarProfile }
  | { readonly kind: "coding"; readonly vendor: Vendor | undefined };

/** 새 session을 열 수 있는 agent 하나. */
export interface AgentChoice {
  readonly kind: AgentSessionKind;
  readonly id: string;
  readonly name: string;
  readonly face: AgentFace;
}

// vendor를 모르는 coding agent는 터미널 아이콘이다. 탭 줄은 글자가 작아 vendor 아이콘도 14px이다.
export function AgentFaceIcon({
  face,
  vendorSize = 16,
}: {
  face: AgentFace;
  vendorSize?: 14 | 16;
}) {
  if (face.kind === "lophn") return <Avatar profile={face.profile} size="sm" />;
  return face.vendor === undefined ? (
    <Icon icon={shellIcons.terminal} pixels={14} />
  ) : (
    <VendorIcon vendor={face.vendor} size={vendorSize} />
  );
}
