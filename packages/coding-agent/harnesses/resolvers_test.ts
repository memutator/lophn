// effective root·version 판정 테스트다(coding-agent/harnesses#R4, R11, T30).
// env·home은 인자로만 주입한다. 사람의 실제 home은 읽지 않는다.
import { assert, assertEquals } from "@std/assert";
import { rootOf, versionAtLeast } from "./resolvers.ts";

const ENV = (values: Record<string, string>) => ({
  get: (name: string) => values[name],
});

function assertRoot(value: ReturnType<typeof rootOf>): string {
  assert(value.ok);
  if (!value.ok) throw new Error("unreachable");
  return value.value;
}

Deno.test("coding-agent/harnesses#R4: root resolver는 문서 default로 푼다", () => {
  // home은 인자 그대로다.
  assertEquals(
    assertRoot(rootOf("home", { home: "/fixture/home", env: ENV({}) })),
    "/fixture/home",
  );
  // CODEX_HOME이 없으면 ~/.codex다(guides#R18).
  const codex = rootOf("codex_home", { home: "/fixture/home", env: ENV({}) });
  assert(codex.ok);
  assertEquals(codex.value, "/fixture/home/.codex");
  // XDG_CONFIG_HOME이 없으면 ~/.config/opencode다(조사 9.1).
  const opencode = rootOf("xdg_config_opencode", {
    home: "/fixture/home",
    env: ENV({}),
  });
  assert(opencode.ok);
  assertEquals(opencode.value, "/fixture/home/.config/opencode");
  // HERMES_HOME이 없으면 ~/.hermes다(조사 9.1).
  const hermes = rootOf("hermes_home", { home: "/fixture/home", env: ENV({}) });
  assert(hermes.ok);
  assertEquals(hermes.value, "/fixture/home/.hermes");
});

Deno.test("coding-agent/harnesses#R4: effective profile root는 env override를 따른다", () => {
  // CODEX_HOME이 있으면 그 아래다(guides#R18).
  const codex = rootOf("codex_home", {
    home: "/fixture/home",
    env: ENV({ CODEX_HOME: "/fixture/codex-home" }),
  });
  assert(codex.ok);
  assertEquals(codex.value, "/fixture/codex-home");
  // XDG_CONFIG_HOME이 있으면 그 아래 opencode다.
  const opencode = rootOf("xdg_config_opencode", {
    home: "/fixture/home",
    env: ENV({ XDG_CONFIG_HOME: "/fixture/xdg" }),
  });
  assert(opencode.ok);
  assertEquals(opencode.value, "/fixture/xdg/opencode");
  // project는 cwd다.
  const project = rootOf("project", {
    home: "/fixture/home",
    env: ENV({}),
    cwd: "/fixture/app",
  });
  assert(project.ok);
  assertEquals(project.value, "/fixture/app");
  // cwd가 없는 project 요청은 거절이다.
  const missing = rootOf("project", { home: "/fixture/home", env: ENV({}) });
  assert(!missing.ok);
  // 모르는 resolver도 거절이다.
  const unknown = rootOf("elsewhere", { home: "/fixture/home", env: ENV({}) });
  assert(!unknown.ok);
});

Deno.test("coding-agent/harnesses#R11: version 최소 조건은 조각별로 비교한다", () => {
  assert(versionAtLeast("1.0.62", "1.0.62"));
  assert(versionAtLeast("1.0.62", "1.0.61"));
  assert(!versionAtLeast("1.0.61", "1.0.62"));
  assert(versionAtLeast("2.1.0", "1.9.9"));
  assert(!versionAtLeast("1.0", "1.0.1"));
  assert(versionAtLeast("1.0", "1.0"));
});
