// coding-agent slice E2E 자리(coding-agent#T41). harness home·PATH·lophn CLI를 시험 temp dir에만
// 둔다. PATH는 fixture bin과 deno·시스템 dir뿐이라 사람이 설치한 실제 coding agent 제품
// (~/.local/bin 같은 자리)을 감지·실행하지 않는다. HOME도 temp라 ~/.codex·~/.claude는 비어 있다.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const FAKE_BIN = join(ROOT, "fixtures/coding-agent/bin");

export interface CodingFixtureOptions {
  /** true면 PATH에 fake harness를 두지 않는다(감지되는 coding agent 제품이 없는 기계). */
  noHarness?: boolean;
}

export interface CodingFixture {
  /** harness home으로 쓰는 temp HOME. */
  home: string;
  /** openFlowShell env로 줄 값. */
  env: Record<string, string>;
  remove(): Promise<void>;
}

/** temp HOME·LOPHN_CLI wrapper·제한한 PATH를 만든다. */
export async function codingFixture(
  options: CodingFixtureOptions = {},
): Promise<CodingFixture> {
  const root = await Deno.makeTempDir({ prefix: "lophn-e2e-coding-" });
  const home = join(root, "home");
  await Deno.mkdir(home);
  const deno = Deno.execPath();
  // dev shell은 LOPHN_CLI(절대 경로)의 lophn을 부른다. 같은 repo의 CLI entry를 deno로 돈다.
  const cli = join(root, "lophn");
  await Deno.writeTextFile(
    cli,
    `#!/bin/sh\nexec ${JSON.stringify(deno)} run -A --quiet ${
      JSON.stringify(join(ROOT, "packages/coding-agent/cli/main.ts"))
    } "$@"\n`,
  );
  await Deno.chmod(cli, 0o755);
  const denoDir = Deno.env.get("DENO_DIR") ??
    join(Deno.env.get("HOME") ?? "/", ".cache/deno");
  return {
    home,
    env: {
      HOME: home,
      PATH: [
        ...(options.noHarness === true ? [] : [FAKE_BIN]),
        dirname(deno),
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
      ].join(":"),
      LOPHN_CLI: cli,
      // HOME을 바꿔도 deno cache는 그대로 쓴다(시험 중 download를 하지 않는다).
      DENO_DIR: denoDir,
      CODEX_HOME: join(home, ".codex"),
    },
    remove: () => Deno.remove(root, { recursive: true }),
  };
}
