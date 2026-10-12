// 시험 전용 앱 자식 entry. 실제 runtime entrypoint(start 입력 검사·서명 검증·direct socket·command
// 경계)와 SDK의 화면 context 등록(registerScreenContext·registerAnnotationTarget)을 그대로 쓴다.
// blueprint는 entry 옆의 blueprint.json이다. view session의 상태는 이 앱이 갖는다.
import { createIdSource, systemClock } from "@lophn/base";
import { validateBlueprint } from "../../../../packages/core/apps/blueprint/mod.ts";
import { startDirectServer } from "../../../../packages/core/apps/runtime/entrypoint/direct-server.ts";
import { startRuntime } from "../../../../packages/core/apps/runtime/entrypoint/startup.ts";
import {
  registerAnnotationTarget,
  registerScreenContext,
} from "../../../../packages/sdk/cap-schedule/mod.ts";

const decoder = new TextDecoder();

async function readLine(): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = Deno.stdin.readable.getReader();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    text = decoder.decode(
      new Uint8Array(chunks.flatMap((chunk) => [...chunk])),
    );
  }
  return text;
}

const mainDir = new URL("./", Deno.mainModule);
const parsed = validateBlueprint(
  JSON.parse(await Deno.readTextFile(new URL("blueprint.json", mainDir))),
);
if (!parsed.ok) throw new Error(parsed.error.message);
const blueprint = parsed.value;
const clock = systemClock;
const started = startRuntime({
  line: await readLine(),
  blueprint,
  clock,
  ids: createIdSource({
    clock,
    random: { fill: (bytes: Uint8Array) => crypto.getRandomValues(bytes) },
  }),
  broker: () => Promise.resolve({ status: 503, body: null }),
  dataSchema: 0,
  screenBytes: (screen, path) =>
    new TextEncoder().encode(`screen ${screen} ${path}`),
});

const NOTE = "private-note-9f3c";
type View = { revision: number; hints: string[] };
const views = new Map<string, View>();

function view(id: string): View | undefined {
  // 화면을 연 session만 상태가 있다. 연 적 없는 session은 모른다.
  if (!started.state.views.has(id)) return undefined;
  let found = views.get(id);
  if (!found) {
    found = { revision: 1, hints: [] };
    views.set(id, found);
  }
  return found;
}

registerScreenContext({
  screen: "usage",
  command: "ctx.read",
  read({ view_session, detail }) {
    const found = view(view_session);
    if (!found) return undefined;
    return {
      revision: `r${found.revision}`,
      summary: `code of ${view_session}; ${found.hints.length} hints`,
      data: detail
        ? { code: `code of ${view_session}`, hints: found.hints, note: NOTE }
        : undefined,
    };
  },
});
registerAnnotationTarget({
  screen: "usage",
  target: "hint",
  command: "ctx.hint",
  write({ view_session, text }) {
    const found = view(view_session)!;
    found.hints.push(text);
    found.revision += 1;
    return { revision: `r${found.revision}` };
  },
});
console.log("screen context app started");
startDirectServer(started.state);
