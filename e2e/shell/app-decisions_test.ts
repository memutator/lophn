// shell#T43·T45 후속: app-detail 결정 intent 다섯이 실제 Electron 보호 창으로 열린다. 화면 없이
// (show:false·offscreen) 실제 coordinator·설치한 confirmation renderer와 preload에 가짜 core를 붙인다
// (apps/shell/main/confirmation/testdata/app-decisions-probe.ts). LOPHN_SHELL_SHOT_DIR이 있으면
// 창마다 PNG를 그곳에 남긴다.
// - shell/confirmation-window#R5, R8: 결정마다 정확한 종류의 창이 열리고 확인할 수 있는 상태다.
import { assert, assertEquals } from "@std/assert";

import {
  descendantPids,
  e2eEnabled,
  processAlive,
  signalPids,
} from "../harness.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
const shellMain = `${repoRoot}/apps/shell/main`;
const electronExecutable = `${shellMain}/node_modules/electron/dist/electron`;
const probeSource = `${shellMain}/confirmation/testdata/app-decisions-probe.ts`;
const rendererBuild = `${repoRoot}/apps/shell/renderer/build.ts`;

async function run(command: string, args: string[], cwd: string) {
  const output = await new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `${command} 실패: ${new TextDecoder().decode(output.stderr)}`,
    );
  }
}

Deno.test({
  name:
    "shell/confirmation-window#R5, R8: app-detail 결정 intent 다섯이 맞는 종류의 보호 창으로 열린다",
  ignore: !e2eEnabled(),
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-decisions-" });
    await Deno.chmod(home, 0o700);
    const out = `${home}/dist`;
    const userData = `${home}/user-data`;
    await Deno.mkdir(userData, { mode: 0o700 });
    let child: Deno.ChildProcess | undefined;
    try {
      await run("node", [
        "--input-type=module",
        "-e",
        "const { build } = await import(process.argv[2]); " +
        "await build(process.argv[3], [{ in: process.argv[4], out: 'probe' }]);",
        "app-decisions-probe",
        `${shellMain}/build.ts`,
        out,
        probeSource,
      ], shellMain);
      await run("deno", [
        "eval",
        `const { build } = await import(${
          JSON.stringify(`file://${rendererBuild}`)
        }); await build(${JSON.stringify(`${out}/renderer`)});`,
      ], repoRoot);
      const config = {
        userData,
        result: `${home}/result.json`,
        preload: `${out}/preload-confirmation.cjs`,
        rendererDist: `${out}/renderer`,
        shots: Deno.env.get("LOPHN_SHELL_SHOT_DIR") ?? `${home}/shots`,
      };
      child = new Deno.Command(electronExecutable, {
        args: [`${out}/probe.cjs`],
        env: {
          LOPHN_APP_DECISIONS: JSON.stringify(config),
          LOPHN_HOME: home,
          LOPHN_SHELL_HEADLESS: "1",
        },
        stdout: "null",
        stderr: "null",
      }).spawn();
      const status = await Promise.race([
        child.status,
        new Promise<undefined>((resolve) =>
          setTimeout(() => resolve(undefined), 120_000)
        ),
      ]);
      assert(status !== undefined, "probe가 시간 안에 끝나지 않았다");
      const report = JSON.parse(await Deno.readTextFile(config.result));
      assert(report.ok, report.error);
      const windows = report.result as {
        decision: string;
        kind: string | null;
        state: string | null;
        png: boolean;
      }[];
      assertEquals(
        windows.map((one) => [one.decision, one.kind, one.state, one.png]),
        [
          ["start_activation", "release_activation", "ready", true],
          ["grant_access", "grant", "ready", true],
          ["revoke_grant", "grant", "ready", true],
          ["enable_automation", "automation", "ready", true],
          ["connect_apps", "grant", "ready", true],
        ],
      );
    } finally {
      if (child !== undefined) {
        const tree = await descendantPids(child.pid);
        signalPids(tree.filter(processAlive), "SIGKILL");
        await child.status.catch(() => {});
      }
      await Deno.remove(home, { recursive: true });
    }
  },
});
