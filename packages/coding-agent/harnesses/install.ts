// 사용자 전역(home 기준)에 skill 둘과 hook 설정을 놓는다. skill은 얇은 안내(절차는 `lophn guide <name>`)이고
// hook은 harness마다 한 번이다. skill과 plugin 파일은 우리 폴더·파일이라 내용이 다르면 덮는다. JSON 설정은 사람이
// 쓴 다른 key·다른 hook을 보존하고 우리 항목(command가 `lophn hook <harness> `나 개발 경로의 `<절대 경로> hook <harness> `로 시작)만 바꾼다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  CODING_SKILL_NAMES,
  CODING_TOKEN_ENV,
  HARNESS_ADAPTERS,
  type HARNESS_INSTALL_OUTCOMES,
  type HarnessId,
  HOOK_EVENT_TABLE,
} from "../../protocol/coding-agent/mod.ts";

type Outcome = (typeof HARNESS_INSTALL_OUTCOMES)[number];

type SkillSource = {
  name: string;
  files: readonly { path: string; content: string }[];
};

export type InstallPorts = {
  // 없으면 null이다.
  read(path: string): Promise<string | null>;
  // 상위 폴더도 만든다.
  write(path: string, text: string): Promise<void>;
  // `CODING_SKILL_NAMES` 각각의 원본이다.
  skills: readonly SkillSource[];
};

type InstallResult = { skill: Outcome; hook: Outcome; files: string[] };

// 한 항목의 결과다. `files`는 쓴(dry_run이면 쓸) 절대 경로다.
type Step = { outcome: Outcome; files: string[] };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownedEntry(harness: HarnessId, entry: unknown): boolean {
  const hooks = (entry as { hooks?: unknown } | null)?.hooks;
  return Array.isArray(hooks) && hooks.some((one) => {
    const command = (one as { command?: unknown } | null)?.command;
    return typeof command === "string" &&
      new RegExp(`^(lophn|/\\S+) hook ${harness} `).test(command);
  });
}

// pi extension 원문이다. 듣는 event는 `HOOK_EVENT_TABLE.pi`다. 조사로 확인하지 못한 API가 있다(host가
// 아직 검증하지 않았다): `ctx.sessionManager.getSessionId()`, `agent_settled`의 `aborted`.
// 전역에 놓으면 lophn과 상관없는 pi 실행마다 불리므로 token이 없으면 아무것도 등록하지 않는다.
function piExtension(command: string): string {
  const events = Object.keys(HOOK_EVENT_TABLE.pi);
  return `// lophn이 놓은 파일이다. pi event를 \`lophn hook pi <event>\`로 넘긴다.
import { spawn } from "node:child_process";

function send(event: string, payload: Record<string, unknown>) {
  try {
    const child = spawn(${JSON.stringify(command)}, ["hook", "pi", event], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => {});
    child.stdin.end(JSON.stringify({ event, ...payload }));
  } catch {
    // hook 실패가 pi를 멈추게 하지 않는다.
  }
}

export default function (pi: any) {
  if (!process.env.${CODING_TOKEN_ENV}) return;
${
    events.map((event) =>
      `  pi.on("${event}", (event: any, ctx: any) => {
    let session_id: string | undefined;
    try {
      session_id = ctx?.sessionManager?.getSessionId?.();
    } catch {
      // session id를 읽지 못하면 싣지 않는다.
    }
    send("${event}", { session_id, aborted: event?.aborted === true });
  });`
    ).join("\n")
  }
}
`;
}

// OpenCode plugin 원문이다. 듣는 event는 `HOOK_EVENT_TABLE.opencode`다. plugin은 root session의 event만 넘긴다
// (hook-signal.ts가 그 전제로 변환한다). 하위 session은 `client.session.get`의 parentID로 가른다. 조회가
// 실패하면 root가 아닌 것으로 보고 넘기지 않는다(하위 session의 idle이 turn 끝으로 잘못 읽히는 쪽이 더 나쁘다).
// SDK 세대마다 get의 인자 모양이 달라 둘 다 시도한다. 전역에 놓으면 lophn과 상관없는 실행마다 불리므로
// token이 없으면 아무 hook도 등록하지 않는다.
function opencodePlugin(command: string): string {
  const events = Object.keys(HOOK_EVENT_TABLE.opencode);
  return `// lophn이 놓은 파일이다. OpenCode event를 \`lophn hook opencode <event>\`로 넘긴다.
import { spawn } from "node:child_process";

const EVENTS = new Set(${JSON.stringify(events)});
const isRoot = new Map();

async function rootSession(client, id) {
  if (isRoot.has(id)) return isRoot.get(id);
  let root = false;
  for (const args of [{ path: { id } }, { sessionID: id }]) {
    try {
      const session = (await client.session.get(args))?.data;
      if (session?.id === id) {
        root = !session.parentID;
        break;
      }
    } catch {
      // 다른 SDK 모양을 시도한다.
    }
  }
  isRoot.set(id, root);
  return root;
}

function send(type, properties) {
  try {
    const child = spawn(${
    JSON.stringify(command)
  }, ["hook", "opencode", type], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ type, properties }));
  } catch {
    // hook 실패가 OpenCode를 멈추게 하지 않는다.
  }
}

export const LophnStatus = async ({ client }) => {
  if (!process.env.${CODING_TOKEN_ENV}) return {};
  return {
    event: async ({ event }) => {
      try {
        if (!EVENTS.has(event?.type)) return;
        const id = event.properties?.sessionID;
        if (typeof id !== "string" || !(await rootSession(client, id))) return;
        send(event.type, event.properties);
      } catch {
        // hook 실패가 OpenCode를 멈추게 하지 않는다.
      }
    },
  };
};
`;
}

// harness별 plugin 파일 원문을 고르는 한 곳이다.
function pluginSource(harness: HarnessId, command: string): string | null {
  switch (harness) {
    case "pi":
      return piExtension(command);
    case "opencode":
      return opencodePlugin(command);
    default:
      return null;
  }
}

// skill은 얇다. 원본의 frontmatter(name, description)를 그대로 쓰고 절차는 guide가 내준다.
function thinSkill(name: string, source: string): string {
  const front = source.match(/^---\n[\s\S]*?\n---\n/)?.[0] ??
    `---\nname: ${name}\n---\n`;
  return `${front}
# ${name}

절차는 \`lophn guide ${name}\`이 내준다. 그 출력을 따른다.
`;
}

async function installSkill(
  ports: InstallPorts,
  home: string,
  skillDir: string,
  dryRun: boolean,
): Promise<Step> {
  const files: string[] = [];
  let failed = false;
  for (const name of CODING_SKILL_NAMES) {
    const source = ports.skills.find((one) => one.name === name)?.files
      .find((file) => file.path === "SKILL.md");
    if (source === undefined) {
      failed = true;
      continue;
    }
    const path = `${home}/${skillDir}/${name}/SKILL.md`;
    const expected = thinSkill(name, source.content);
    const current = await ports.read(path);
    // dry_run은 있으면 됐다(lophn이 업데이트돼도 다시 묻지 않는다).
    if (dryRun ? current !== null : current === expected) continue;
    if (!dryRun) await ports.write(path, expected);
    files.push(path);
  }
  if (failed) return { outcome: "failed", files };
  return { outcome: outcomeOf(files, dryRun), files };
}

function outcomeOf(files: readonly string[], dryRun: boolean): Outcome {
  if (files.length === 0) return "unchanged";
  return dryRun ? "missing" : "installed";
}

// JSON 설정에 `lophn hook <harness> <event>` 항목을 event마다 하나씩 넣는다. 항목 모양은 Claude Code·Codex·
// Gemini CLI가 같다. 파싱되지 않거나 객체가 아니면 쓰지 않고 `failed`다.
async function installJsonHook(
  ports: InstallPorts,
  home: string,
  harness: HarnessId,
  hookPath: string,
  dryRun: boolean,
  command: string | undefined,
): Promise<Step> {
  const path = `${home}/${hookPath}`;
  const events = Object.keys(HOOK_EVENT_TABLE[harness]);
  const ours = (event: string) => ({
    hooks: [{
      type: "command",
      command: `${command ?? "lophn"} hook ${harness} ${event}`,
    }],
  });
  const text = await ports.read(path);
  let doc: Json = {};
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isObject(parsed)) return { outcome: "failed", files: [] };
      doc = parsed;
    } catch {
      return { outcome: "failed", files: [] };
    }
  }
  const hooks = isObject(doc.hooks) ? doc.hooks : {};
  const listOf = (event: string): unknown[] =>
    Array.isArray(hooks[event]) ? hooks[event] as unknown[] : [];
  const upToDate = events.every((event) => {
    const owned = listOf(event).filter((entry) => ownedEntry(harness, entry));
    // dry_run은 있으면 됐다(lophn이 업데이트돼도 다시 묻지 않는다). 개발 command를 받았을 때만 같은지 본다.
    return dryRun && command === undefined
      ? owned.length > 0
      : JSON.stringify(owned) === JSON.stringify([ours(event)]);
  });
  if (upToDate) return { outcome: "unchanged", files: [] };
  if (!dryRun) {
    for (const event of events) {
      hooks[event] = [
        ...listOf(event).filter((entry) => !ownedEntry(harness, entry)),
        ours(event),
      ];
    }
    doc.hooks = hooks;
    const indent = text?.match(/\n(\t| {2,})"/)?.[1] ?? "  ";
    await ports.write(path, `${JSON.stringify(doc, null, indent)}\n`);
  }
  return { outcome: dryRun ? "missing" : "installed", files: [path] };
}

async function installPluginFile(
  ports: InstallPorts,
  home: string,
  harness: HarnessId,
  hookPath: string,
  dryRun: boolean,
  command: string | undefined,
): Promise<Step> {
  const expected = pluginSource(harness, command ?? "lophn");
  if (expected === null) return { outcome: "not_supported", files: [] };
  const path = `${home}/${hookPath}`;
  const current = await ports.read(path);
  if (
    dryRun && command === undefined ? current !== null : current === expected
  ) {
    return { outcome: "unchanged", files: [] };
  }
  if (!dryRun) await ports.write(path, expected);
  return { outcome: dryRun ? "missing" : "installed", files: [path] };
}

export async function installGlobal(
  ports: InstallPorts,
  input: {
    harness: HarnessId;
    home: string;
    dryRun: boolean;
    // 개발 실행의 hook command(절대 경로). 없으면 PATH의 `lophn`이다.
    command?: string;
  },
): Promise<Result<InstallResult>> {
  const adapter = HARNESS_ADAPTERS[input.harness];
  const home = input.home.replace(/\/+$/, "");
  const none: Step = { outcome: "not_supported", files: [] };
  try {
    const skill = adapter.skill_dir === null
      ? none
      : await installSkill(ports, home, adapter.skill_dir, input.dryRun);
    const hook = adapter.hook === null
      ? none
      : adapter.hook.format === "json"
      ? await installJsonHook(
        ports,
        home,
        input.harness,
        adapter.hook.path,
        input.dryRun,
        input.command,
      )
      : await installPluginFile(
        ports,
        home,
        input.harness,
        adapter.hook.path,
        input.dryRun,
        input.command,
      );
    return ok({
      skill: skill.outcome,
      hook: hook.outcome,
      files: [...skill.files, ...hook.files],
    });
  } catch {
    return err({
      code: "unavailable",
      message: "harness 전역 설정에 쓰지 못했다",
    });
  }
}
