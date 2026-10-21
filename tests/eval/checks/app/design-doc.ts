// App Engineer가 앱 source root에 쓰는 DESIGN.md를 기록과 켜진 release에서 읽는다. 지침(app-engineer prompt "Designing the app")의 일곱 절과 순서가 기준이다.
import type { Core } from "../../../support/core/mod.ts";
import type {
  CollectedToolCall,
  ProgramCheck,
  TrialRecord,
} from "../../types.ts";
import { git, source } from "./reuse.ts";

export const DESIGN_SECTIONS = [
  "Purpose",
  "Reuse",
  "Model",
  "Journeys",
  "Screens",
  "Tools",
  "Failure branches",
] as const;

// 그 앱 App Engineer session들의 tool call. 재시도에 밀린 행을 빼고 id(ULID, 시간 순) 순이다.
export function appEngineerCalls(
  trial: TrialRecord,
  app: string,
): CollectedToolCall[] {
  const all = trial.sessions
    .filter((s) => s.agent.role === "app_engineer" && s.place?.name === app)
    .flatMap((s) => s.tool_calls);
  const superseded = new Set(all.map((c) => c.call.retry_of));
  return all.filter((c) => !superseded.has(c.call.id))
    .sort((a, b) => a.call.id < b.call.id ? -1 : a.call.id > b.call.id ? 1 : 0);
}

// 상대 path의 기준은 place 첫 폴더인 앱 source고, 앱 source는 `<app 폴더>/source`다.
function isDesignPath(path: unknown): boolean {
  if (typeof path !== "string") return false;
  return path.replace(/^\.\//, "") === "DESIGN.md" ||
    path.endsWith("/source/DESIGN.md");
}

// file tool로 쓴 DESIGN.md를 차례로 되풀이해 마지막 글을 만든다. shell.run으로 쓴 것은 세지 않는다.
export function designText(calls: CollectedToolCall[]): string | null {
  let text: string | null = null;
  for (const c of calls) {
    if (c.call.outcome?.kind !== "success") continue;
    const input = c.input as Record<string, unknown> | null;
    if (input === null || !isDesignPath(input.path)) continue;
    if (c.call.tool === "file.write" && typeof input.content === "string") {
      text = input.content;
    } else if (
      c.call.tool === "file.edit" && text !== null &&
      typeof input.old_string === "string" &&
      typeof input.new_string === "string"
    ) {
      text = input.replace_all === true
        ? text.replaceAll(input.old_string, input.new_string)
        : text.replace(input.old_string, () => input.new_string as string);
    }
  }
  return text;
}

const headOf = (line: string) => line.slice(3).trim().toLowerCase();

// `## ` 머리가 name으로 시작하는 첫 절의 본문. 다음 `## `이나 `# ` 머리 앞까지다.
export function designSection(text: string, name: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) =>
    l.startsWith("## ") && headOf(l).startsWith(name.toLowerCase())
  );
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## ") || l.startsWith("# "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

// 머리를 위에서부터 읽으며 절을 순서대로 맞춘다. 사이의 다른 머리는 괜찮다.
export function missingSections(text: string): string[] {
  const heads = text.split("\n").filter((l) => l.startsWith("## ")).map(headOf);
  let at = 0;
  const missing: string[] = [];
  for (const name of DESIGN_SECTIONS) {
    const found = heads.findIndex((h, i) =>
      i >= at && h.startsWith(name.toLowerCase())
    );
    if (found === -1) missing.push(name);
    else at = found + 1;
  }
  return missing;
}

export function designFirst(id: string, opts: { app: string }): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial }) {
      const calls = appEngineerCalls(trial, opts.app);
      const first = calls.findIndex((c) => c.call.tool === "release.prepare");
      if (first === -1) {
        return { pass: false, reason: "release.prepare가 없음" };
      }
      const text = designText(calls.slice(0, first));
      if (text === null) {
        return {
          pass: false,
          reason: "첫 release.prepare 앞에 DESIGN.md를 쓰지 않음",
        };
      }
      const missing = missingSections(text);
      return missing.length === 0
        ? {
          pass: true,
          reason: "첫 release.prepare 앞에 일곱 절 DESIGN.md가 있음",
        }
        : { pass: false, reason: `DESIGN.md에 없는 절: ${missing.join(", ")}` };
    },
  };
}

// fixture(core === null)는 기록에서, 끝난 world는 켜진 release commit에서 읽는다.
export async function designOf(
  { trial, core }: { trial: TrialRecord; core: Core | null },
  app: string,
): Promise<string | null> {
  if (core === null) return designText(appEngineerCalls(trial, app));
  try {
    const src = await source(core, app);
    return await git(src.dir, ["show", `${src.commit}:DESIGN.md`]);
  } catch {
    return null;
  }
}

export const JUDGE_SECTION_MAX = 12_000;

export function clip(text: string): string {
  return text.length > JUDGE_SECTION_MAX
    ? `${text.slice(0, JUDGE_SECTION_MAX)}\n[truncated]`
    : text;
}
