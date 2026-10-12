// 개발 도구 gallery의 page 목록 검사. 맞는 shell requirement가 없어 task 번호로 시작한다.
import { assert, assertEquals } from "@std/assert";

import { DISCARDED_NAME, DISCARDED_SCREENS, PAGES, PARTS } from "./pages.ts";
import { WAYS } from "./frames/compositions/ways.ts";
import { MODEL_CATALOG } from "./frames/compositions/models-data.ts";
import {
  initialSelection,
  selectionLabel,
  switchModel,
} from "./frames/compositions/model-options.ts";

Deno.test("shell#T66: 버린 화면은 page 목록에 없다", () => {
  const screens = new Set(PAGES.map((page) => page.screen as string));
  for (const discarded of DISCARDED_SCREENS) {
    assert(!screens.has(discarded), `버린 화면: ${discarded}`);
  }
  // 지금 화면 part는 id·screen·title에도 버린 화면의 이름을 쓰지 않는다.
  for (const page of PAGES.filter((item) => item.part === "now")) {
    for (const text of [page.id, page.screen, page.title]) {
      assert(!DISCARDED_NAME.test(text), `버린 화면 이름: ${text}`);
    }
  }
});

Deno.test("shell#T66: 모든 page에 제목·badge·설명이 있고 id는 겹치지 않는다", () => {
  const partIds = PARTS.map((part) => part.id);
  const ids = new Set<string>();
  for (const page of PAGES) {
    assert(page.title.trim() !== "", `${page.id}: title`);
    assert(page.badges.length > 0, `${page.id}: badge`);
    assert(page.badges.every((badge) => badge.trim() !== ""), `${page.id}`);
    assert(page.description.trim() !== "", `${page.id}: description`);
    assert(partIds.includes(page.part), `${page.id}: part`);
    assert(/^[a-z0-9-]+$/.test(page.id), `${page.id}: id 모양`);
    assert(!ids.has(page.id), `${page.id}: id가 겹친다`);
    ids.add(page.id);
  }
  // 두 part 모두 page가 하나 이상 있다.
  for (const part of partIds) {
    assert(PAGES.some((page) => page.part === part), `${part}: page 없음`);
  }
});

Deno.test("shell#T66: 새 설계 page 서른다섯 개는 모두 새 설계 badge와 한국어 설명을 갖는다", () => {
  const fresh = PAGES.filter((page) => page.part === "new");
  assertEquals(fresh.length, 35);
  // 지금은 Domain model이 아니라 Overview다.
  assert(fresh.every((page) => !/Domain model/.test(page.title)));
  assert(fresh.some((page) => page.title === "Context tab · Overview"));
  for (const page of fresh) {
    assertEquals(page.badges, ["새 설계"], page.id);
    assert(/[가-힣]/.test(page.description), `${page.id}: 한국어 설명`);
    assert(page.title.trim() !== "", `${page.id}: title`);
  }
});

Deno.test("shell#T66: 디자인 시스템 part가 첫째이고 page마다 badge와 한국어 설명이 있다", () => {
  assertEquals(PARTS[0].id, "design");
  assertEquals(PAGES[0].part, "design");
  const design = PAGES.filter((page) => page.part === "design");
  assert(design.length >= 20);
  // 목차는 " · " 앞 이름으로 묶는다. 묶음마다 둘 이상이거나 제목 전체가 묶음 이름이다.
  assertEquals(
    new Set(design.map((page) => page.title.split(" · ")[0])),
    new Set(["Tokens", "Components", "SDK"]),
  );
  for (const page of design) {
    assertEquals(page.badges, ["디자인 시스템"], page.id);
    assert(/[가-힣]/.test(page.description), `${page.id}: 한국어 설명`);
    assert(page.title.trim() !== "", `${page.id}: title`);
  }
});

Deno.test("shell#T68: 만드는 중·Context 탭 여는 길·문서 탭 page가 있고 새 context form과 객체 탭 page는 없다", () => {
  const ids = PAGES.map((page) => page.id);
  const titles = PAGES.map((page) => page.title);
  for (
    const title of [
      "New context · drafting",
      "Context tab · ways to open",
      "Project · document tab",
      "Project · document tab with info",
    ]
  ) {
    assert(titles.includes(title), `${title}: page 없음`);
  }
  assert(!ids.includes("new-object"));
  assert(!ids.includes("new-context-form"));
  assert(!titles.includes("New context form"));
  assert(!titles.some((title) => /^Object tab/.test(title)));
});

Deno.test("shell#T68: Context 탭 여는 길마다 try it이 가리키는 page가 있다", () => {
  const ids = new Set(PAGES.map((page) => page.id));
  assert(WAYS.length >= 8);
  for (const way of WAYS) {
    assert(ids.has(way.tryIt), `${way.title}: ${way.tryIt} page 없음`);
  }
});

Deno.test("shell#T69: Agent·Project Agents·Workspace Settings page가 있고 대화 dock page는 새 설계에 없다", () => {
  const fresh = PAGES.filter((page) => page.part === "new");
  const titles = fresh.map((page) => page.title);
  for (
    const title of [
      "Agent · sidebar",
      "Agent · toast with context",
      "Agent · tab",
      "Agent · model picker",
      "Agent · question card",
      "Agent · question answered",
      "Agent · approval card",
      "Agent · rewind",
      "Project · Agents tab",
      "Project · Operator editor",
      "Workspace · Settings › Providers",
      "Workspace · Connect a provider",
      "Workspace · Settings › Agents",
    ]
  ) {
    assert(titles.includes(title), `${title}: page 없음`);
  }
  // 묶음 이름(" · " 앞)이 Agent · Project · Workspace로 목차에서 묶인다.
  const groups = new Set(
    fresh.filter((page) => /^(Agent|Workspace) · /.test(page.title)).map((
      page,
    ) => page.title.split(" · ")[0]),
  );
  assertEquals(groups, new Set(["Agent", "Workspace"]));
  // agent 대화 탭 kind의 이름은 Agent다(Conversation이 아니다).
  assert(
    !fresh.some((page) =>
      /conversation/i.test(`${page.title} ${page.description}`)
    ),
  );
  // 내보내기 기능은 없다.
  assert(
    !fresh.some((page) => /export/i.test(`${page.title} ${page.description}`)),
  );
});

Deno.test("shell#T70: session switcher·commands·model changed page가 있고 새 설계 page에 schedule·conversation 말이 없다", () => {
  const fresh = PAGES.filter((page) => page.part === "new");
  const titles = fresh.map((page) => page.title);
  for (
    const title of [
      "Agent · session switcher",
      "Agent · session rename and delete",
      "Agent · commands",
      "Agent · commands filtered",
      "Agent · model changed",
    ]
  ) {
    assert(titles.includes(title), `${title}: page 없음`);
  }
  // Operator는 agent라서 일정 작업 말이 없고, 탭 kind 이름은 Agent다.
  for (const page of fresh) {
    const text = `${page.title} ${page.description}`;
    assert(!/schedule|conversation|last run|run now/i.test(text), page.id);
    assert(!/program이 판정/.test(text), `${page.id}: program이 판정`);
  }
  // sidebar에는 session 목록이 없다: Agent · sidebar 설명이 session 목록을 sidebar 밖으로 보낸다.
  const sidebar = fresh.find((page) => page.id === "new-agent-sidebar");
  assert(
    sidebar !== undefined &&
      /session 목록은 sidebar에 없/.test(sidebar.description),
  );
});

Deno.test("shell#T70: model picker의 목록과 option은 data 파일 하나에서 오고 고르는 규칙이 그 data만 읽는다", () => {
  // data: provider → model → option 축. model마다 축이 다르고 effort 밖의 축도 있다.
  const models = MODEL_CATALOG.flatMap((group) => group.models);
  const byName = (name: string) => models.find((model) => model.name === name);
  assert(MODEL_CATALOG.length >= 3);
  assertEquals(byName("Haiku 5.5")?.options.length, 0);
  const efforts = (name: string) =>
    byName(name)?.options.find((axis) => axis.id === "effort")?.values.length;
  assert(efforts("GPT-6.1 Sol") !== efforts("Sonnet 5.5"));
  assert(byName("Grok 4.7")?.options.every((axis) => axis.id !== "effort"));
  assert(
    models.some((model) => model.options.some((axis) => axis.id === "speed")),
  );
  // 고르는 규칙(model-options.ts)은 이 data만 읽는다: model을 바꾸면 없는 값이 가까운 약한 값으로 맞춰진다.
  const sol = {
    model: "GPT-6.1 Sol",
    values: { effort: "XHigh", speed: "Priority" },
  };
  assertEquals(selectionLabel(sol), "GPT-6.1 Sol · XHigh · Priority");
  const sonnet = switchModel(sol, "Sonnet 5.5");
  assertEquals(sonnet.selection.values, { effort: "High" });
  assertEquals(sonnet.notes, [
    "Effort set to High — XHigh isn't available for Sonnet 5.5.",
  ]);
  assertEquals(switchModel(sol, "Haiku 5.5").selection.values, {});
  assertEquals(
    selectionLabel(initialSelection("Opus 5.5")),
    "Opus 5.5 · Medium",
  );
});
