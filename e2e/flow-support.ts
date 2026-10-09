// flow E2E 공용 조립. 실제 shell(headless Electron)과 실제 core·documents worker·I/O worker·
// format runner를 임시 LOPHN_HOME으로 띄우고, 사람이 하는 조작은 두 길로만 한다.
// - 화면: renderer DOM에 입력·클릭을 보내고 DOM을 읽는다.
// - 사람 command: shell preload가 renderer에 여는 core 통로(`window.lophnCore`)로 같은 사람
//   token의 command·read를 부른다. 화면이 아직 없는 사람 조작(프로젝트 등록 같은 것)만 이 길로
//   하고, 어느 flow 단계가 그렇게 되었는지는 각 flow 시험 머리에 적는다.
// 실제 ~/.lophn은 읽지도 쓰지도 않는다. 화면은 사람 화면에 띄우지 않는다(headless).
import { assert, assertEquals } from "@std/assert";

import { directoryScanner } from "../packages/documents/projects/scan.ts";
import { previewTracking } from "../packages/documents/projects/work.ts";
import { READY_TIMEOUT_MS } from "./harness.ts";
import { launchShell, type RunningShell } from "./run.ts";

export const repoRoot = new URL("../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
const electronExecutable =
  `${repoRoot}/apps/shell/main/node_modules/electron/dist/electron`;
const shellApp = `${repoRoot}/apps/shell/main/dist/main.cjs`;

async function runBuild(args: string[], failure: string): Promise<void> {
  const build = new Deno.Command(args[0], {
    args: args.slice(1),
    stdout: "null",
    stderr: "inherit",
  });
  assertEquals((await build.output()).code, 0, failure);
}

let built: Promise<void> | undefined;

/** shell main과 renderer를 build한다. 한 process에서 한 번만 한다. */
export function buildShell(): Promise<void> {
  built ??= (async () => {
    await runBuild(
      ["npm", "--prefix", `${repoRoot}/apps/shell/main`, "run", "build"],
      "shell main build 실패",
    );
    await runBuild(
      [
        "deno",
        "run",
        "--allow-all",
        `${repoRoot}/apps/shell/renderer/build.ts`,
      ],
      "shell renderer build 실패",
    );
  })();
  return built;
}

function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type CoreReply = {
  ok: boolean;
  value?: unknown;
  error?: { code: string; message: string };
};

export type CoreCall = {
  kind: "read" | "command" | "worker";
  resource: string;
  method: string;
  body: unknown;
};

export interface FlowShell {
  readonly shell: RunningShell;
  /** 창을 다시 읽는다. 화면이 처음 한 번만 읽는 목록(자리 선택지)을 새로 받는다. */
  reload(): Promise<void>;
  /** 임시 LOPHN_HOME. */
  readonly home: string;
  /** shell preload의 core 통로로 사람 token의 read·command·worker 읽기를 부른다. */
  call(call: CoreCall): Promise<CoreReply>;
  /** 조건 식이 truthy가 될 때까지 기다린다. 한계 안에 안 되면 마지막 값을 담아 던진다. */
  until(
    expression: string,
    what: string,
    timeoutMs?: number,
  ): Promise<unknown>;
  /** DOM에서 표현식을 평가한다. */
  evaluate(expression: string): Promise<unknown>;
  /** input에 글을 쓴다(React 제어 입력이 변화를 알도록 native setter와 input event). */
  type(selector: string, text: string): Promise<void>;
  /** 요소를 click한다. */
  click(selector: string): Promise<void>;
  /**
   * 실제 마우스 입력으로 요소를 누른다. Radix Select·메뉴처럼 pointer 입력으로만 열리는
   * 요소에 쓴다. 요소 중심 좌표로 mouse 이벤트를 보낸다.
   */
  mouseClick(selector: string): Promise<void>;
  /** `selector`로 고른 요소 중 글이 `text`인 것을 실제 마우스 입력으로 누른다. */
  mouseClickText(selector: string, text: string): Promise<void>;
  /** Select를 열어 글이 `option`인 선택지를 고른다. */
  choose(trigger: string, option: string): Promise<void>;
  /** 요소의 눈에 보이는 글. 없으면 null이다. */
  text(selector: string): Promise<string | null>;
  /** 요소가 몇 개인지. */
  count(selector: string): Promise<number>;
  /** 글이 있는 요소를 고른 selector 목록의 글을 모은다. */
  texts(selector: string): Promise<string[]>;
  close(): Promise<void>;
}

export interface FlowOptions {
  /** `LOPHN_SHELL_START` 값. 기본은 런처, `lophn`은 lophn 공간(documents)이다. */
  start?:
    | "lophn"
    | "conversation"
    | "things-to-confirm"
    | "instructions:global"
    | "settings"
    | `project:${string}`
    | `app:${string}`;
  /** 이미 있는 데이터 root를 다시 연다(core를 다시 띄운 뒤에도 남는 것을 본다). */
  home?: string;
  /** shell·core·그 child에 더 줄 환경 변수(PATH·HOME·LOPHN_CLI 같은 fixture 자리). */
  env?: Record<string, string>;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

/** headless shell과 그 core를 띄운다. 끝나면 `close()`를 꼭 부른다. */
export async function openFlowShell(
  options: FlowOptions = {},
): Promise<FlowShell> {
  await buildShell();
  const home = options.home ??
    await Deno.makeTempDir({ prefix: "lophn-e2e-flow-" });
  const shell = await launchShell({
    executable: electronExecutable,
    app: shellApp,
    home,
    port: freePort(),
    env: {
      // 시험은 사람 화면에 창을 띄우지 않는다. 창은 숨기고 offscreen으로만 그린다.
      LOPHN_SHELL_HEADLESS: "1",
      ...(options.start === undefined
        ? {}
        : { LOPHN_SHELL_START: options.start }),
      ...options.env,
    },
  });
  const evaluate = (expression: string) => shell.evaluate(expression);
  let desktop: Awaited<ReturnType<RunningShell["connect"]>> | undefined;
  const flow: FlowShell = {
    shell,
    home,
    evaluate,
    async call(call) {
      // core가 아직 준비되지 않았으면 준비될 때까지 다시 부른다(창이 먼저 뜬다).
      const deadline = Date.now() + READY_TIMEOUT_MS;
      for (;;) {
        const reply = await evaluate(
          `window.lophnCore.call(${
            JSON.stringify(call)
          }).then((reply) => JSON.stringify(reply))`,
        );
        assert(typeof reply === "string", "core 통로가 답하지 않았다");
        const parsed = JSON.parse(reply) as CoreReply;
        const notReady = !parsed.ok && parsed.error?.code === "unavailable" &&
          parsed.error.message === "core가 준비되지 않았다";
        if (!notReady || Date.now() > deadline) return parsed;
        await delay(250);
      }
    },
    async until(expression, what, timeoutMs = READY_TIMEOUT_MS) {
      const deadline = Date.now() + timeoutMs;
      let last: unknown;
      while (Date.now() < deadline) {
        try {
          last = await evaluate(expression);
        } catch (error) {
          last = String(error);
        }
        if (last) return last;
        await delay(200);
      }
      throw new Error(
        `${what}: 기대한 화면 상태가 오지 않았다 (${JSON.stringify(last)})`,
      );
    },
    async type(selector, text) {
      const typed = await evaluate(`(() => {
        const input = document.querySelector(${quote(selector)});
        if (!input) return false;
        const proto = input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(input, ${
        quote(text)
      });
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      assertEquals(typed, true, `입력칸이 없다: ${selector}`);
    },
    async click(selector) {
      const clicked = await evaluate(`(() => {
        const el = document.querySelector(${quote(selector)});
        if (!el) return false;
        el.click();
        return true;
      })()`);
      assertEquals(clicked, true, `누를 요소가 없다: ${selector}`);
    },
    async mouseClick(selector) {
      const target = await evaluate(`(() => {
        const el = document.querySelector(${quote(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: "center", inline: "center" });
        const rect = el.getBoundingClientRect();
        return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      })()`);
      assert(typeof target === "string", `누를 요소가 없다: ${selector}`);
      const point = JSON.parse(target) as { x: number; y: number };
      desktop ??= await shell.connect("://desktop/");
      const base = { x: point.x, y: point.y, button: "left", clickCount: 1 };
      await desktop.command("Input.dispatchMouseEvent", {
        ...base,
        type: "mouseMoved",
        button: "none",
      });
      await desktop.command("Input.dispatchMouseEvent", {
        ...base,
        type: "mousePressed",
      });
      await desktop.command("Input.dispatchMouseEvent", {
        ...base,
        type: "mouseReleased",
      });
    },
    async mouseClickText(selector, text) {
      const marked = await evaluate(`(() => {
        for (const old of document.querySelectorAll("[data-flow-text]")) {
          old.removeAttribute("data-flow-text");
        }
        const item = [...document.querySelectorAll(${quote(selector)})]
          .find((el) => el.textContent?.trim() === ${quote(text)});
        if (!item) return false;
        item.setAttribute("data-flow-text", "");
        return true;
      })()`);
      assertEquals(marked, true, `글이 ${text}인 요소가 없다: ${selector}`);
      await flow.mouseClick("[data-flow-text]");
    },
    async choose(trigger, option) {
      await flow.mouseClick(trigger);
      await flow.until(
        `document.querySelector("[role=listbox]") !== null`,
        `선택지가 열리지 않았다: ${trigger}`,
      );
      // 선택지 글로 요소를 표시하고 그 표시로 누른다.
      const marked = await evaluate(`(() => {
        const item = [...document.querySelectorAll("[role=option]")]
          .find((el) => el.textContent?.trim() === ${quote(option)});
        if (!item) return false;
        item.setAttribute("data-flow-choice", "");
        return true;
      })()`);
      assertEquals(marked, true, `선택지가 없다: ${option}`);
      await flow.mouseClick("[data-flow-choice]");
      await flow.until(
        `document.querySelector("[role=listbox]") === null`,
        "선택지가 닫히지 않았다",
      );
    },
    async text(selector) {
      const value = await evaluate(
        `document.querySelector(${quote(selector)})?.textContent ?? null`,
      );
      return typeof value === "string" ? value : null;
    },
    async count(selector) {
      return Number(
        await evaluate(
          `document.querySelectorAll(${quote(selector)}).length`,
        ),
      );
    },
    async texts(selector) {
      const found = await evaluate(
        `JSON.stringify([...document.querySelectorAll(${
          quote(selector)
        })].map((el) => el.textContent ?? ""))`,
      );
      return JSON.parse(String(found)) as string[];
    },
    async reload() {
      await evaluate(`(() => { location.reload(); return true; })()`);
      await delay(500);
      await flow.until(
        `document.querySelector("[data-space]") !== null && document.querySelector("[data-connection]") === null && document.querySelector("[data-search-input]") !== null`,
        "창을 다시 읽은 뒤 화면이 서지 않았다",
      );
    },
    async close() {
      await shell.close();
    },
  };
  // core 연결이 준비될 때까지: 준비 전에는 data-connection 표시가 있다.
  await flow.until(
    `document.querySelector("[data-space]") !== null && document.querySelector("[data-connection]") === null`,
    "창이 core 준비 상태가 되지 않았다",
  );
  return flow;
}

/** 임시 home을 지운다. close 뒤에 부른다. */
export async function removeHome(home: string): Promise<void> {
  await Deno.remove(home, { recursive: true });
}

export const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";

let keys = 0;

/** 사람 command 본문. 같은 key의 재전송은 같은 결과라 호출마다 새 key를 쓴다. */
export function commandBody(
  input: unknown,
  compare: unknown = {},
): { input: unknown; idempotency_key: string; compare: unknown; prepared: [] } {
  keys += 1;
  return {
    input,
    idempotency_key: `flow-${Date.now()}-${keys}`,
    compare,
    prepared: [],
  };
}

/** call이 성공해야 하는 곳. 실패하면 오류를 그대로 담아 던진다. */
export async function mustCall(
  flow: FlowShell,
  call: CoreCall,
): Promise<Record<string, unknown>> {
  const reply = await flow.call(call);
  assert(reply.ok, `${call.resource}/${call.method}: ${JSON.stringify(reply)}`);
  return reply.value as Record<string, unknown>;
}

/** 문서 목록의 한 줄. 화면이 아니라 사람 token의 documents/list 읽기 결과다. */
export type Listed = {
  id: string;
  title: string;
  name: string | null;
  revision: string;
  status: string;
  latest_version: string;
  format: string;
};

export type TrackingOptions = {
  folder: string;
  globs?: readonly string[];
  useGitignore?: boolean;
  enabled?: boolean;
};

/**
 * 사람이 프로젝트를 등록한다. 추적은 켜지 않는다(등록과 추적은 다르다, documents/projects#R3).
 * launcher의 등록 화면은 shell#T15 몫이라 아직 없어서 같은 사람 command를 core 통로로 낸다.
 */
export async function registerProject(
  flow: FlowShell,
  options: { folder: string; id?: string; name?: string; title?: string },
): Promise<{ project: string; revision: string }> {
  const project = options.id ?? PROJECT;
  const created = await mustCall(flow, {
    kind: "command",
    resource: "projects",
    method: "create",
    body: commandBody({
      id: project,
      name: options.name ?? "alpha",
      title: options.title ?? "Alpha",
      purpose: "",
      folders: [{ path: options.folder, description: "" }],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    }),
  });
  return { project, revision: String(created.revision) };
}

/** 추적 규칙 변경 command 본문. 미리보기는 같은 계산을 시험이 직접 한다. */
function trackingChange(
  project: string,
  revision: string,
  options: TrackingOptions,
) {
  const folders = [{ path: options.folder, description: "" }];
  const tracking = {
    enabled: options.enabled ?? true,
    patterns: (options.globs ?? ["**/*.md"]).map((glob) => ({
      effect: "include" as const,
      glob,
    })),
    use_gitignore: options.useGitignore ?? false,
  };
  const preview = previewTracking(directoryScanner(), {
    project,
    baseRevision: revision,
    folders,
    tracking,
    observedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z"),
  });
  assert(preview.ok, "추적 미리보기를 계산하지 못했다");
  return commandBody(
    { project, folders, tracking, preview: preview.value },
    { base_revision: revision },
  );
}

/** 추적을 켜거나 끄는 call. 결과는 호출자가 본다(겹침 같은 거절을 확인한다). */
export function setTracking(
  flow: FlowShell,
  project: string,
  revision: string,
  options: TrackingOptions,
): Promise<CoreReply> {
  return flow.call({
    kind: "command",
    resource: "projects",
    method: "set_tracking",
    body: trackingChange(project, revision, options),
  });
}

/**
 * 사람이 프로젝트를 등록하고 파일 추적을 켠다. 미리보기 화면과
 * `/v1/projects/preview_tracking`은 core가 서빙하지만(documents#T12) shell main의 renderer
 * 통로 allowlist에 아직 없어서 그 화면(shell#T15)이 열 때까지 미리보기는 시험이 계산한다.
 */
export async function registerTrackedProject(
  flow: FlowShell,
  options: TrackingOptions & {
    id?: string;
    name?: string;
    title?: string;
  },
): Promise<{ project: string; revision: string }> {
  const registered = await registerProject(flow, options);
  const applied = await setTracking(
    flow,
    registered.project,
    registered.revision,
    options,
  );
  assert(applied.ok, `set_tracking: ${JSON.stringify(applied)}`);
  return {
    project: registered.project,
    revision: String((applied.value as { revision: string }).revision),
  };
}

/** 문서 목록(사람 token). 보관 문서를 포함할지는 status로 고른다. */
export async function listDocuments(
  flow: FlowShell,
  status?: "active" | "archived",
): Promise<Listed[]> {
  const value = await mustCall(flow, {
    kind: "read",
    resource: "documents",
    method: "list",
    body: status === undefined ? {} : { status },
  });
  const rows = value.documents as {
    document: {
      id: string;
      title: string;
      name: string | null;
      revision: string;
      status: string;
    };
    latest_version: { id: string; format: { name: string } };
  }[];
  return rows.map((row) => ({
    id: row.document.id,
    title: row.document.title,
    name: row.document.name,
    revision: row.document.revision,
    status: row.document.status,
    latest_version: row.latest_version.id,
    format: row.latest_version.format.name,
  }));
}

/** 제목으로 문서 하나를 찾는다. 없으면 던진다. */
export async function documentTitled(
  flow: FlowShell,
  title: string,
  status?: "active" | "archived",
): Promise<Listed> {
  const found = (await listDocuments(flow, status)).find((row) =>
    row.title === title
  );
  assert(found !== undefined, `문서가 없다: ${title}`);
  return found;
}

/** 파일 관측이 새 판·새 문서를 만들 때까지 기다린다. */
export async function untilDocuments(
  flow: FlowShell,
  titles: readonly string[],
  what: string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const have = new Set((await listDocuments(flow)).map((row) => row.title));
    if (titles.every((title) => have.has(title))) return;
    assert(Date.now() < deadline, `${what}: 문서가 아직 없다 ${[...have]}`);
    await delay(250);
  }
}

export type Coverage = {
  lagging: boolean;
  rebuilding: boolean;
  omissions: unknown[];
};

/** 검색을 사람 token으로 한 번 한다(화면과 같은 worker route). */
export async function searchOnce(
  flow: FlowShell,
  query: string,
): Promise<
  {
    results: { document: string; section: string | null }[];
    coverage: Coverage;
  }
> {
  const value = await mustCall(flow, {
    kind: "worker",
    resource: "search",
    method: "query",
    body: { query },
  });
  return value as never;
}

/** index가 따라와 뒤처짐 없이 조건을 채울 때까지 기다린다. */
export async function untilSearch(
  flow: FlowShell,
  query: string,
  done: (page: Awaited<ReturnType<typeof searchOnce>>) => boolean,
  what: string,
): Promise<Awaited<ReturnType<typeof searchOnce>>> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const page = await searchOnce(flow, query);
    if (!page.coverage.lagging && done(page)) return page;
    assert(Date.now() < deadline, `${what}: ${JSON.stringify(page)}`);
    await delay(250);
  }
}

/** 문서의 최신 판 section 상태가 `status`가 될 때까지 기다린다(추출은 판을 뒤따른다). */
export async function untilSectionStatus(
  flow: FlowShell,
  document: string,
  status: string,
  what: string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const reply = await flow.call({
      kind: "worker",
      resource: "outline",
      method: "document",
      body: { reference: { document, version: null, section: null } },
    });
    if (
      reply.ok &&
      (reply.value as { section_status: string }).section_status === status
    ) return;
    assert(Date.now() < deadline, `${what}: ${JSON.stringify(reply)}`);
    await delay(250);
  }
}

/**
 * 사람이 폴더 하나를 프로젝트로 등록해 추적을 켠 뒤, 그 project의 작업대를 연다. 등록은 launcher
 * 화면이 아니라 같은 사람 command를 core 통로로 내고(first-project가 화면 조작을 따로 본다),
 * 작업대는 core를 다시 띄워 그 프로젝트부터 연다. 첫 문서(폴더의 `*.md` 하나)의 id를 함께 준다.
 */
export async function openProjectWorkspace(
  options: { folder: string; name: string; title: string; document: string },
): Promise<{ flow: FlowShell; documentId: string }> {
  const setup = await openFlowShell();
  const home = setup.home;
  let documentId: string;
  try {
    await registerTrackedProject(setup, {
      folder: options.folder,
      name: options.name,
      title: options.title,
    });
    await untilDocuments(
      setup,
      [options.document],
      "추적한 파일이 문서가 되지 않았다",
    );
    documentId = (await documentTitled(setup, options.document)).id;
  } finally {
    await setup.close();
  }
  const flow = await openFlowShell({ home, start: `project:${PROJECT}` });
  await flow.until(
    `document.querySelector("[data-space]")?.getAttribute("data-space") === "project"`,
    "project 작업대가 서지 않았다",
  );
  return { flow, documentId };
}

/** 문서의 고정 판 이력을 번호 큰 순서로 준다(사람 token의 documents/history 읽기). */
export async function versionHistory(
  flow: FlowShell,
  document: string,
): Promise<
  { id: string; number: number; saved_by: string; content_hash: string }[]
> {
  const value = await mustCall(flow, {
    kind: "read",
    resource: "documents",
    method: "history",
    body: { document },
  });
  return (value.versions as {
    id: string;
    number: number;
    saved_by: string;
    content_hash: string;
  }[]).toSorted((left, right) => right.number - left.number);
}

/** 판이 `count`개가 될 때까지 기다린다(파일 관측이 새 판을 만든다). */
export async function untilVersions(
  flow: FlowShell,
  document: string,
  count: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const rows = await versionHistory(flow, document);
    if (rows.length >= count) return;
    assert(Date.now() < deadline, `${what}: 판이 ${rows.length}개`);
    await delay(250);
  }
}

/** 편집기(CodeMirror) 글 끝에 커서를 두고 글을 입력한다(실제 입력 event). */
export async function typeAtEnd(flow: FlowShell, text: string): Promise<void> {
  await flow.evaluate(
    `(() => { const line = [...document.querySelectorAll(".cm-line")].at(-1); const range = document.createRange(); range.selectNodeContents(line); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.querySelector(".cm-content").focus(); return true; })()`,
  );
  const page = await flow.shell.connect("://desktop/");
  await page.command("Input.insertText", { text });
}

/** 파일이 `expected` 글이 될 때까지 기다린다. */
export async function untilFile(path: string, expected: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    last = await Deno.readTextFile(path);
    if (last === expected) return;
    await delay(200);
  }
  throw new Error(`파일이 기대한 글이 아니다: ${JSON.stringify(last)}`);
}

/** 최신 판의 본문 추출이 끝나 worker `documents/read`가 본문을 줄 때까지 기다린다. */
export async function untilReadable(
  flow: FlowShell,
  document: string,
  what: string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const got = await flow.call({
      kind: "read",
      resource: "documents",
      method: "get",
      body: { document },
    });
    if (got.ok) {
      const latest = (got.value as { document: { latest_version: string } })
        .document.latest_version;
      const read = await flow.call({
        kind: "worker",
        resource: "documents",
        method: "read",
        body: { reference: { document, version: latest, section: null } },
      });
      if (
        read.ok &&
        (read.value as { text: string | null }).text !== null &&
        (read.value as { section_status: string }).section_status !==
          "unverified"
      ) return;
    }
    assert(Date.now() < deadline, `${what}: 본문을 아직 읽을 수 없다`);
    await delay(250);
  }
}
