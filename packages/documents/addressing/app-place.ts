// 앱 자격이 쓸 수 있는 자리는 자기 앱 place뿐이다(versions domain model: 앱은 자기 앱 place의
// 선언된 출력 이름만 쓴다). 앱 credential의 scope target에는 place가 없으므로(발급은 app·
// release·process·mode만 고정한다) 이 경계는 documents가 요청 자격의 app id로 직접 판정한다.
import {
  parseActor,
  type RequestContext,
} from "../../contracts/platform/mod.ts";
import type { PlaceRef } from "./model.ts";

// 요청 자격이 앱이면 그 app id, 아니면 null이다. 자격에서만 읽고 본문 주장은 보지 않는다.
export function actingApp(ctx: Pick<RequestContext, "actor">): string | null {
  const parts = parseActor(ctx.actor);
  return parts?.kind === "app" ? parts.id : null;
}

// 그 앱의 앱 place인지. place 없음(null)은 앱의 자리가 아니다.
export function isAppPlace(app: string, place: PlaceRef | null): boolean {
  return place !== null && place.kind === "app" && place.id === app;
}
