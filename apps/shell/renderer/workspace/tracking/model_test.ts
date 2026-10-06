import { assertEquals } from "@std/assert";

import {
  applyFailure,
  changeRule,
  groupPreview,
  overlapOf,
  previewFailure,
  reasonOf,
  sameRules,
  startingRules,
  usableGlob,
  usableRules,
  withoutRule,
  withRule,
} from "./model.ts";
import type { RuleSet, TrackingProject } from "./source.ts";

const PROPOSAL: RuleSet = {
  enabled: true,
  patterns: [{ effect: "include", glob: "**/*.md" }],
  useGitignore: true,
};

function project(patch: Partial<TrackingProject> = {}): TrackingProject {
  return {
    id: "prj_01k6p0000000000000000000aa",
    title: "Plans",
    revision: "4",
    folders: [{ path: "/work/plans", description: "" }],
    tracking: { enabled: false, patterns: [], useGitignore: false },
    proposal: PROPOSAL,
    ...patch,
  };
}

Deno.test("documents/projects#R3: 처음 켤 때는 Markdown과 .gitignore 제안이고 전에 고른 규칙은 켠 채로 다시 쓴다", () => {
  assertEquals(startingRules(project()), PROPOSAL);
  const chosen: RuleSet = {
    enabled: false,
    patterns: [{ effect: "include", glob: "docs/**" }],
    useGitignore: false,
  };
  assertEquals(startingRules(project({ tracking: chosen })), {
    ...chosen,
    enabled: true,
  });
});

Deno.test("documents/projects#R4: 규칙은 폴더 기준 상대 glob이고 위로 나가지 않는다", () => {
  assertEquals(usableGlob("**/*.md"), true);
  for (const glob of ["", "/etc/*", "C:/x", "a/../b", "a\\b"]) {
    assertEquals(usableGlob(glob), false, glob);
  }
  const added = withRule(PROPOSAL, { effect: "exclude", glob: "" });
  assertEquals(usableRules(added), false);
  const changed = changeRule(added, 1, {
    effect: "exclude",
    glob: "drafts/**",
  });
  assertEquals(usableRules(changed), true);
  assertEquals(sameRules(changed, PROPOSAL), false);
  assertEquals(sameRules(withoutRule(changed, 1), PROPOSAL), true);
});

Deno.test("documents/projects#R5, R6: 미리보기 이유를 사람 말 종류로 옮기고 포함·제외로 나눈다", () => {
  assertEquals(reasonOf("include **/*.md"), {
    kind: "included",
    glob: "**/*.md",
  });
  assertEquals(reasonOf("exclude drafts/**"), {
    kind: "excluded",
    glob: "drafts/**",
  });
  assertEquals(reasonOf("gitignore"), { kind: "gitignore" });
  assertEquals(reasonOf("inside .git"), { kind: "inside-git" });
  assertEquals(reasonOf("inside lophn data"), { kind: "inside-lophn" });
  assertEquals(reasonOf("symlink outside root"), { kind: "outside-link" });
  assertEquals(reasonOf("unmatched"), { kind: "unmatched" });
  assertEquals(reasonOf("tracking disabled"), { kind: "tracking-off" });
  assertEquals(reasonOf("something new"), { kind: "other" });
  const groups = groupPreview([
    { folder: "/w", path: "a.md", included: true, reason: "include **/*.md" },
    { folder: "/w", path: "b.png", included: false, reason: "unmatched" },
  ]);
  assertEquals(groups.tracked.map((entry) => entry.path), ["a.md"]);
  assertEquals(groups.leftOut.map((entry) => entry.path), ["b.png"]);
});

Deno.test("documents/projects#R7: 같은 폴더·조상·자손의 켜진 추적은 겹침이고 이름만 닮은 형제는 아니다", () => {
  const roots = (path: string) => [{ project: "p", title: "Wiki", path }];
  const folders = [{ path: "/work/plans" }];
  assertEquals(overlapOf(folders, roots("/work/plans")), {
    other: "Wiki",
    path: "/work/plans",
  });
  assertEquals(overlapOf(folders, roots("/work/")), {
    other: "Wiki",
    path: "/work/plans",
  });
  assertEquals(overlapOf(folders, roots("/work/plans/sub")), {
    other: "Wiki",
    path: "/work/plans",
  });
  assertEquals(overlapOf(folders, roots("/work/plans-old")), null);
  assertEquals(overlapOf(folders, roots("/")), {
    other: "Wiki",
    path: "/work/plans",
  });
  assertEquals(overlapOf([], roots("/work")), null);
});

Deno.test("shell/wording#R10: 적용 거절은 현재 판과 켜진 폴더를 다시 읽어 바뀜·겹침·실패로 가른다", () => {
  const preview = { baseRevision: "4" };
  const wiki = [{ project: "p", title: "Wiki", path: "/work" }];
  assertEquals(
    applyFailure("conflict", preview, project({ revision: "5" }), wiki),
    { kind: "changed" },
  );
  assertEquals(applyFailure("conflict", preview, project(), wiki), {
    kind: "overlap",
    other: "Wiki",
    path: "/work/plans",
  });
  assertEquals(applyFailure("conflict", preview, project(), []), {
    kind: "changed",
  });
  assertEquals(applyFailure("unavailable", preview, project(), wiki), {
    kind: "failed",
  });
  assertEquals(previewFailure("unavailable", project().folders), {
    kind: "unreadable",
    folder: "/work/plans",
  });
  assertEquals(
    previewFailure("forbidden", [{ path: "/a" }, { path: "/b" }]),
    { kind: "unreadable", folder: null },
  );
  assertEquals(previewFailure("conflict", []), { kind: "changed" });
  // 폴더 접근 말고는 원인을 추측하지 않는다.
  assertEquals(previewFailure("not_found", project().folders), {
    kind: "failed",
  });
});
