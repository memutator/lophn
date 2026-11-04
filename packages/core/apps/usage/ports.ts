import { definePort } from "../../../protocol/base/mod.ts";
import type { Place } from "../../../protocol/lophn-agent/places.ts";

// 사용 관계가 agent와 session이 놓인 곳을 알아내는 길. sessions 표는 apps의 것이 아니므로
// 구현은 조립(core/main)이 tx와 snapshot마다 꽂는다.
export interface UsagePorts {
  // session이 놓인 곳. home이면 place가 null이다. session이 없으면 null이다.
  sessionPlace(session: string): { place: Place | null } | null;
  // 그 agent의 session이 놓였던 project·app. 할당받은 agent가 쓰는 쪽을 가늠하는 재료다.
  agentPlaces(agent: string): Place[];
}

export const usagePorts = definePort<UsagePorts>("apps.usage");
