import { assertEquals } from "@std/assert";
import { RELEASE_EXCLUDE_PATHS, releaseExcludes } from "./release-exclude.ts";
import { DEPLOY_SKILL_NAMES } from "./guides.ts";

// 배포 안내·skill·hook·CLI wrapper·제품 local 설정은 운영 release 묶음에서
// 빠진다(guides#R19). 안내·skill·hook·CLI wrapper·제품 local MCP 설정이 앱 실행
// 코드나 공유 credential로 퍼지지 않게 한다.
Deno.test(
  "coding-agent/guides#R19: release bundle 제외 경로 상수는 개발 도구 경로다",
  () => {
    assertEquals([
      ...RELEASE_EXCLUDE_PATHS,
    ], [
      "AGENTS.md",
      "AGENTS.override.md",
      "CLAUDE.md",
      "bin/lophn",
      ".mcp.json",
      ".claude/settings.local.json",
      "skills/lophn-navigate",
      "skills/lophn-save",
      "skills/lophn-build-app",
      "skills/lophn-repair",
      ".lophn/skills",
      ".lophn/hooks",
    ]);
  },
);

Deno.test(
  "coding-agent/guides#R19: 제품 skill 사본은 배포 skill 디렉터리와 같다",
  () => {
    assertEquals(
      RELEASE_EXCLUDE_PATHS.filter((path) => path.startsWith("skills/")),
      DEPLOY_SKILL_NAMES.map((name) => `skills/${name}`),
    );
  },
);

Deno.test(
  "coding-agent/guides#R19: releaseExcludes는 일치하는 경로만 고른다",
  () => {
    for (const path of RELEASE_EXCLUDE_PATHS) {
      assertEquals(releaseExcludes(path), true);
    }
    assertEquals(releaseExcludes("src/main.ts"), false);
    assertEquals(releaseExcludes("bin/lophn_cache"), false);
    assertEquals(releaseExcludes("claude/settings.local.json"), false);
    assertEquals(releaseExcludes(""), false);
  },
);
