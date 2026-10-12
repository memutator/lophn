import { act } from "react";
import { assert, assertEquals } from "@std/assert";
import {
  click,
  render,
  unmountSettled,
} from "../../../../../design/components/testing.ts";

import { ProjectsScreen } from "./projects-screen.tsx";
import type { ProjectChange, ProjectRow } from "../organize/source.ts";
import {
  fakeOrganize,
  type OrganizeData,
  PROJECT,
} from "../organize/testdata/fake-organize.ts";
import { fakeSource } from "../testdata/fake-source.ts";
import { find, flush, submit, typeInto } from "../testdata/dom.ts";

async function openProjects(data: OrganizeData = {}) {
  const fake = fakeOrganize(data);
  const view = render(
    <ProjectsScreen source={fake.source} lophn={fakeSource().source} />,
  );
  await flush();
  return { ...fake, view };
}

async function openProject(data: OrganizeData = {}) {
  const opened = await openProjects(data);
  click(find(opened.view.container, "[data-project='prj_1']"));
  await flush();
  return opened;
}

Deno.test("shell/desktop#R28: projects 목록은 실제 프로젝트를 보이고 보관한 것은 고를 때만 보인다", async () => {
  const { view } = await openProjects();
  const rows = () =>
    [...view.container.querySelectorAll("[data-project]")].map((row) =>
      row.getAttribute("data-project")
    );
  assertEquals(rows(), ["prj_1"]);
  assertEquals(
    find(view.container, "[data-project='prj_1']").textContent,
    "lophnTracking files",
  );
  click(find(view.container, "button[role=switch]"));
  await flush();
  assertEquals(rows(), ["prj_1", "prj_2"]);
  assertEquals(
    find(view.container, "[data-detail='none']").textContent,
    "Choose a project to see it here.",
  );
  await unmountSettled(view);
});

Deno.test("shell/desktop#R28 documents/projects#R11: 프로젝트 보관은 그 프로젝트만 보관하고 소속 문서는 그대로 남아 보인다", async () => {
  const { view, of, calls } = await openProject();
  assertEquals(
    find(view.container, "[data-project-archive]").textContent?.startsWith(
      "Archiving hides this project from your lists. Its documents and versions stay.",
    ),
    true,
  );
  click(find(view.container, "[data-archive-project='archive']"));
  await flush();
  const [project, archived] = of("setProjectArchived")[0]!.args as [
    ProjectRow,
    boolean,
  ];
  assertEquals([project.id, project.revision, archived], ["prj_1", "4", true]);
  // 문서에는 아무 쓰기도 보내지 않는다.
  const documentWrites = [
    "renameDocument",
    "moveDocument",
    "placeFile",
    "removeFile",
  ];
  assertEquals(
    calls.filter((call) => documentWrites.includes(call.method)).length,
    0,
  );
  assert(view.container.querySelector("[data-project-archived]"));
  assert(view.container.querySelector("[data-archive-project='unarchive']"));
  assertEquals(
    [...view.container.querySelectorAll("[data-project-document]")].length,
    2,
  );
  await unmountSettled(view);
});

Deno.test("shell/desktop#R28: 이름·목적은 묻지 않고 바뀐 field만 현재 revision으로 보내고 저장 결과를 보인다", async () => {
  const { view, of } = await openProject();
  typeInto(find(view.container, "[data-project-name]"), "lophn-app");
  const purpose = find(view.container, "[data-project-purpose]");
  typeIntoArea(purpose, "Build and ship lophn.");
  submit(find(view.container, "[data-project-form]"));
  await flush();
  const [project, change] = of("updateProject")[0]!.args as [
    ProjectRow,
    ProjectChange,
  ];
  assertEquals(project.revision, "4");
  assertEquals(change, { name: "lophn-app", purpose: "Build and ship lophn." });
  assertEquals(
    find(view.container, "[data-project-saved]").textContent,
    "Saved.",
  );
  assertEquals(
    find(view.container, "[data-project-head='prj_1']").textContent?.includes(
      "lophn-app",
    ),
    true,
  );
  await unmountSettled(view);
});

Deno.test("shell/wording#R10 documents/addressing#R2: 이름이 겹치면 바꾸지 않고 다른 이름을 고르게 하고, 그 사이 바뀌었으면 최신으로 가는 길만 남긴다", async () => {
  const taken = await openProject({
    updated: { ok: false, code: "conflict" },
  });
  typeInto(find(taken.view.container, "[data-project-name]"), "old-site");
  submit(find(taken.view.container, "[data-project-form]"));
  await flush();
  assert(
    taken.view.container.textContent?.includes(
      "This name is already used, now or before. Choose another.",
    ),
  );
  assertEquals(taken.view.container.querySelector("[data-changed]"), null);
  await unmountSettled(taken.view);

  // 다시 읽은 등록의 revision이 다르면 대상이 바뀐 것이다.
  let reads = 0;
  const fake = fakeOrganize({ updated: { ok: false, code: "conflict" } });
  const projects = fake.source.projects;
  fake.source.projects = () => {
    reads += 1;
    return reads === 1
      ? projects()
      : Promise.resolve({ ok: true, value: [{ ...PROJECT, revision: "8" }] });
  };
  const view = render(
    <ProjectsScreen source={fake.source} lophn={fakeSource().source} />,
  );
  await flush();
  click(find(view.container, "[data-project='prj_1']"));
  await flush();
  typeInto(find(view.container, "[data-project-title]"), "lophn core");
  submit(find(view.container, "[data-project-form]"));
  await flush();
  assertEquals(
    find(view.container, "[data-changed]").textContent,
    "This changed since you opened it.",
  );
  click(find(view.container, "[data-show-latest]"));
  await flush();
  assertEquals(reads, 3);
  await unmountSettled(view);
});

/** textarea는 HTMLTextAreaElement의 setter로 바꾼다. */
function typeIntoArea(area: Element, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
