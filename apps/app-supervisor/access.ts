// broker의 `BrokerAccess` 어댑터(apps/permissions#R2, R14). 실행 범위는 현재 release 선언 ∩ active grant이고
// 요청마다 core에서 다시 읽는다: 회수는 다음 사용부터 거절되고 교체된 release의 옛 자식은 새 선언으로
// 접근을 얻지 못한다. 읽기는 supervisor의 machine credential로 core read route를 부른다(`apps/blueprint`와
// `grants/list`). 범위 계산은 IO 없는 `effectiveScope`가 한다.
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  appBlueprint,
  type Grant,
  GRANT_LIST_MAX_COUNT,
  grantsList,
} from "../../packages/contracts/apps/mod.ts";
import {
  type AccessState,
  type BrokerAccess,
  effectiveScope,
} from "../../packages/apps/permissions/mod.ts";

export type CorePost = (
  path: string,
  bearer: string,
  body: unknown,
) => Promise<{ status: number; body: unknown }>;

const GRANT_PAGES = 20;

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

// 앱 하나의 active grant 전체. 끝을 못 봤으면 읽은 것만으로 판단하지 않는다.
async function activeGrants(
  post: CorePost,
  bearer: string,
  app: string,
): Promise<Result<Grant[]>> {
  const grants: Grant[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < GRANT_PAGES; page++) {
    const reply = await post("grants/list", bearer, {
      app,
      status: "active",
      limit: GRANT_LIST_MAX_COUNT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (reply.status !== 200) return unavailable("grants are unavailable");
    const parsed = grantsList.output.safeParse(reply.body);
    if (!parsed.success) return unavailable("grants answered badly");
    grants.push(...parsed.data.grants);
    if (parsed.data.next_cursor === null) return ok(grants);
    cursor = parsed.data.next_cursor;
  }
  return unavailable("grants are too many to read");
}

export function createCoreBrokerAccess(deps: {
  post: CorePost;
  // supervisor의 machine credential. hello 뒤에 채워지므로 호출 때 읽는다.
  bearer: () => string;
}): BrokerAccess {
  return {
    async current(app) {
      const bearer = deps.bearer();
      if (bearer === "") return unavailable("core is not connected");
      let blueprint: { status: number; body: unknown };
      let grants: Result<Grant[]>;
      try {
        [blueprint, grants] = await Promise.all([
          deps.post("apps/blueprint", bearer, { app }),
          activeGrants(deps.post, bearer, app),
        ]);
      } catch {
        return unavailable("core is unreachable");
      }
      // active release가 없거나 앱을 모르면 실행 범위가 없다. 같은 not_found라 구별하지 않는다.
      if (blueprint.status === 404) return ok(null);
      if (blueprint.status !== 200) {
        return unavailable("blueprint is unavailable");
      }
      const parsed = appBlueprint.output.safeParse(blueprint.body);
      if (!parsed.success) return unavailable("blueprint answered badly");
      if (!grants.ok) return grants;
      const declared = parsed.data.declarations;
      const declarations = {
        release: parsed.data.release,
        permissions: declared.permissions,
        app_connections: declared.app_connections,
        commands: declared.commands,
        automations: declared.automations,
        problem_codes: declared.problem_codes,
      };
      const state: AccessState = {
        release: parsed.data.release,
        // 다른 앱의 command 목록은 이 broker가 쓰지 않는다. 앱 쌍 범위는 core의 준비 서비스가 정한다.
        scope: effectiveScope({
          app,
          declarations,
          grants: grants.value,
          targetCommands: () => undefined,
        }),
        commands: declared.commands,
        problemCodes: declared.problem_codes,
        automations: declared.automations,
      };
      return ok(state);
    },
  };
}
