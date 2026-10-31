// 왼쪽 sidebar가 그리는 값. 화면은 이 값과 callback만 안다(project 창, 뒤에 Home과 app place가 같이 쓴다).
import type { AvatarProfile } from "../parts/avatar/avatar.tsx";
import type { TabDot } from "../parts/tab-state-dot/tab-state-dot.tsx";
import type { Vendor } from "../parts/vendor-icon/vendor-icon.tsx";
import type { PlaceRef } from "./desk-model.ts";

/** session 줄의 종류. lophn agent session, 터미널 coding agent session, 사람 차례인 workflow desk. */
export type SidebarSessionKind = "session" | "terminal" | "workflow";

export interface SidebarSession {
  readonly kind: SidebarSessionKind;
  /** session id, 터미널 key, workflow 이름. */
  readonly ref: string;
  readonly title: string;
  /** 줄 앞의 agent 아이콘. workflow desk는 vendor도 profile도 없다. */
  readonly agent:
    | { readonly kind: "lophn"; readonly profile: AvatarProfile }
    | { readonly kind: "coding"; readonly vendor: Vendor | undefined }
    | { readonly kind: "workflow" };
  readonly dot: TabDot | null;
  /** 마지막으로 움직인 때(epoch ms). Recent 줄의 상대 시각이다. 모르면 0. */
  readonly at: number;
}

export const sessionKey = (item: Pick<SidebarSession, "kind" | "ref">) =>
  `${item.kind}:${item.ref}`;

export interface SidebarPlace {
  readonly ref: PlaceRef;
  readonly name: string;
  /** 지금 열려 있거나 도는 session. */
  readonly current: readonly SidebarSession[];
  /** 끝났거나 닫은 session. 접힌 줄 하나로 시작한다. */
  readonly recent: readonly SidebarSession[];
}

/** New session ▾ menu의 lophn agent. */
export interface NewSessionAgent {
  readonly id: string;
  readonly name: string;
  readonly profile: AvatarProfile;
}

/** New session ▾ menu의 coding agent. */
export interface NewSessionCoding {
  readonly id: string;
  readonly name: string;
  readonly vendor: Vendor | undefined;
}
