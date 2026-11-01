import { definePort } from "../../../protocol/base/mod.ts";
import type { AgentId } from "../../../protocol/lophn-agent/places.ts";

// approvals는 앱 표도 agent 정의도 모르므로 이름과 공개 수를 읽는 길은 조립(core/main)이 꽂는다.
export interface ShareLookup {
  // 앱이 없으면 null. 공개 수는 지금 active 선언의 것이다(active release가 없으면 0).
  app(id: string): {
    name: string;
    slug: string;
    public_skills: number;
    public_commands: number;
  } | null;
  // agent의 이름. agent가 없으면 null.
  agent(id: AgentId): string | null;
}

export const shareLookupPort = definePort<ShareLookup>(
  "approvals.share-lookup",
);

// 남지 않는 event와 설정 쓰기를 commit 뒤 main thread로 넘기는 topic. 설정 store는 writer Worker 밖에 있다.
export const SHARE_REQUEST_TOPIC = "share_request";
export const SHARE_CODING_TOPIC = "share_coding";
export type ShareCodingData = { slug: string };
