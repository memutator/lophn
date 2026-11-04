// `lophn gui <harness>`: Claude Code, Codex 또는 OpenCode의 터미널 화면 대신 lophn 창을 연다.
// core를 부르지 않는다. lophn 앱 실행 파일을 open intent(`--harness-gui`)와 함께 띄울 뿐이고, 이미 떠 있으면
// 그 앱의 second-instance가 받는다. 켜져 있는지(extension harness-gui)는 앱이 본다.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { err, ok, type LophnError, type Result } from "../../base/mod.ts";
import { GUI_HARNESSES } from "../../protocol/extensions/acp-session.ts";
import { defineCommand } from "./types.ts";

export type GuiLaunch = (
  args: readonly string[],
) => Promise<Result<void, LophnError>>;

// CLI는 앱과 같은 Electron binary를 Node로(ELECTRON_RUN_AS_NODE) 돌린다. 그 플래그만 빼면 같은 binary가 앱으로 뜬다.
// 설치본은 binary가 앱 자원을 알아서 찾고, 저장소 실행은 shell main bundle을 인자로 줘야 한다(없는 쪽이 설치본이다).
// 앱은 CLI가 끝난 뒤에도 살아야 하므로 떼어 낸다.
export const launchDesktop: GuiLaunch = async (args) => {
  const devMain = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../shell/main/dist/main.cjs",
  );
  const dev = existsSync(devMain);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    process.execPath,
    [
      ...(dev && env.ELECTRON_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
      ...(dev ? [devMain] : []),
      ...args,
    ],
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

export function createGuiCommand(launch: GuiLaunch) {
  return defineCommand({
    name: "gui",
    summary: "Open a lophn window for a coding agent CLI",
    description:
      "Open a lophn window in place of the terminal screen of Claude Code, Codex or OpenCode, running in the current folder. Starts lophn if it is not running. The harness-gui extension must be on (Settings > System > Extensions). resume is that CLI's own session id.",
    input: z.strictObject({
      harness: z.enum(GUI_HARNESSES),
      resume: z.string().min(1).optional(),
    }),
    positional: ["harness"],
    effect: "external",
    routes: [],
    places: [],
    run: async (input, ctx) => {
      if (ctx.cwd === undefined) {
        return err({ code: "invalid_input", message: "no working folder" });
      }
      const launched = await launch([
        "--harness-gui",
        input.harness,
        "--cwd",
        ctx.cwd,
        ...(input.resume === undefined ? [] : ["--resume", input.resume]),
      ]);
      if (!launched.ok) return launched;
      return ok({
        summary: `opened ${input.harness} in ${ctx.cwd}`,
        content: { harness: input.harness, cwd: ctx.cwd },
      });
    },
  });
}

export const GUI_COMMANDS = [createGuiCommand(launchDesktop)];
