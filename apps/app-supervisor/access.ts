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

// 앱 하나의 현재 선언과 active grant를 core에서 읽는다. active release가 없으면 null이다.
type Loaded = {
  declared: AppBlueprintView;
  grants: Grant[];
};
type AppBlueprintView = ReturnType<typeof appBlueprint.output.parse>;

async function load(
  deps: { post: CorePost; bearer: () => string },
  app: string,
): Promise<Result<Loaded | null>> {
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
  if (blueprint.status !== 200) return unavailable("blueprint is unavailable");
  const parsed = appBlueprint.output.safeParse(blueprint.body);
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
        app_connections: declared.app_connections,
        commands: declared.commands,
        automations: declared.automations,
        problem_codes: declared.problem_codes,
      };
      const state: AccessState = {
        release: view.release,
        // 다른 앱의 command 목록은 이 broker가 쓰지 않는다. 앱 쌍 범위는 core의 준비 서비스가 정한다.
        scope: effectiveScope({
          app,
          declarations,
          grants,
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

// 이 앱이 부를 수 있는 다른 앱이다: 현재 선언한 app_connections 가운데 사람이 허락한 app.call grant가
// 있는 대상(apps/connections#R4). 앱 자식의 Deno 허락에 그 대상의 direct socket을 더하는 근거이고,
// 실제로 부를 수 있는 command는 준비 서비스가 현재 target 프로세스와 맞춰 다시 정한다.
export function createCoreAppCallTargets(deps: {
  post: CorePost;
  bearer: () => string;
}): (app: string) => Promise<Result<string[]>> {
  return async (app) => {
    const loaded = await load(deps, app);
    if (!loaded.ok) return loaded;
    if (loaded.value === null) return ok([]);
    const { declared: view, grants } = loaded.value;
    const targets = new Set<string>();
    for (const connection of view.declarations.app_connections) {
      const allowed = grants.some((grant) =>
        grant.status === "active" && grant.scope.kind === "app.call" &&
        grant.scope.app === connection.app &&
        grant.scope.commands.some((command) =>
          connection.commands.includes(command)
        )
      );
      if (allowed) targets.add(connection.app);
    }
    return ok([...targets].sort());
  };
}
