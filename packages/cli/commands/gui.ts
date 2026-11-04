// `lophn gui <harness>`: Claude Code, Codex 또는 OpenCode의 터미널 화면 대신 lophn 창을 연다.
// core를 부르지 않는 local 명령이라 명령 표(COMMANDS)에 넣지 않고 binary 입구(main.ts)만 끼운다. packages/cli는
// coding-agent를 import하지 못해 `LocalCommand`(coding-agent/local/types.ts)와 같은 모양만 맞춘다. lophn 앱 실행 파일을 open intent(`--harness-gui`)와 함께 띄울 뿐이고, 이미 떠 있으면
// 그 앱의 second-instance가 받는다. 켜져 있는지(extension harness-gui)는 앱이 본다.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import { GUI_HARNESSES } from "../../protocol/extensions/acp-session.ts";

export type GuiLaunch = (
  args: readonly string[],
) => Promise<Result<void, LophnError>>;

// CLI는 앱과 같은 Electron binary를 Node로(ELECTRON_RUN_AS_NODE) 돌린다. 그 플래그만 빼면 같은 binary가 앱으로 뜬다.
// 설치본은 binary가 앱 자원을 알아서 찾고, 저장소 실행은 shell main bundle을 인자로 줘야 한다(없는 쪽이 설치본이다).
// 저장소 실행의 Electron은 chrome-sandbox가 setuid가 아니라서 flag 없이는 argv를 읽기 전에 죽는다. 터미널 탭 env는 ELECTRON_*를 지워 env로는 못 받으므로 늘 붙인다.
// 앱은 CLI가 끝난 뒤에도 살아야 하므로 떼어 낸다.
const DEV_MAIN = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../shell/main/dist/main.cjs",
);

export const launchDesktop: GuiLaunch = async (args) => {
  const devMain = DEV_MAIN;
  const dev = existsSync(devMain);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    process.execPath,
    [...(dev ? ["--no-sandbox", devMain] : []), ...args],
    { detached: true, stdio: "ignore", env },
  );
  const started = await new Promise<Error | null>((resolve) => {
    child.once("error", resolve);
    child.once("spawn", () => resolve(null));
  });
  if (started !== null) {
    return err({
      code: "unavailable",
      message: `could not start lophn: ${started.message}`,
    });
  }
  child.unref();
  return ok(undefined);
};

export type GuiCommand = {
  name: string;
  summary: string;
  description: string;
  input: z.ZodType;
  positional: readonly string[];
  effect: "write";
  run(
    input: Record<string, unknown>,
    ctx: {
      cwd: string;
      env: { get(name: string): string | undefined };
      home: string;
    },
  ): Promise<Result<unknown, LophnError>>;
};

const guiInput = z.strictObject({
  harness: z.enum(GUI_HARNESSES),
  resume: z.string().min(1).optional(),
});

// 저장소 실행은 data root마다 single-instance lock이 달라, LOPHN_HOME이 없으면(터미널 env는 LOPHN_*를 지운다)
// 설치본이 쓰는 ~/.lophn으로 가서 설치본 창이 뜨거나 개발 code가 사람의 실제 data root로 뜬다. 그래서 막는다.
export function createGuiCommand(
  launch: GuiLaunch,
  repoRun: boolean,
): GuiCommand {
  return {
    name: "gui",
    summary: "Open a lophn window for a coding agent CLI",
    description:
      "Open a lophn window in place of the terminal screen of Claude Code, Codex or OpenCode, running in the current folder. Starts lophn if it is not running. Never calls core. The harness-gui extension must be on (Settings > System > Extensions). resume is that CLI's own session id.",
    input: guiInput,
    positional: ["harness"],
    effect: "write",
    run: async (input, ctx) => {
      const { harness, resume } = guiInput.parse(input);
      if (repoRun) {
        const root = ctx.env.get("LOPHN_HOME") ?? "";
        if (
          root === "" ||
          (ctx.home !== "" && resolve(root) === resolve(ctx.home, ".lophn"))
        ) {
          return err({
            code: "invalid_input",
            message:
              "lophn gui from the repository needs a dev data root: run it in a terminal tab of the dev app (npm run dev) or set LOPHN_HOME to the dev data root",
          });
        }
      }
      const launched = await launch([
        "--harness-gui",
        harness,
        "--cwd",
        ctx.cwd,
        ...(resume === undefined ? [] : ["--resume", resume]),
      ]);
      if (!launched.ok) return launched;
      return ok({ harness, cwd: ctx.cwd });
    },
  };
}

export const GUI_COMMANDS: readonly GuiCommand[] = [
  createGuiCommand(launchDesktop, existsSync(DEV_MAIN)),
];
