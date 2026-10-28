import assert from "node:assert/strict";
import { test } from "node:test";
import { PLACE_KINDS } from "../../protocol/lophn-agent/places.ts";
import { placeToolNames } from "../agent-places/tool-lists.ts";
import { appConnectSource } from "../../protocol/apps/apps.ts";
import { packagePublish } from "../../protocol/apps/package-routes.ts";
import { previewsStart } from "../../protocol/apps/previews.ts";
import {
  releaseActivate,
  releasePrepare,
} from "../../protocol/apps/releases.ts";
import {
  agentConditions,
  placeOperations,
} from "../agent-places/credentials.ts";
import { FILE_HOOKS } from "../agent-places/hooks.ts";
import { agentTools } from "./agent-tools.ts";
import { inputJsonSchema } from "../lophn-agent/tools/wire.ts";

// agent credential 상한은 core가 대조하는 route 이름이어야 한다. tool 이름이면 command가 forbidden이다.
test("release·publish·preview·소스 연결 route는 app 종류의 credential 상한에만 있고, app place session의 credential은 그 앱 하나에 묶인다", () => {
  const definitions = agentTools({ file: FILE_HOOKS });
  const app = placeOperations("app", definitions);
  const project = placeOperations("project", definitions);
  const home = placeOperations("home", definitions);
  for (const route of [
    appConnectSource,
    packagePublish,
    releasePrepare,
    releaseActivate,
    previewsStart,
  ]) {
    assert.ok(app.includes(route.name), route.name);
    assert.ok(!project.includes(route.name), route.name);
    assert.ok(!home.includes(route.name), route.name);
  }
  assert.deepStrictEqual(appConnectSource.name, "app.connect_source");
  assert.ok(!app.includes("app.link_source"));
  const ids = { session: "s", turn: "t", process: "p" };
  const inApp = agentConditions({
    ...ids,
    place: { kind: "app", id: "app_1" },
  });
  assert.deepStrictEqual(inApp.app, "app_1");
  assert.ok(!("project" in inApp));
  const inProject = agentConditions({
    ...ids,
    place: { kind: "project", id: "prj_1" },
  });
  assert.deepStrictEqual(inProject.project, "prj_1");
  assert.ok(!("app" in inProject));
  const atHome = agentConditions({ ...ids, place: null });
  assert.ok(!("app" in atHome));
  assert.ok(!("project" in atHome));
});

// selectTools는 정의 없는 이름을 조용히 건너뛴다. 어긋나면 agent가 그 tool을 말없이 못 본다.
test("place 종류 목록의 모든 이름에 정의가 있고 모든 정의가 어느 목록에 있다", () => {
  const defined = new Set(
    agentTools({ file: FILE_HOOKS }).map((tool) => tool.name),
  );
  const listed = new Set(PLACE_KINDS.flatMap((kind) => placeToolNames(kind)));
  assert.deepStrictEqual(
    [...listed].filter((name) => !defined.has(name)),
    [],
  );
  assert.deepStrictEqual(
    [...defined].filter((name) => !listed.has(name)),
    [],
  );
});

// tool 입력 하나라도 JSON Schema로 바뀌지 않으면 그 place 종류의 turn이 준비 단계에서 조용히 멈춘다.
test("모든 내장 tool의 입력이 model에 보낼 JSON Schema로 바뀐다", () => {
  const failed: string[] = [];
  for (const tool of agentTools({ file: FILE_HOOKS })) {
    try {
      inputJsonSchema(tool);
    } catch {
      failed.push(tool.name);
    }
  }
  assert.deepStrictEqual(failed, []);
});
