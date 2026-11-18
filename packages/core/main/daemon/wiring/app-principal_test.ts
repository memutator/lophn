import assert from "node:assert/strict";
import { test } from "node:test";

import { ok } from "../../../../base/mod.ts";
import {
  APP_CALL_ROUTES,
  appCallsSend,
} from "../../../../protocol/lophn-agent/app-calls.ts";
import { SESSION_LIFECYCLE_ROUTES } from "../../../../protocol/lophn-agent/session-lifecycle.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { appHandlerFor } from "./app-principal.ts";

const APP = "app_00000000000000000000000001";
const OTHER_APP = "app_00000000000000000000000002";
const SES = "ses_00000000000000000000000001";
const CAL = "cal_00000000000000000000000001";
const DEVICE = "device:dev_00000000000000000000000001";
const OTHER_DEVICE = "device:dev_00000000000000000000000002";

const who = (principal: string, actor = "user"): AuthenticatedContext => ({
  principal,
  actor,
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: principal,
});

// 앱 화면이 부르는 앱 session·call route 열 개와 그 입력 하나씩(app은 넣지 않는다. 경우마다 붙인다).
const ROUTES = [...SESSION_LIFECYCLE_ROUTES, ...APP_CALL_ROUTES];
const INPUTS: Record<string, Record<string, unknown>> = {
  "app_sessions/list": {},
  "app_sessions/status": { session: SES },
  "app_sessions/stop": { session: SES },
  "app_sessions/open": { agent: "lophn" },
  "app_sessions/end": { session: SES },
  "app_calls/send": { to: { session: SES }, reply: "none", text: "hi" },
  "app_calls/read": { call: CAL },
  "app_calls/cancel": { call: CAL },
  "app_calls/list": { session: SES },
  "app_agents/list": {},
};

// view 표의 owner별 view. DEVICE가 연 live view, 묶음을 잃은 view, preview view가 있고 OTHER_DEVICE는 자기 view 하나를 가졌다.
const VIEWS = new Map<string, { app: string; usable: boolean }>([
  [`${DEVICE} v-live`, { app: APP, usable: true }],
  [`${DEVICE} v-lost`, { app: APP, usable: false }],
  [`${OTHER_DEVICE} v-theirs`, { app: APP, usable: true }],
]);
const views = {
  viewApp: (owner: string, view: string) =>
    VIEWS.get(`${owner} ${view}`) ?? null,
};

async function run(
  route: { resource: string; method: string },
  caller: AuthenticatedContext,
  extra: Record<string, unknown>,
) {
  const key = `${route.resource}/${route.method}`;
  const seen: { app: string; input: unknown }[] = [];
  const handler = appHandlerFor(() => views)((app, input) => {
    seen.push({ app, input });
    return ok(null);
  });
  const result = await handler(caller, { ...INPUTS[key], ...extra });
  return { result, seen };
}

// 기기 자격은 actor user라 view 확인이 없으면 아무 앱이나 대신해 session을 열고 끝내고 call을 보낸다.
test("기기는 자기가 연 view의 앱으로만 앱 session과 call route를 쓴다", async () => {
  assert.equal(ROUTES.length, 10);
  for (const route of ROUTES) {
    const key = `${route.resource}/${route.method}`;
    // route가 view를 받는다(아니면 기기는 이 route를 아예 부르지 못한다).
    assert.ok(
      route.input.safeParse({ ...INPUTS[key], app: APP, view: "v-live" })
        .success,
      key,
    );
    const device = who(DEVICE);
    const refused: [Record<string, unknown>, string][] = [
      [{ app: APP }, "forbidden"],
      [{ app: APP, view: "v-theirs" }, "not_found"],
      [{ app: APP, view: "v-gone" }, "not_found"],
      [{ app: APP, view: "v-lost" }, "forbidden"],
      [{ app: OTHER_APP, view: "v-live" }, "forbidden"],
    ];
    for (const [extra, code] of refused) {
      const { result, seen } = await run(route, device, extra);
      assert.equal(!result.ok && result.error.code, code, `${key} ${extra}`);
      assert.equal(seen.length, 0);
    }
    const own = await run(route, device, { app: APP, view: "v-live" });
    assert.ok(own.result.ok, key);
    // 뒤의 handler는 view의 앱을 받고 view는 command 입력으로 넘어가지 않는다.
    assert.equal(own.seen[0]?.app, APP);
    assert.equal(
      Object.hasOwn(own.seen[0]?.input as object, "view"),
      false,
      key,
    );
  }
});

test("이 컴퓨터의 shell과 app 자격은 view 없이 지금처럼 된다", async () => {
  for (const route of ROUTES) {
    const shell = await run(route, who("user:me"), { app: OTHER_APP });
    assert.equal(shell.seen[0]?.app, OTHER_APP);
  }
  const app = await run(appCallsSend, who(APP, `app:${APP}`), {});
  assert.equal(app.seen[0]?.app, APP);
  const other = await run(appCallsSend, who(APP, `app:${APP}`), {
    app: OTHER_APP,
  });
  assert.equal(!other.result.ok && other.result.error.code, "forbidden");
});
