import type { Result } from "../../base/mod.ts";
import type { JsonValue } from "../base/json-values.ts";
import { definePort, type PortKey } from "../base/ports.ts";
import type { RequestContext } from "./registration.ts";

// owner가 정한 domain target 하나. 값은 CredentialScope.targets와 같은 JSON 값이다.
export type AuthorizationTarget = Readonly<Record<string, JsonValue>>;

// owner handler가 domain target(request_key·project·document 등)을 같은 Tx·snapshot 안에서 판정한다.
// platform은 ctx의 고정 조건 target(app·task·run·assignment·release·process·mode)을 채우고
// owner가 준 target과 합쳐 scope.targets의 모든 key가 있고 일치할 때만 ok를 준다.
// 빠지거나 다르면 forbidden이다(fail-closed). Promise나 다른 반환은 구현이 쓰지 않는다.
export type TargetAuthorizer = (
  ctx: RequestContext,
  operation: string,
  target: AuthorizationTarget,
) => Result<void>;

// Tx·ReadSnapshot·event 공개 hook의 snapshot에서 `port(TargetAuthorization)`로 꺼낸다.
// 공용 Tx·ReadSnapshot member를 넓히지 않고 core 조립이 구현을 주입한다.
export const TargetAuthorization: PortKey<TargetAuthorizer> =
  definePort<TargetAuthorizer>("TargetAuthorization");
