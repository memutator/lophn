import { assert, assertEquals } from "@std/assert";
import { decideTracking } from "./rules.ts";
import { exactFileGlob, includeExactFile } from "./placement.ts";

const TRACKING = {
  enabled: true,
  use_gitignore: true,
  patterns: [
    { effect: "include" as const, glob: "**/*.md" },
    { effect: "exclude" as const, glob: "drafts/**" },
  ],
};

function included(
  tracking: typeof TRACKING,
  relativePath: string,
): boolean {
  const decision = decideTracking({
    relativePath,
    patterns: tracking.patterns,
    useGitignore: false,
    gitignore: [],
    escapesRoot: false,
    enabled: tracking.enabled,
  });
  assert(decision.ok);
  return decision.value.included;
}

Deno.test("documents/projects#R12: 패턴 밖 파일은 그 파일 하나의 include만 규칙 끝에 더하고 다른 파일은 그대로다", () => {
  assertEquals(included(TRACKING, "notes/plan.txt"), false);
  const next = includeExactFile(TRACKING, "notes/plan.txt");
  assert(next.ok);
  assertEquals(next.value.patterns.slice(0, 2), TRACKING.patterns);
  assertEquals(next.value.patterns.length, 3);
  assertEquals(next.value.patterns[2], {
    effect: "include",
    glob: "notes/plan.txt",
  });
  assertEquals(next.value.enabled, true);
  assertEquals(next.value.use_gitignore, true);
  assertEquals(included(next.value, "notes/plan.txt"), true);
  // 형제와 이름이 이어진 파일은 포함되지 않는다.
  assertEquals(included(next.value, "notes/plan.txt.bak"), false);
  assertEquals(included(next.value, "notes/other.txt"), false);
  assertEquals(included(next.value, "x/notes/plan.txt"), false);
});

Deno.test("documents/projects#R12: 마지막 일치가 이기므로 앞의 exclude 아래 파일도 정확한 include로 들어온다", () => {
  assertEquals(included(TRACKING, "drafts/idea.md"), false);
  const next = includeExactFile(TRACKING, "drafts/idea.md");
  assert(next.ok);
  assertEquals(included(next.value, "drafts/idea.md"), true);
  assertEquals(included(next.value, "drafts/other.md"), false);
});

Deno.test("documents/projects#R12: glob 특수 문자가 든 이름도 정확히 그 파일에만 맞고 만들 수 없는 이름은 conflict다", () => {
  for (
    const name of [
      "a*b.txt",
      "what?.txt",
      "[draft] plan.txt",
      "{x,y}.txt",
      "(old) notes.txt",
      "c++ guide.txt",
      "@home/todo.txt",
      "Hello!.txt",
      "한글 문서.txt",
      "dir.with.dots/file-name_1.txt",
    ]
  ) {
    const next = includeExactFile(TRACKING, name);
    assert(next.ok, name);
    assertEquals(included(next.value, name), true, name);
    assertEquals(included(next.value, `${name}x`), false, name);
    assertEquals(included(next.value, `x${name}`), false, name);
  }
  // 와일드카드가 든 이름은 다른 파일에 맞지 않는다.
  const star = includeExactFile(TRACKING, "a*b.txt");
  assert(star.ok);
  assertEquals(included(star.value, "axxb.txt"), false);
  const leading = exactFileGlob("!draft.txt");
  assert(!leading.ok);
  assertEquals(leading.error.code, "conflict");
});
