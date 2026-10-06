import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  render,
  unmountSettled,
} from "../../../../../packages/design/components/testing.ts";

import type { ConnectionState, CoreSource } from "../connection/connection.ts";
import {
  RequestDrafts,
  RequestsProvider,
} from "../lophn-space/things-to-confirm/context.tsx";
import {
  approval,
  fakeRequests,
  manualTicks,
  question,
} from "../lophn-space/things-to-confirm/testdata/fake-source.ts";
import { find, flush, typeInto } from "../lophn-space/testdata/dom.ts";
import { Launcher } from "./launcher.tsx";
import type {
  FolderPick,
  LauncherResult,
  LauncherSource,
  ProjectCard,
  ProjectDraft,
} from "./source.ts";

const PROJECT = "prj_01k6p0000000000000000000aa";
const NEW_PROJECT = "prj_01k6p0000000000000000000bb";

const ready: ConnectionState = { state: "ready", confirmedAt: 1 };
const core: CoreSource = {
  subscribe(listener) {
    listener(ready);
    return () => {};
  },
  call: () => Promise.resolve({ ok: true, value: {} }),
};

function card(patch: Partial<ProjectCard> = {}): ProjectCard {
  return {
    id: PROJECT,
    name: "release-notes",
    title: "Release notes",
    purpose: "What changed in each release, for the people who use it.",
    folders: [{ path: "/work/release-notes" }],
    tracking: { enabled: false, patterns: [], useGitignore: false },
    documentCount: 0,
    ...patch,
  };
}

interface FakeLauncher {
  source: LauncherSource;
  registered: ProjectDraft[];
  picks: FolderPick[];
  list: LauncherResult<readonly ProjectCard[]>[];
  register: LauncherResult<ProjectCard>[];
  reads: number;
}

function fakeLauncher(cards: readonly ProjectCard[]): FakeLauncher {
  const fake: FakeLauncher = {
    registered: [],
    picks: [],
    list: [],
    register: [],
    reads: 0,
    source: {
      projects() {
        fake.reads += 1;
        return Promise.resolve(fake.list.shift() ?? { ok: true, value: cards });
      },
      register(draft) {
        fake.registered.push(draft);
        const next = fake.register.shift();
        if (next) return Promise.resolve(next);
        return Promise.resolve({
          ok: true,
          value: card({
            id: draft.id,
            name: draft.name,
            title: draft.title,
            purpose: draft.purpose,
            folders: draft.folders.map((folder) => ({ path: folder.path })),
          }),
        });
      },
      pickFolder() {
        return Promise.resolve(fake.picks.shift() ?? { ok: true, path: null });
      },
    },
  };
  return fake;
}

function launcher(
  fake: FakeLauncher,
  onProject: (id: string) => void = () => {},
) {
  return (
    <Launcher
      source={core}
      onLophn={() => {}}
      projects={fake.source}
      onProject={onProject}
      newProjectId={() => NEW_PROJECT}
    />
  );
}

/** React가 듣는 input event로 textarea 값을 바꾼다. */
function typeText(area: Element, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const dialog = () => find(document.body, "[data-register-form]");

Deno.test("shell/desktop#R25, shell/wording#R4: 런처 카드는 사람이 지은 이름·목적·상태만 보이고 짧은 이름·ID·경로는 펼친 상세에만 둔다", async () => {
  const fake = fakeLauncher([
    card(),
    card({
      id: "prj_01k6p0000000000000000000cc",
      name: "notes",
      title: "Notes",
      purpose: "",
      folders: [],
    }),
    card({
      id: "prj_01k6p0000000000000000000dd",
      name: "site",
      title: "Site",
      folders: [{ path: "/work/site" }],
      tracking: {
        enabled: true,
        patterns: [{ effect: "include", glob: "**/*.md" }],
        useGitignore: true,
      },
      documentCount: 12,
    }),
  ]);
  using view = render(launcher(fake));
  await flush();
  const cards = [...view.container.querySelectorAll("[data-card='project']")];
  assertEquals(cards.length, 3);
  const first = cards[0]!;
  assert(first.textContent?.includes("Release notes"));
  assert(first.textContent?.includes("What changed in each release"));
  assertEquals(
    find(first, "[data-status]").textContent,
    "Not tracking files yet",
  );
  assertEquals(
    find(cards[1]!, "[data-status]").textContent,
    "No folder yet",
  );
  assertEquals(find(cards[2]!, "[data-status]").textContent, "Tracking files");
  for (const item of cards) {
    const text = item.textContent ?? "";
    assert(!text.includes("prj_"), `id on card: ${text}`);
    assert(!text.includes("/work/"), `path on card: ${text}`);
    assert(!text.includes("release-notes"), `short name on card: ${text}`);
  }
  assertEquals(
    view.container.querySelector("[data-section='projects'] h2")?.textContent,
    "Projects3",
  );

  const toggle = find(cards[2]!, "[data-details-toggle]");
  assertEquals(toggle.getAttribute("aria-label"), "Show details");
  assertEquals(toggle.textContent, "", "details toggle is not an icon button");
  click(toggle);
  const details = find(cards[2]!, "[data-details]").textContent ?? "";
  for (
    const shown of [
      "site",
      "prj_01k6p0000000000000000000dd",
      "/work/site",
      "Track **/*.md",
      "Skips files listed in .gitignore",
      "12 documents",
    ]
  ) {
    assert(details.includes(shown), `details miss ${shown}: ${details}`);
  }
  assertEquals(toggle.getAttribute("aria-label"), "Hide details");
});

Deno.test("shell/desktop#R26: 카드의 approval 대기 개수는 색이 아니라 글자 pill이고 그 프로젝트의 approval만 센다", async () => {
  const fake = fakeLauncher([card()]);
  const requests = fakeRequests({
    requests: [
      approval(1, { place: { kind: "project", id: PROJECT } }),
      approval(2, { place: { kind: "project", id: PROJECT } }),
      approval(3, { place: { kind: "global" } }),
      question(4, { place: { kind: "project", id: PROJECT } }),
    ],
  });
  using view = render(
    <RequestsProvider
      deps={{
        source: requests.source,
        drafts: new RequestDrafts(),
        ticks: manualTicks().ticks,
      }}
    >
      {launcher(fake)}
    </RequestsProvider>,
  );
  await flush();
  const pill = find(
    view.container,
    "[data-card='project'] [data-waiting-pill]",
  );
  assertEquals(pill.textContent, "2 decisions waiting");
  assertEquals(pill.getAttribute("data-waiting-pill"), "2");
});

Deno.test("shell/desktop#R25, documents/projects#R1, R2, R3: 등록은 이름·목적과 OS 폴더 선택으로 하고 추적을 켜지 않은 채 작업대로 간다", async () => {
  const fake = fakeLauncher([]);
  const opened: string[] = [];
  using view = render(launcher(fake, (id) => opened.push(id)));
  await flush();
  const empty = find(view.container, "[data-cards='empty']");
  assert(empty.textContent?.includes("No projects yet."));
  click(find(empty, "button"));
  await flush();
  assert(dialog().textContent?.includes("Registering doesn't track any files"));

  fake.picks.push({ ok: true, path: "/work/plans" });
  fake.picks.push({ ok: true, path: "/work/plans" });
  fake.picks.push({ ok: true, path: null });
  const add = find(dialog(), "[data-add-folder]");
  assertEquals(add.getAttribute("aria-label"), "Add folder");
  assertEquals(add.textContent, "");
  click(add);
  await flush();
  click(find(dialog(), "[data-add-folder]"));
  await flush();
  click(find(dialog(), "[data-add-folder]"));
  await flush();
  assertEquals(dialog().querySelectorAll("[data-folder]").length, 1);
  typeInto(find(dialog(), "[data-folder] input"), "Plans and notes");
  typeInto(find(dialog(), "[data-field='name']"), "  Quarter plan ");
  typeText(find(dialog(), "[data-field='purpose']"), "Plan the quarter.");
  click(find(document.body, "[data-register]"));
  await flush();

  assertEquals(fake.registered, [{
    id: NEW_PROJECT,
    name: "quarter-plan",
    title: "Quarter plan",
    purpose: "Plan the quarter.",
    folders: [{ path: "/work/plans", description: "Plans and notes" }],
  }]);
  assertEquals(opened, [NEW_PROJECT]);
  assertEquals(document.body.querySelector("[data-register-form]"), null);
  await unmountSettled(view);
});

Deno.test("documents/projects#R2: 폴더 없이도 등록하고 고른 폴더는 지울 수 있다", async () => {
  const fake = fakeLauncher([card()]);
  using view = render(launcher(fake));
  await flush();
  const register = find(view.container, "[data-register-project]");
  assertEquals(register.getAttribute("aria-label"), "Register project");
  assertEquals(register.textContent, "");
  click(register);
  await flush();
  fake.picks.push({ ok: true, path: "/work/drafts" });
  click(find(dialog(), "[data-add-folder]"));
  await flush();
  click(find(dialog(), "[data-remove-folder]"));
  await flush();
  assert(dialog().querySelector("[data-folders-empty]"));
  typeInto(find(dialog(), "[data-field='name']"), "Release notes");
  click(find(document.body, "[data-register]"));
  await flush();
  // 이미 쓰는 짧은 이름과 겹치지 않게 번호를 붙인다.
  assertEquals(fake.registered[0]?.name, "release-notes-2");
  assertEquals(fake.registered[0]?.folders, []);
  await unmountSettled(view);
});

Deno.test("shell/wording#R10: 등록 실패는 대상·영향·다음 행동 하나를 보이고 이름 없이는 보내지 않는다", async () => {
  const fake = fakeLauncher([]);
  using view = render(launcher(fake));
  await flush();
  click(find(find(view.container, "[data-cards='empty']"), "button"));
  await flush();
  click(find(document.body, "[data-register]"));
  await flush();
  assertEquals(fake.registered.length, 0);
  assert(dialog().textContent?.includes("Enter a name."));

  fake.picks.push({ ok: false });
  click(find(dialog(), "[data-add-folder]"));
  await flush();
  assertEquals(
    find(dialog(), "[data-pick-failed]").textContent,
    "The folder picker didn't open. Try again.",
  );

  typeInto(find(dialog(), "[data-field='name']"), "Plans");
  fake.register.push({ ok: false, code: "unavailable" });
  click(find(document.body, "[data-register]"));
  await flush();
  assertEquals(
    find(dialog(), "[data-register-failed]").textContent,
    "Plans wasn't registered, so nothing was saved. Try again.",
  );

  fake.register.push({ ok: false, code: "conflict" });
  click(find(document.body, "[data-register]"));
  await flush();
  assert(
    dialog().textContent?.includes(
      "Another project already uses this name. Try a different name.",
    ),
  );
  await unmountSettled(view);
});

Deno.test("shell/wording#R10: 프로젝트 목록을 읽지 못하면 대상과 다시 불러오기 하나를 보인다", async () => {
  const fake = fakeLauncher([card()]);
  fake.list.push({ ok: false, code: "unavailable" });
  using view = render(launcher(fake));
  await flush();
  const failed = find(view.container, "[data-cards='failed']");
  assert(failed.textContent?.includes("Couldn't load your projects."));
  click(find(failed, "button"));
  await flush();
  assertEquals(fake.reads, 2);
  assertEquals(
    view.container.querySelectorAll("[data-card='project']").length,
    1,
  );
});

Deno.test("shell/wording#R1: 런처 카드·등록의 고정 문구는 message key로만 나온다", async () => {
  const fake = fakeLauncher([card()]);
  using view = render(launcher(fake));
  await flush();
  click(find(view.container, "[data-register-project]"));
  await flush();
  const text = document.body.textContent ?? "";
  for (
    const sentence of [
      "Projects",
      "Register project",
      "Name",
      "Purpose",
      "Optional. What this project is for.",
      "Folders",
      "No folder yet. You can register without one.",
      "Register",
      "Cancel",
    ]
  ) {
    assert(text.includes(sentence), `missing: ${sentence}`);
  }
  await unmountSettled(view);
});
