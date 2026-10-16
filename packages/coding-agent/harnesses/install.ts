// 앱 source 폴더에 skill 둘과 hook 설정을 놓는다. 폴더 안만 쓰고 사용자 전역 설정은 건드리지 않는다.
// 사람이 고친 파일은 덮지 않는다. 이를 알려고 lophn이 마지막에 쓴 내용의 hash만 `.lophn/installed.json`에
// 남긴다(앱 source 폴더의 git에 넣지 않는 위치). 그 hash와 지금 내용이 다르면 `kept_user_edit`이다.
import { err, ok, type Result, sha256Hex } from "../../base/mod.ts";
import {
  CODING_SKILL_NAMES,
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

type InstallResult = { skill: Outcome; hook: Outcome };

const RECORD_PATH = ".lophn/installed.json";

type Record_ = Record<string, string>;

// lophn이 놓은 hook 항목을 알아보는 command 앞부분이다.
function commandOf(harness: HarnessId, event: string): string {
  return `lophn hook ${harness} ${event}`;
}

function ownedEntry(harness: HarnessId, entry: unknown): boolean {
  const hooks = (entry as { hooks?: unknown } | null)?.hooks;
  return Array.isArray(hooks) && hooks.some((one) => {
    const command = (one as { command?: unknown } | null)?.command;
    return typeof command === "string" &&
      command.startsWith(`lophn hook ${harness} `);
  });
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// pi extension 원문이다. 듣는 event는 `HOOK_EVENT_TABLE.pi`다. 조사로 확인하지 못한 API가 있다(host가
// 아직 검증하지 않았다): `pi.on(event, handler)`, `ctx.sessionManager.getSessionId()`, `agent_settled`의
// `aborted`.
function piExtension(): string {
  const events = Object.keys(HOOK_EVENT_TABLE.pi);
  return `// lophn이 놓은 파일이다. pi event를 \`lophn hook pi <event>\`로 넘긴다.
import { spawn } from "node:child_process";

function send(event: string, payload: Record<string, unknown>) {
  try {
    const child = spawn("lophn", ["hook", "pi", event], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => {});
    child.stdin.end(JSON.stringify({ event, ...payload }));
  } catch {
    // hook 실패가 pi를 멈추게 하지 않는다.
  }
}

export default function (pi: any) {
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

// 파일 하나를 정한 내용으로 맞춘다. 마지막에 lophn이 쓴 내용이면 갱신하고 아니면 사람이 고친 것이라 둔다.
async function put(
  ports: InstallPorts,
  folder: string,
  record: Record_,
  path: string,
  expected: string,
): Promise<Outcome> {
  const current = await ports.read(`${folder}/${path}`);
  const expectedHash = await sha256Hex(expected);
  if (current === expected) {
    record[path] = expectedHash;
    return "unchanged";
  }
  if (current !== null && record[path] !== await sha256Hex(current)) {
    return "kept_user_edit";
  }
  await ports.write(`${folder}/${path}`, expected);
  record[path] = expectedHash;
  return "installed";
}

// 여러 결과를 하나로 묶는다. 앞일수록 먼저 보인다.
function worst(list: readonly Outcome[]): Outcome {
  for (const one of ["failed", "kept_user_edit", "installed"] as const) {
    if (list.includes(one)) return one;
  }
  return "unchanged";
}

async function installSkill(
  ports: InstallPorts,
  folder: string,
  record: Record_,
  skillDir: string,
): Promise<Outcome> {
  const list: Outcome[] = [];
  for (const name of CODING_SKILL_NAMES) {
    const source = ports.skills.find((one) => one.name === name);
    if (source === undefined) return "failed";
    for (const file of source.files) {
      list.push(
        await put(
          ports,
          folder,
          record,
          `${skillDir}/${name}/${file.path}`,
          file.content,
        ),
      );
    }
  }
  return worst(list);
}

// JSON 설정에 `lophn hook <harness> <event>` 항목을 event마다 하나씩 넣는다. lophn이 놓은 항목만 바꾸고
// 나머지는 그대로 둔다. 항목 모양은 Claude Code·Codex·Gemini CLI가 같다.
async function installJsonHook(
  ports: InstallPorts,
  folder: string,
  record: Record_,
  harness: HarnessId,
  path: string,
): Promise<Outcome> {
  const events = Object.keys(HOOK_EVENT_TABLE[harness]);
  const ours = (event: string) => ({
    hooks: [{ type: "command", command: commandOf(harness, event) }],
  });
  const text = await ports.read(`${folder}/${path}`);
  let doc: Json = {};
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isObject(parsed)) return "kept_user_edit";
      doc = parsed;
    } catch {
      return "kept_user_edit";
    }
  }
  const hooks = isObject(doc.hooks) ? doc.hooks : {};
  const owned = (list: unknown) =>
    (Array.isArray(list) ? list : []).filter((entry) =>
      ownedEntry(harness, entry)
    );
  const currentOwned = events.map((event) => owned(hooks[event]));
  const expectedOwned = events.map((event) => [ours(event)]);
  const currentHash = await sha256Hex(JSON.stringify(currentOwned));
  const expectedHash = await sha256Hex(JSON.stringify(expectedOwned));
  if (currentHash === expectedHash) {
    record[path] = expectedHash;
    return "unchanged";
  }
  const anyOwned = currentOwned.some((list) => list.length > 0);
  if (anyOwned && record[path] !== currentHash) return "kept_user_edit";
  for (const event of events) {
    const rest = (Array.isArray(hooks[event]) ? hooks[event] as unknown[] : [])
      .filter((entry) => !ownedEntry(harness, entry));
    hooks[event] = [...rest, ours(event)];
  }
  doc.hooks = hooks;
  const indent = text?.match(/\n(\t| {2,})"/)?.[1] ?? "  ";
  await ports.write(
    `${folder}/${path}`,
    `${JSON.stringify(doc, null, indent)}\n`,
  );
  record[path] = expectedHash;
  return "installed";
}

export async function installIntoFolder(
  ports: InstallPorts,
  input: { harness: HarnessId; folder: string },
): Promise<Result<InstallResult>> {
  const adapter = HARNESS_ADAPTERS[input.harness];
  const folder = input.folder.replace(/\/+$/, "");
  let record: Record_ = {};
  try {
    const text = await ports.read(`${folder}/${RECORD_PATH}`);
    const parsed: unknown = text === null ? {} : JSON.parse(text);
    if (isObject(parsed)) record = parsed as Record_;
  } catch {
    // 읽지 못하면 lophn이 쓴 것을 모른다. 있는 파일은 모두 사람이 고친 것으로 둔다.
  }
  const before = JSON.stringify(record);
  let skill: Outcome = "not_supported";
  let hook: Outcome = "not_supported";
  try {
    if (adapter.skill_dir !== null) {
      skill = await installSkill(ports, folder, record, adapter.skill_dir);
    }
    if (adapter.hook?.format === "json") {
      hook = await installJsonHook(
        ports,
        folder,
        record,
        input.harness,
        adapter.hook.path,
      );
    } else if (adapter.hook?.format === "plugin_file") {
      hook = await put(ports, folder, record, adapter.hook.path, piExtension());
    }
    if (JSON.stringify(record) !== before) {
      await ports.write(
        `${folder}/${RECORD_PATH}`,
        `${JSON.stringify(record, null, 2)}\n`,
      );
    }
  } catch {
    return err({
      code: "unavailable",
      message: "앱 source 폴더에 쓰지 못했다",
    });
  }
  return ok({ skill, hook });
}
