// mock 모드는 주소의 `mock`일 때만 켜지고, 켜지면 화면마다 비지 않은 대표 데이터를 준다.
import { assert, assertEquals } from "@std/assert";

import { devMock, isDevMock } from "./mod.ts";

Deno.test("dev-mock: 주소에 mock이 없으면 가짜 통로를 만들지 않는다", () => {
  assertEquals(isDevMock(""), false);
  assertEquals(isDevMock("?dev-seed=1"), false);
  assertEquals(devMock(""), null);
  assertEquals(devMock("?dev-seed=1"), null);
  assertEquals(isDevMock("?mock"), true);
});

Deno.test("dev-mock: 켜면 core가 ready이고 주요 화면이 채워진 데이터를 읽는다", async () => {
  const mock = devMock("?mock");
  assert(mock !== null);
  assertEquals(mock.core.current?.()?.state, "ready");

  const projects = await mock.launcher.projects();
  assert(projects.ok && projects.value.length >= 2);

  const roles = await mock.roles.roles();
  assert(roles.ok && roles.value.length >= 2);

  const providers = await mock.settings.providers();
  assert(providers.ok && providers.value.length >= 2);
  assert(providers.value.some((row) => row.accounts.length > 0));

  const apps = await mock.apps.list();
  assert(apps.ok && apps.value.length >= 1);

  const overview = await mock.requests.overview();
  assert(overview.ok);
  assert(overview.value.requests.some((row) => row.status === "pending"));

  const search = await mock.lophn.search({
    query: "budget",
    place: null,
    context: null,
    format: null,
    includeArchived: false,
  });
  assert(search.ok && search.value.hits.length >= 1);
  const nothing = await mock.lophn.search({
    query: "no such words anywhere",
    place: null,
    context: null,
    format: null,
    includeArchived: false,
  });
  assert(nothing.ok && nothing.value.hits.length === 0);
});

Deno.test("dev-mock: 쓰기는 메모리에서만 끝난다(등록은 목록에 더해지고 core를 부르지 않는다)", async () => {
  const mock = devMock("?mock");
  assert(mock !== null);
  const before = await mock.launcher.projects();
  assert(before.ok);
  const registered = await mock.launcher.register({
    id: "prj_01h455vb4pex5v6nkc6gd5fd09",
    name: "new-project",
    title: "New project",
    purpose: "",
    folders: [{ path: "/home/mina/Documents/new-project", description: "" }],
  });
  assert(registered.ok);
  const after = await mock.launcher.projects();
  assert(after.ok && after.value.length === before.value.length + 1);
  // core 통로는 provider 목록 말고는 거절한다.
  const reply = await mock.core.call({
    kind: "command",
    resource: "projects",
    method: "create",
    body: {},
  });
  assertEquals(reply.ok, false);
});
