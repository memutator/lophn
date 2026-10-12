import { assertEquals } from "@std/assert";

import {
  addFolder,
  cardStatus,
  registerFailure,
  SHORT_NAME_MAX,
  shortNameOf,
  usableTitle,
} from "./model.ts";
import type { ProjectCard } from "./source.ts";

const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function card(patch: Partial<ProjectCard>): ProjectCard {
  return {
    id: "prj_01k6p0000000000000000000aa",
    name: "plans",
    title: "Plans",
    purpose: "",
    folders: [],
    tracking: { enabled: false, patterns: [], useGitignore: false },
    documentCount: 0,
    ...patch,
  };
}

Deno.test("shell/wording#R4: 안쪽 짧은 이름은 사람이 지은 이름에서 만들고 겹치면 번호를 붙인다", () => {
  assertEquals(shortNameOf("  Quarter Plan! ", []), "quarter-plan");
  assertEquals(shortNameOf("Café notes", []), "cafe-notes");
  assertEquals(shortNameOf("분기 계획", []), "project");
  assertEquals(shortNameOf("2026 goals", []), "project-2026-goals");
  assertEquals(shortNameOf("Plans", ["plans", "plans-2"]), "plans-3");
  const long = shortNameOf("a".repeat(100), ["a".repeat(SHORT_NAME_MAX)]);
  assertEquals(long.length <= SHORT_NAME_MAX, true);
  assertEquals(long.endsWith("-2"), true);
  for (
    const name of [
      shortNameOf("--x--", []),
      shortNameOf("A b c", ["a-b-c"]),
      long,
    ]
  ) {
    assertEquals(SLUG.test(name), true, name);
  }
});

Deno.test("documents/projects#R8: 카드 상태는 지금 필요한 하나만 고른다", () => {
  assertEquals(cardStatus(card({})), "no-folder");
  assertEquals(
    cardStatus(card({ folders: [{ path: "/work/plans" }] })),
    "not-tracking",
  );
  assertEquals(
    cardStatus(card({
      folders: [{ path: "/work/plans" }],
      tracking: { enabled: true, patterns: [], useGitignore: true },
    })),
    "tracking",
  );
});

Deno.test("documents/projects#R1: 고른 폴더는 한 번만 더하고 이름은 공백만으로 둘 수 없다", () => {
  const once = addFolder([], "/work/plans");
  assertEquals(once, [{ path: "/work/plans", description: "" }]);
  assertEquals(addFolder(once, "/work/plans"), once);
  assertEquals(usableTitle("   "), false);
  assertEquals(usableTitle(" Plans "), true);
  assertEquals(registerFailure("conflict"), "name-taken");
  assertEquals(registerFailure("unavailable"), "failed");
});
