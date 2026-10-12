import { assert, assertEquals } from "@std/assert";
import {
  click,
  render,
  unmountSettled,
} from "../../../../design/components/testing.ts";

import {
  find,
  flush,
  typeInto,
} from "../../desktop/lophn-space/testdata/dom.ts";
import { TrackingStrip } from "./tracking.tsx";
import type {
  Preview,
  PreviewEntry,
  RuleSet,
  TrackedRoot,
  TrackingProject,
  TrackingResult,
  TrackingSource,
} from "./source.ts";

const PROJECT = "prj_01k6p0000000000000000000aa";
const FOLDER = "/work/plans";

const PROPOSAL: RuleSet = {
  enabled: true,
  patterns: [{ effect: "include", glob: "**/*.md" }],
  useGitignore: true,
};

function project(patch: Partial<TrackingProject> = {}): TrackingProject {
  return {
    id: PROJECT,
    title: "Quarter plan",
    revision: "7",
    folders: [{ path: FOLDER, description: "" }],
    tracking: { enabled: false, patterns: [], useGitignore: false },
    proposal: PROPOSAL,
    ...patch,
  };
}

const ENTRIES: PreviewEntry[] = [
  {
    folder: FOLDER,
    path: "goals.md",
    included: true,
    reason: "include **/*.md",
  },
  {
    folder: FOLDER,
    path: "notes/week-1.md",
    included: true,
    reason: "include **/*.md",
  },
  {
    folder: FOLDER,
    path: "build/out.md",
    included: false,
    reason: "gitignore",
  },
  { folder: FOLDER, path: "logo.png", included: false, reason: "unmatched" },
  { folder: FOLDER, path: ".git/HEAD", included: false, reason: "inside .git" },
];

interface FakeTracking {
  source: TrackingSource;
  current: TrackingProject;
  roots: TrackedRoot[];
  previews: { project: TrackingProject; rules: RuleSet }[];
  previewReplies: TrackingResult<readonly PreviewEntry[]>[];
  applied: { project: TrackingProject; preview: Preview }[];
  applyReplies: TrackingResult<TrackingProject>[];
}

function fakeTracking(start: TrackingProject = project()): FakeTracking {
  const fake: FakeTracking = {
    current: start,
    roots: [],
    previews: [],
    previewReplies: [],
    applied: [],
    applyReplies: [],
    source: {
      project: () => Promise.resolve({ ok: true, value: fake.current }),
      trackedRoots: () => Promise.resolve({ ok: true, value: fake.roots }),
      preview(target, rules) {
        fake.previews.push({ project: target, rules });
        const reply = fake.previewReplies.shift() ??
          { ok: true, value: ENTRIES };
        if (!reply.ok) return Promise.resolve(reply);
        return Promise.resolve({
          ok: true,
          value: {
            baseRevision: target.revision,
            rules,
            entries: reply.value,
            basis: { page: "last", base_revision: target.revision },
          },
        });
      },
      apply(target, preview) {
        fake.applied.push({ project: target, preview });
        const reply = fake.applyReplies.shift();
        if (reply) return Promise.resolve(reply);
        fake.current = {
          ...target,
          revision: "8",
          tracking: preview.rules,
        };
        return Promise.resolve({ ok: true, value: fake.current });
      },
    },
  };
  return fake;
}

const dialog = () => find(document.body, "[data-tracking-dialog]");
const applyButton = () =>
  find(document.body, "[data-apply-tracking]") as HTMLButtonElement;

Deno.test("documents/projects#R3, shell/desktop#R28: 등록 직후 작업대는 추적이 꺼졌다고 알리고 켜기는 따로 고른다", async () => {
  const fake = fakeTracking();
  let refreshed = 0;
  using view = render(
    <TrackingStrip
      project={PROJECT}
      source={fake.source}
      onTracking={() => refreshed++}
    />,
  );
  await flush();
  const strip = find(view.container, "[data-tracking='off']");
  assert(
    strip.textContent?.includes(
      "This project isn't tracking files yet, so no versions are kept.",
    ),
  );
  assertEquals(fake.previews.length, 0, "nothing is previewed before asking");
  assertEquals(refreshed, 0);
  click(find(strip, "[data-turn-on-tracking]"));
  await flush();
  // 처음 켤 때의 기본 제안: Markdown 포함과 .gitignore 적용.
  assertEquals(fake.previews.map((call) => call.rules), [PROPOSAL]);
  const rules = find(dialog(), "[data-rules]").textContent ?? "";
  assert(rules.includes("Track **/*.md"), rules);
  assert(rules.includes("Skips files listed in .gitignore"), rules);
  await unmountSettled(view);
});

Deno.test("documents/projects#R6, shell/wording#R12: 미리보기는 포함·제외 파일과 이유를 보이고 미리 본 바로 그 구성으로 켠다", async () => {
  const fake = fakeTracking();
  let refreshed = 0;
  using view = render(
    <TrackingStrip
      project={PROJECT}
      source={fake.source}
      onTracking={() => refreshed++}
    />,
  );
  await flush();
  click(find(view.container, "[data-turn-on-tracking]"));
  await flush();
  assertEquals(
    find(dialog(), "[data-count='tracked']").textContent,
    "2 files will be tracked.",
  );
  assertEquals(
    find(dialog(), "[data-count='left-out']").textContent,
    "3 files are left out.",
  );
  const tracked = find(dialog(), "[data-group='tracked']");
  assert(tracked.textContent?.includes("goals.md"));
  assert(tracked.textContent?.includes("Matches **/*.md"));
  const leftOut = find(dialog(), "[data-group='left-out']").textContent ?? "";
  for (
    const shown of [
      "build/out.md",
      "Listed in .gitignore",
      "logo.png",
      "Matches no rule",
      ".git/HEAD",
      "Inside .git",
    ]
  ) {
    assert(leftOut.includes(shown), `missing ${shown}: ${leftOut}`);
  }
  assertEquals(applyButton().disabled, false);
  click(applyButton());
  await flush();
  assertEquals(fake.applied.length, 1);
  const sent = fake.applied[0]!;
  assertEquals(sent.preview.rules, PROPOSAL);
  assertEquals(sent.preview.baseRevision, "7");
  assertEquals(sent.preview.basis, { page: "last", base_revision: "7" });
  assertEquals(refreshed, 1);
  assertEquals(document.body.querySelector("[data-tracking-dialog]"), null);
  assertEquals(view.container.querySelector("[data-tracking='off']"), null);
  await unmountSettled(view);
});

Deno.test("documents/projects#R6: 규칙을 바꾸면 다시 미리 보기 전에는 켜지 않는다", async () => {
  const fake = fakeTracking();
  using view = render(<TrackingStrip project={PROJECT} source={fake.source} />);
  await flush();
  click(find(view.container, "[data-turn-on-tracking]"));
  await flush();
  const edit = find(dialog(), "[data-edit-rules]");
  assertEquals(edit.getAttribute("aria-label"), "Edit rules");
  assertEquals(edit.textContent, "");
  click(edit);
  await flush();
  click(find(dialog(), "[data-add-rule]"));
  await flush();
  const patterns = dialog().querySelectorAll("[data-rule-pattern]");
  typeInto(patterns[1]!, "drafts/**");
  await flush();
  assertEquals(applyButton().disabled, true);
  assert(
    find(dialog(), "[data-problem='stale']").textContent?.includes(
      "The rules changed. Preview again before turning tracking on.",
    ),
  );
  click(find(dialog(), "[data-preview-again]"));
  await flush();
  assertEquals(fake.previews.at(-1)?.rules.patterns, [
    { effect: "include", glob: "**/*.md" },
    { effect: "include", glob: "drafts/**" },
  ]);
  assertEquals(applyButton().disabled, false);
  await unmountSettled(view);
});

Deno.test("documents/projects#R7, shell/wording#R10: 다른 프로젝트의 켜진 추적과 겹치면 대상·영향·다음 행동을 보이고 켜지 않는다", async () => {
  const fake = fakeTracking();
  fake.roots = [{
    project: "prj_01k6p0000000000000000000zz",
    title: "Company wiki",
    path: "/work",
  }];
  using view = render(<TrackingStrip project={PROJECT} source={fake.source} />);
  await flush();
  click(find(view.container, "[data-turn-on-tracking]"));
  await flush();
  assertEquals(
    find(dialog(), "[data-problem='overlap']").textContent,
    "Company wiki already tracks /work/plans, so tracking stays off here. Stop tracking it in Company wiki first.",
  );
  assertEquals(applyButton().disabled, true);
  click(applyButton());
  await flush();
  assertEquals(fake.applied.length, 0);
  await unmountSettled(view);
});

Deno.test("shell/wording#R10: 폴더를 읽지 못한 미리보기는 그 폴더와 다시 미리 보기 하나를 보인다", async () => {
  const fake = fakeTracking();
  fake.previewReplies.push({ ok: false, code: "unavailable" });
  using view = render(<TrackingStrip project={PROJECT} source={fake.source} />);
  await flush();
  click(find(view.container, "[data-turn-on-tracking]"));
  await flush();
  const problem = find(dialog(), "[data-problem='unreadable']");
  assertEquals(
    problem.querySelector("p")?.textContent,
    "lophn couldn't read /work/plans, so tracking stays off. Check that it exists and try again.",
  );
  assertEquals(applyButton().disabled, true);
  const again = find(problem, "[data-preview-again]");
  assertEquals(again.getAttribute("aria-label"), "Preview again");
  click(again);
  await flush();
  assertEquals(fake.previews.length, 2);
  assertEquals(applyButton().disabled, false);
  await unmountSettled(view);
});

Deno.test("shell/wording#R10: 접근 말고 다른 이유로 미리보기를 못 만들면 원인을 추측하지 않고 다시 미리 보기 하나를 보인다", async () => {
  const fake = fakeTracking();
  fake.previewReplies.push({ ok: false, code: "not_found" });
  using view = render(<TrackingStrip project={PROJECT} source={fake.source} />);
  await flush();
  click(find(view.container, "[data-turn-on-tracking]"));
  await flush();
  const problem = find(dialog(), "[data-problem='preview-failed']");
  assertEquals(
    problem.querySelector("p")?.textContent,
    "The file check for Quarter plan didn't finish, so tracking stays off. Try again.",
  );
  assert(problem.querySelector("[data-preview-again]"));
  assertEquals(applyButton().disabled, true);
  await unmountSettled(view);
});

Deno.test("documents/projects#R6, shell/wording#R10: 미리보기 뒤 프로젝트가 바뀌면 켜지 않고 현재 판으로 다시 미리 보게 한다", async () => {
  const fake = fakeTracking();
  using view = render(<TrackingStrip project={PROJECT} source={fake.source} />);
  await flush();
  click(find(view.container, "[data-turn-on-tracking]"));
  await flush();
  // 그 사이 다른 창이 프로젝트를 바꿨다.
  fake.current = project({ revision: "9" });
  fake.applyReplies.push({ ok: false, code: "conflict" });
  click(applyButton());
  await flush();
  const problem = find(dialog(), "[data-problem='changed']");
  assertEquals(
    problem.querySelector("p")?.textContent,
    "Quarter plan changed after this preview, so tracking stays off. Preview again.",
  );
  click(find(problem, "[data-preview-again]"));
  await flush();
  assertEquals(fake.previews.at(-1)?.project.revision, "9");
  assertEquals(dialog().querySelector("[data-problem]"), null);
  click(applyButton());
  await flush();
  assertEquals(fake.applied.at(-1)?.preview.baseRevision, "9");
  await unmountSettled(view);
});

Deno.test("documents/projects#R2: 폴더 없는 프로젝트는 추적할 파일이 없다고만 알리고 켜기 단추를 두지 않는다", async () => {
  const fake = fakeTracking(project({ folders: [] }));
  using view = render(<TrackingStrip project={PROJECT} source={fake.source} />);
  await flush();
  const strip = find(view.container, "[data-tracking='off']");
  assertEquals(
    strip.textContent,
    "This project has no folder, so there are no files to track.",
  );
  assertEquals(strip.querySelector("button"), null);
});

Deno.test("documents/projects#R3: 이미 추적 중인 프로젝트에는 안내 줄이 없다", async () => {
  const fake = fakeTracking(project({ tracking: PROPOSAL }));
  using view = render(<TrackingStrip project={PROJECT} source={fake.source} />);
  await flush();
  assertEquals(view.container.querySelector("[data-tracking]"), null);
});
