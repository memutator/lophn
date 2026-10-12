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

  const providers = await mock.settingsPanels.providers!.connected();
  assert(providers.ok && providers.value.length >= 2);
  assert(providers.value.some((row) => row.state === "available"));
  const available = await mock.settingsPanels.providers!.available();
  assert(available.ok && available.value.length >= 2);
  const agents = await mock.settingsPanels.agents!.read();
  assert(agents.ok && agents.value.providers.length >= 1);
  assert(agents.value.defaults.lophn !== null);

  const apps = await mock.apps.list();
  assert(apps.ok && apps.value.length >= 1);

  const overview = await mock.requests.overview();
  assert(overview.ok);
  assert(overview.value.requests.some((row) => row.status === "pending"));

  const search = await mock.lophn.search({
    query: "budget",
    place: null,
    format: null,
    includeArchived: false,
  });
  assert(search.ok && search.value.hits.length >= 1);
  const nothing = await mock.lophn.search({
    query: "no such words anywhere",
    place: null,
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

Deno.test("shell/workspace#R14 [ctx-I53]: mock 작업대는 Contexts 탭 통로와 검색 결과가 가리키는 문서를 준다", async () => {
  const mock = devMock("?mock");
  assert(mock !== null);
  const contexts = mock.workspace.contextsSource;
  assert(contexts !== undefined);
  const list = await contexts.list("prj_mock");
  assert(list.ok && list.value.some((item) => item.status === "drafting"));
  assert(list.ok && list.value.some((item) => item.status === "active"));
  // 검색 결과가 가리키는 경로는 문서로 잡힌 파일이고 그 문서를 편집기가 읽는다.
  const files = await mock.workspace.files("prj_mock");
  assert(files.ok);
  const experiment = files.value.find((file) =>
    file.path === "eval/experiments/exp-008-query-tools.md"
  );
  assert(experiment !== undefined);
  const document = await mock.editor.source.document(experiment.document);
  assert(document.ok);
});
