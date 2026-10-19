// broker의 `BrokerAccess` 어댑터. 실행 범위는 현재 release 선언 ∩ active grant이고
// 요청마다 core에서 다시 읽는다: 회수는 다음 사용부터 거절되고 교체된 release의 옛 자식은 새 선언으로
// 접근을 얻지 못한다. 읽기는 supervisor의 machine credential로 core read route를 부른다(`apps/tools`와
// `app_grants/list`). 범위 계산은 IO 없는 `effectiveScope`가 한다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { appTools } from "../../../protocol/apps/blueprint/read.ts";
import {
  type AppGrant,
  appGrantsList,
  GRANT_LIST_MAX_COUNT,
} from "../../../protocol/apps/mod.ts";
import {
  type AccessState,
  type BrokerAccess,
  effectiveScope,
} from "../../apps/permissions/mod.ts";

type CorePost = (
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
): Promise<Result<AppGrant[]>> {
  const grants: AppGrant[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < GRANT_PAGES; page++) {
    const reply = await post("app_grants/list", bearer, {
      app,
      status: "active",
      limit: GRANT_LIST_MAX_COUNT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (reply.status !== 200) return unavailable("grants are unavailable");
    const parsed = appGrantsList.output.safeParse(reply.body);
    if (!parsed.success) return unavailable("grants answered badly");
    grants.push(...parsed.data.grants);
    if (parsed.data.next_cursor === null) return ok(grants);
    cursor = parsed.data.next_cursor;
  }
  return unavailable("grants are too many to read");
}

// 앱 하나의 현재 선언과 active grant를 core에서 읽는다. active release가 없으면 null이다.
type Loaded = {
  declared: AppBlueprintView;
  grants: AppGrant[];
};
type AppBlueprintView = ReturnType<typeof appTools.output.parse>;

async function load(
  deps: { post: CorePost; bearer: () => string },
  app: string,
): Promise<Result<Loaded | null>> {
  const bearer = deps.bearer();
  if (bearer === "") return unavailable("core is not connected");
  let blueprint: { status: number; body: unknown };
  let grants: Result<AppGrant[]>;
  try {
    [blueprint, grants] = await Promise.all([
      deps.post("apps/tools", bearer, { app }),
      activeGrants(deps.post, bearer, app),
    ]);
  } catch {
    return unavailable("core is unreachable");
  }
  // active release가 없거나 앱을 모르면 실행 범위가 없다. 같은 not_found라 구별하지 않는다.
  if (blueprint.status === 404) return ok(null);
  if (blueprint.status !== 200) return unavailable("blueprint is unavailable");
  const parsed = appTools.output.safeParse(blueprint.body);
  if (!parsed.success) return unavailable("blueprint answered badly");
  if (!grants.ok) return grants;
  return ok({ declared: parsed.data, grants: grants.value });
}

export function createCoreBrokerAccess(deps: {
  post: CorePost;
  // supervisor의 machine credential. hello 뒤에 채워지므로 호출 때 읽는다.
  bearer: () => string;
}): BrokerAccess {
  return {
    async current(app) {
      const loaded = await load(deps, app);
      if (!loaded.ok) return loaded;
      if (loaded.value === null) return ok(null);
      const { declared: view, grants } = loaded.value;
      const declared = view.declarations;
      const declarations = {
        release: view.release,
        permissions: declared.permissions,
        app_connections: declared.app_connections.map((use) => ({
          app: use.app,
          tools: use.tools,
        })),
        tools: declared.tools,
      };
      const state: AccessState = {
        release: view.release,
        // 다른 앱 호출은 이 범위를 쓰지 않는다. core의 호출 경로(Gate)가 판정한다.
        scope: effectiveScope({
          app,
          declarations,
          grants,
          targetCommands: () => undefined,
        }),
        tools: declared.tools,
      };
      return ok(state);
    },
  };
}
