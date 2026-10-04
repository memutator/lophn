// release bundle에서 빼는 개발 도구 경로다(guides#R19). apps의 bundle 준비가
// git tree를 읽을 때 이 목록과 일치하는 경로를 bundle에 넣지 않는다. 안내·skill·
// hook·CLI wrapper·제품 local MCP 설정이 앱 실행 코드나 공유 credential로 퍼지지
// 않게 한다.
export const RELEASE_EXCLUDE_PATHS = [
  "AGENTS.md",
  "AGENTS.override.md",
  "CLAUDE.md",
  "bin/lophn",
  ".mcp.json",
  ".claude/settings.local.json",
  // 제품 skill 사본(DEPLOY_SKILL_NAMES 디렉터리).
  "skills/lophn-navigate",
  "skills/lophn-save",
  "skills/lophn-build-app",
  "skills/lophn-repair",
  ".lophn/skills",
  // 제품 local hook 설정. source의 ignore 안내에 들어간다(guides#R19).
  ".lophn/hooks",
] as const;

export type ReleaseExcludePath = (typeof RELEASE_EXCLUDE_PATHS)[number];

// bundle에서 뺄지 묻는다. path는 bundle 안 상대 경로다.
export function releaseExcludes(path: string): boolean {
  return (RELEASE_EXCLUDE_PATHS as readonly string[]).includes(path);
}
