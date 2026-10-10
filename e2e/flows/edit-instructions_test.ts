// lophn-agent slice flow E2E: edit-instructions(docs/flows/edit-instructions.md). 실제 shell(headless)·core·
// documents worker를 임시 LOPHN_HOME으로 띄우고 전역 [Instructions] 편집기를 연다(settings 화면이 아직 없어
// 개발 시작 자리 `LOPHN_SHELL_START=instructions:global`로 같은 진입을 연다).
// - 1: 파일이 없으면 빈 편집 초안만 보이고 아무 파일도 만들지 않는다. 경로·version 식별자는 화면에 없다.
// - 2: 사람이 쓰고 편집을 끝내면(CommandOrControl+S) data root의 LOPHN.md가 생기고 같은 문서 화면이 된다.
// - 3: 연 뒤 바깥에서 파일이 바뀌면 저장은 충돌로 멈추고 바깥 글을 덮지 않는다.
// - 4(두 번째 시험): 저장한 전역 지침의 확정 판이 run의 model call마다 다시 읽힌다. 진행 중인 run의
//   첫 call이 끝나기 전에 사람이 지침을 고쳐 저장하면 같은 run의 다음 call부터 새 글이 실린다.
//   model 응답은 시험 안의 작은 loopback server(fake-provider 응답 builder)가 낸다. 첫 call을
//   붙든 동안 편집기에서 고쳐 저장하기 위해서다.
// `LOPHN_SHELL_SHOT_DIR`을 주면 각 단계의 headless 화면을 그 폴더에 남긴다.
import { assert, assertEquals } from "@std/assert";

import { buildReply } from "../../tools/fake-provider/semantic.ts";
import type { SemanticReply } from "../../tools/fake-provider/types.ts";
import { e2eEnabled } from "../harness.ts";
import {
  commandBody,
  delay,
  type FlowShell,
  mustCall,
  openFlowShell,
  removeHome,
} from "../flow-support.ts";

async function shot(flow: FlowShell, name: string): Promise<void> {
  const dir = Deno.env.get("LOPHN_SHELL_SHOT_DIR");
  if (!dir) return;
  const settled = `${dir}/window-1-settled.png`;
  const stamp = () =>
    Deno.stat(settled).then((info) => info.mtime?.getTime() ?? 0, () => 0);
  const before = await stamp();
  await flow.evaluate(
    `(() => { document.activeElement?.blur?.(); return true; })()`,
  );
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && await stamp() <= before) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await Deno.copyFile(settled, `${dir}/${name}.png`);
}

const INSERT = (selector: string, text: string) =>
  `(() => {
    const content = document.querySelector(${JSON.stringify(selector)});
    content.focus();
    const range = document.createRange();
    range.selectNodeContents(content);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return document.execCommand("insertText", false, ${JSON.stringify(text)});
  })()`;

const CTRL_S = (selector: string) =>
  `(() => { document.querySelector(${
    JSON.stringify(selector)
  }).dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true })); return true; })()`;

Deno.test({
  name:
    "shell/editor#R17 shell/editor#R2 shell/editor#R15 flow edit-instructions: 파일이 없으면 빈 초안 → 첫 저장이 LOPHN.md를 만들고 같은 문서 화면 → 바깥 변경은 충돌",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const flow = await openFlowShell({ start: "instructions:global" });
    const file = `${flow.home}/LOPHN.md`;
    try {
      await t.step(
        "shell/editor#R17 shell/editor#R2: 1 파일이 없으면 빈 편집 초안만 보이고 파일을 만들지 않으며 경로·식별자는 숨긴다",
        async () => {
          await flow.until(
            `document.querySelector("[data-instructions-view='draft']") !== null`,
            "빈 지침 초안이 열리지 않았다",
          );
          assertEquals(
            await flow.text("[data-document-title]"),
            "Global instructions",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-instructions-draft]").getAttribute("data-instructions-draft")`,
            ),
            "draft",
          );
          assertEquals(
            await Deno.stat(file).then(() => true, () => false),
            false,
          );
          const text = String(
            await flow.evaluate(`document.body.innerText`),
          );
          for (const hidden of ["LOPHN.md", "ver_", "doc_", flow.home]) {
            assert(!text.includes(hidden), `${hidden}가 화면에 보인다`);
          }
          await shot(flow, "instructions-empty");
        },
      );

      await t.step(
        "shell/editor#R17 shell/editor#R2 shell/editor#R12: 2 사람이 쓰고 편집을 끝내면 data root에 LOPHN.md가 생기고 같은 문서 화면이 된다",
        async () => {
          assertEquals(
            await flow.evaluate(
              INSERT(
                "[data-instructions-view='draft'] .cm-content",
                "# Instructions\n\nAlways answer briefly.\n",
              ),
            ),
            true,
          );
          // 고치기만으로는 파일이 없다. 저장 버튼도 없다.
          assertEquals(await flow.count("[data-save]"), 0);
          assertEquals(
            await Deno.stat(file).then(() => true, () => false),
            false,
          );
          await shot(flow, "instructions-draft");
          await flow.evaluate(CTRL_S("[data-instructions-view='draft']"));
          await flow.until(
            `document.querySelector("[data-instructions-view='document']") !== null`,
            "저장한 지침이 문서 화면으로 바뀌지 않았다",
          );
          assertEquals(
            await Deno.readTextFile(file),
            "# Instructions\n\nAlways answer briefly.\n",
          );
          assertEquals(
            await flow.text("[data-document-title]"),
            "Global instructions",
          );
          const text = String(
            await flow.evaluate(`document.body.innerText`),
          );
          for (const hidden of ["LOPHN.md", "ver_", "doc_", flow.home]) {
            assert(!text.includes(hidden), `${hidden}가 화면에 보인다`);
          }
          await shot(flow, "instructions-saved");
        },
      );

      await t.step(
        "shell/editor#R17 shell/editor#R15: 3 연 뒤 바깥에서 바뀐 파일은 저장을 충돌로 멈추고 바깥 글을 덮지 않는다",
        async () => {
          await flow.click("[data-edit-toggle]");
          await flow.until(
            `document.querySelector("[data-document-view='edit'] .cm-content") !== null`,
            "편집으로 바뀌지 않았다",
          );
          assertEquals(
            await flow.evaluate(
              INSERT("[data-document-view='edit'] .cm-content", "Mine.\n"),
            ),
            true,
          );
          const outside = "# Instructions\n\nEdited elsewhere.\n";
          await Deno.writeTextFile(file, outside);
          await flow.evaluate(CTRL_S("[data-document-view='edit']"));
          await flow.until(
            `document.querySelector("[data-notice='conflict']") !== null`,
            "충돌 안내가 보이지 않았다",
          );
          assertEquals(await Deno.readTextFile(file), outside);
          await shot(flow, "instructions-conflict");
          // 해결 화면에서 바깥 글을 고르면 안내가 사라지고 파일은 그대로다(창을 닫을 수 있다).
          await flow.click("[data-notice-compare]");
          await flow.until(
            `document.querySelector("[data-conflict-view]") !== null`,
            "해결 화면이 열리지 않았다",
          );
          await shot(flow, "instructions-resolve");
          await flow.click("[data-conflict-theirs]");
          await flow.until(
            `document.querySelector("[data-notice='conflict']") === null`,
            "충돌 안내가 사라지지 않았다",
          );
          assertEquals(await Deno.readTextFile(file), outside);
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
    }
  },
});

const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const MODEL = "claude-sonnet-4-5";
const RULE = "Always answer briefly.";
const NEXT_RULE = "Name every file you touch.";

/** 요청마다 다음 step 함수로 Anthropic messages 응답을 낸다. 요청 본문은 남긴다. */
function startDynamicProvider(
  steps: ((body: string) => Promise<SemanticReply>)[],
) {
  const bodies: string[] = [];
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const text = await request.text();
      if (
        request.method !== "POST" ||
        !new URL(request.url).pathname.endsWith("/messages")
      ) {
        return Response.json({ error: "unexpected" }, { status: 500 });
      }
      const step = steps[bodies.length];
      bodies.push(text);
      if (step === undefined) {
        return Response.json({ error: "exhausted" }, { status: 500 });
      }
      const built = buildReply("messages", await step(text));
      return new Response(built.body ?? "", {
        status: built.status,
        headers: built.headers,
      });
    },
  );
  return {
    url: `http://127.0.0.1:${server.addr.port}`,
    bodies: () => [...bodies],
    close: () => server.shutdown(),
  };
}

async function useProvider(flow: FlowShell, endpoint: string): Promise<void> {
  await mustCall(flow, {
    kind: "command",
    resource: "providers",
    method: "register",
    body: commandBody({
      id: PROVIDER,
      name: "fixture",
      definition: {
        key: "anthropic",
        display_name: "Anthropic",
        protocols: ["anthropic-messages"],
        auth_kinds: ["none"],
        models_endpoint: null,
        oauth: null,
        revision: "2026-01-01",
      },
      endpoint,
      protocol: "anthropic-messages",
    }),
  });
  const defaults = await mustCall(flow, {
    kind: "read",
    resource: "agent-model-defaults",
    method: "read",
    body: {},
  });
  const seq = (defaults.defaults as { settings_seq: string }).settings_seq;
  await mustCall(flow, {
    kind: "command",
    resource: "agent-model-defaults",
    method: "change",
    body: commandBody(
      {
        judgment: {
          provider: PROVIDER,
          credentials: [],
          model_name: MODEL,
          reasoning_level: "provider_default",
          options: {},
        },
        organizing: null,
        settings_seq: seq,
      },
      { settings_seq: seq },
    ),
  });
}

Deno.test({
  name:
    "lophn-agent/instructions#R4 lophn-agent/instructions#R5 flow edit-instructions: 4 저장한 지침은 call마다 다시 읽혀 진행 중인 run의 다음 call부터 새 판이 실린다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const shell: { flow?: FlowShell } = {};
    const file = { path: "" };
    // 첫 call을 붙든 동안 사람이 편집기에서 지침을 고쳐 저장한다. 저장이 파일에 닿고 확정될
    // 때까지 기다린 뒤에야 첫 call의 답(읽기 tool 하나)을 낸다.
    const provider = startDynamicProvider([
      async () => {
        const flow = shell.flow!;
        // 도크가 있는 settings에서 지침 편집기로 간다(전역 지침의 진입 자리).
        await flow.click("[data-open-instructions]");
        await flow.until(
          `document.querySelector("[data-instructions-view='document']") !== null`,
          "지침 문서 화면이 열리지 않았다",
        );
        await flow.click("[data-edit-toggle]");
        await flow.until(
          `document.querySelector("[data-document-view='edit'] .cm-content") !== null`,
          "편집으로 바뀌지 않았다",
        );
        assertEquals(
          await flow.evaluate(
            INSERT("[data-document-view='edit'] .cm-content", `${NEXT_RULE}\n`),
          ),
          true,
        );
        await flow.evaluate(CTRL_S("[data-document-view='edit']"));
        const deadline = Date.now() + 30_000;
        while (!(await Deno.readTextFile(file.path)).includes(NEXT_RULE)) {
          assert(Date.now() < deadline, "고친 지침이 파일에 닿지 않았다");
          await delay(200);
        }
        // 저장한 바이트가 새 판으로 확정되는 시간을 준다.
        await delay(1_500);
        await flow.click("[data-instructions-back]");
        return {
          text: "",
          toolCalls: [{
            id: "toolu_list",
            name: "document.list",
            arguments: "{}",
          }],
          usage: { input: 30, output: 9 },
          stop: "tool_calls",
        };
      },
      () =>
        Promise.resolve({
          text: "Done.",
          usage: { input: 40, output: 9 },
          stop: "end",
        }),
    ]);
    const flow = await openFlowShell({ start: "instructions:global" });
    shell.flow = flow;
    file.path = `${flow.home}/LOPHN.md`;
    try {
      await flow.until(
        `document.querySelector("[data-instructions-view='draft']") !== null`,
        "빈 지침 초안이 열리지 않았다",
      );
      await flow.evaluate(
        INSERT(
          "[data-instructions-view='draft'] .cm-content",
          `# Instructions\n\n${RULE}\n`,
        ),
      );
      await flow.evaluate(CTRL_S("[data-instructions-view='draft']"));
      await flow.until(
        `document.querySelector("[data-instructions-view='document']") !== null`,
        "저장한 지침이 문서 화면으로 바뀌지 않았다",
      );
      await useProvider(flow, provider.url);
      // 지침 편집기에는 도크가 없다. 뒤로 가면 settings(lophn 공간)이다.
      await flow.click("[data-instructions-back]");
      await flow.until(
        `document.querySelector("[data-screen-body='settings']") !== null`,
        "settings로 돌아가지 않았다",
      );
      await flow.mouseClickText("[role=tab]", "General");
      await flow.until(
        `document.querySelector("[data-open-instructions]") !== null`,
        "settings로 돌아가지 않았다",
      );

      await flow.until(
        `document.querySelector("[data-dock-toggle]") !== null`,
        "도크 토글이 없다",
      );
      await flow.click("[data-dock-toggle]");
      await flow.until(
        `document.querySelector("[data-new-session]") !== null`,
        "새 세션 단추가 서지 않았다",
      );
      if (
        await flow.evaluate(
          `document.querySelector("[data-composer-input]") === null`,
        ) === true
      ) {
        await flow.click("[data-new-session]");
      }
      await flow.until(
        `document.querySelector("[data-composer-input]") !== null`,
        "입력칸이 서지 않았다",
      );
      await flow.type("[data-composer-input]", "List my documents.");
      await flow.click("[data-send]");
      // 첫 call 동안 화면이 편집기로 갔다 오므로 끝은 run 기록으로 본다.
      const deadline = Date.now() + 180_000;
      for (;;) {
        const listed = await mustCall(flow, {
          kind: "read",
          resource: "runs",
          method: "list",
          body: {},
        });
        const runs = listed.runs as { state: string; outcome: unknown }[];
        if (runs.length > 0 && runs.every((run) => run.state === "finished")) {
          assertEquals(
            (runs[0]!.outcome as { kind: string }).kind,
            "completed",
            JSON.stringify(runs),
          );
          break;
        }
        assert(
          Date.now() < deadline,
          `run이 끝나지 않았다: ${
            JSON.stringify(runs)
          } calls=${provider.bodies().length}`,
        );
        await delay(250);
      }
      const bodies = provider.bodies();
      assertEquals(bodies.length, 2);
      // 첫 call은 저장한 판, 같은 run의 다음 call은 사람이 고친 새 판을 싣는다.
      assert(bodies[0]!.includes(RULE), "첫 call에 지침이 없다");
      assert(!bodies[0]!.includes(NEXT_RULE), "첫 call에 아직 없는 글이 있다");
      assert(bodies[1]!.includes(RULE), "다음 call에 지침이 없다");
      assert(bodies[1]!.includes(NEXT_RULE), "다음 call에 고친 지침이 없다");
      // 파일 경로·안쪽 ID는 model에 보내지 않는다.
      assert(!bodies[1]!.includes(flow.home), "data root 경로가 model에 갔다");
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await provider.close();
    }
  },
});
