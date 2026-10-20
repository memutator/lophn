// app-design judge 입력. 끝난 world의 켜진 release에서 앱이 선언한 화면과 화면 source를 읽는다.
import { appTools } from "../../../../packages/protocol/apps/blueprint/read.ts";
import { joinInput } from "../../judge/mod.ts";
import type { CheckInput } from "../../types.ts";
import { findApp } from "./live.ts";
import { git, source } from "./reuse.ts";

const SOURCE_MAX = 24_000;
const FILE_MAX = 8_000;
const SCREEN_FILE = /\.(tsx|ts)$/;
// 모든 화면이 같은 template 파일이라 화면 모양을 말해 주지 않는다. 뒤로 보낸다.
const PLUMBING = /(^|\/)(main\.tsx|bridge\.ts)$/;

async function screenSource(
  dir: string,
  commit: string,
): Promise<string> {
  const listed = await git(dir, [
    "ls-tree",
    "-r",
    "--name-only",
    commit,
    "--",
    "src/screens",
  ]);
  const paths = listed.split("\n").filter((p) => SCREEN_FILE.test(p)).sort(
    (a, b) =>
      Number(PLUMBING.test(a)) - Number(PLUMBING.test(b)) ||
      a.localeCompare(b),
  );
  const parts: string[] = [];
  let used = 0;
  for (const path of paths) {
    if (used >= SOURCE_MAX) break;
    let text = await git(dir, ["show", `${commit}:${path}`]);
    if (text.length > FILE_MAX) {
      text = `${text.slice(0, FILE_MAX)}\n[truncated]`;
    }
    text = text.slice(0, SOURCE_MAX - used);
    used += text.length;
    parts.push(`// ${path}\n${text}`);
  }
  return parts.join("\n\n");
}

export function appDesignInput(
  card: string,
  app: string,
): (input: CheckInput) => Promise<string> {
  return async ({ core }) => {
    let screens = "(not available)";
    let code = "(not available)";
    if (core !== null) {
      const found = await findApp(core, app);
      const bp = await core.call(appTools, { app: found.id });
      screens = [
        `app: ${bp.name} - ${bp.description}`,
        ...bp.screens.map((s) =>
          `- ${s.key} "${s.label}" (${s.path}) sizes=${s.sizes.join(",")}`
        ),
      ].join("\n");
      const src = await source(core, app);
      code = (await screenSource(src.dir, src.commit)) || "(no screen files)";
    }
    return joinInput([
      { label: "CARD", text: card },
      { label: "SCREENS", text: screens },
      { label: "SCREEN_SOURCE", text: code },
    ]);
  };
}
