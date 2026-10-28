// 화면이 agent를 가리키는 값(key)을 다룬다. agent id는 `lophn`이거나 `agt_…`이고, place는 화면을 연 자리일 뿐
// agent를 가리키는 값에 끼지 않는다.
import { LOPHN_AGENT_ID } from "../../../../protocol/lophn-agent/places.ts";

export const AGENT_ID = /^agt_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

/** 자리 id의 접두사가 앱인지 project인지 정한다. 앱 공간의 관리 화면이 같은 source를 쓴다. */
export const isAppPlace = (place: string) => place.startsWith("app_");

/** agent id(`lophn`이거나 `agt_…`)인가. */
export const isAgentId = (value: unknown): value is string =>
  value === LOPHN_AGENT_ID ||
  (typeof value === "string" && AGENT_ID.test(value));
