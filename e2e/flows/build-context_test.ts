// documents slice flow E2E: build-context(docs/flows/build-context.md). 실제 shell(headless)·core
// (제품 runtime child)·context worker를 임시 LOPHN_HOME으로 띄우고 model은 이 시험의 loopback
// 응답 server가 낸다. 실제 ~/.lophn과 실제 provider는 쓰지 않는다.
// 사람 조작은 화면(rail·탭·[New context]·대화 칸·[Search]·toast [View]·[Send to Context Engineer])으로
// 하고, 프로젝트 등록과 추적 켜기 같은 화면이 아직 없는 준비만 사람 command(core 통로)로 한다.
// - 1·3: Contexts 탭의 [New context]가 Context Engineer 대화를 열고, 사람이 첫 메시지를 쓴다.
//   context가 생기면 drafting 상태의 Context 탭이 남는다.
// - 3·4·5: scripted Context Engineer가 context.create · context.draft(fixture 계약) ·
//   context.preview · context.submit을 낸다. 격리 검사를 통과한 판은 사람 승인 없이 자동 적용되어
//   탭이 drafting을 벗어난다.
// - 7: Context 탭의 Search에서 선언된 검색을 고르면 Search 탭이 열리고 결과가 나온다.
// - 9·10·11: 사람 파일을 고쳐 규칙 위반이 늘면 notification과 toast가 오고, [View]는 Violations를
//   연다. 줄을 [Send to Context Engineer]로 넘기면 근거를 담은 Context Engineer run이 시작된다.
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
  PROJECT,
  registerTrackedProject,
  removeHome,
  untilDocuments,
} from "../flow-support.ts";

const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const MODEL = "claude-sonnet-4-5";

const INPUT = "[data-composer-input]";
const SEND = "[data-send]";
const DOCK = "[data-dock]";

const TITLE = "Experiment evaluation";
const PURPOSE = "Find experiments, scenarios and findings under eval and loop.";
const FIRST_MESSAGE =
  "Help me find experiments and their findings. Look at eval/experiments, eval/scenarios and loop/findings. I want to see experiments by status and the findings of one experiment.";
const REPORT = "The draft r1 is submitted.";
const HANDED = "These files need fixing, not the contract.";

const EDITED = "eval/experiments/exp-002-sight.md";

const EVAL_PROJECT = new URL(
  "../../packages/core/projects/contexts/testdata/eval-project/",
  import.meta.url,
);
const CONTRACT = new URL(
  "../fixtures/build-context.contract.json",
  import.meta.url,
);

type Step = (body: string) => SemanticReply | Promise<SemanticReply>;

/** 요청마다 다음 step 함수로 Anthropic messages 응답을 낸다. 요청 본문은 남긴다. */
function startDynamicProvider(steps: Step[]) {
  const bodies: string[] = [];
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const text = await request.text();
      const path = new URL(request.url).pathname;
      if (request.method !== "POST" || !path.endsWith("/messages")) {
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
    calls: () => bodies.length,
    body: (index: number) => bodies[index] ?? "",
    close: () => server.shutdown(),
  };
}

function toolCall(id: string, name: string, args: unknown): SemanticReply {
  return {
    text: "",
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
    usage: { input: 30, output: 9 },
    stop: "tool_calls",
  };
}

const text = (value: string): SemanticReply => ({
  text: value,
  usage: { input: 40, output: 12 },
  stop: "end",
});

/** 앞 tool 결과가 body에 담은 마지막 id. context 생성·초안 결과에서 id를 이어 받는다. */
function lastId(body: string, prefix: string): string {
  const found = body.match(new RegExp(`${prefix}_[0-9a-hjkmnp-tv-z]{26}`, "g"));
  assert(found !== null, `${prefix} id가 요청에 없다`);
  return found[found.length - 1]!;
}

async function copyProject(from: URL, to: string): Promise<void> {
  for await (const entry of Deno.readDir(from)) {
    const source = new URL(entry.name + (entry.isDirectory ? "/" : ""), from);
    const target = `${to}/${entry.name}`;
    if (entry.isDirectory) {
      await Deno.mkdir(target, { recursive: true });
      await copyProject(source, target);
    } else {
      await Deno.copyFile(source, target);
    }
  }
}

async function setDefaults(flow: FlowShell, endpoint: string): Promise<void> {
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

type ContextRow = {
  id: string;
  title: string;
  status: string;
  applied_bundle: string | null;
  violation_mark: number;
};

type RunRow = { id: string; state: string; outcome: { kind: string } | null };

type Violation = { path: string; message: string; rule: string | null };

type Notified = { source_event: string };

const clickTexted = (selector: string, label: string) =>
  `(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((item) => item.textContent?.trim() === ${JSON.stringify(label)});
    if (!el) return false;
    el.click();
    return true;
  })()`;

Deno.test({
  name:
    "documents/contexts#R1 documents/contexts#R20 documents/contexts#R21 documents/contexts#R25 lophn-agent/roles/context-engineer#R5 shell/workspace#R30 flow build-context: Contexts 탭의 [New context]로 Context Engineer와 context를 만들면 검사를 통과한 판이 자동 적용되고, 검색이 되며, 파일이 계약을 어기면 알림을 받아 Context Engineer에게 넘긴다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const content = JSON.parse(await Deno.readTextFile(CONTRACT));
    const folder = await Deno.makeTempDir({ prefix: "lophn-e2e-eval-" });
    await copyProject(EVAL_PROJECT, folder);

    // 첫 flow shell은 프로젝트 등록과 추적 켜기만 하고 닫는다. 같은 home을 project 시작으로 다시 연다.
    const setup = await openFlowShell();
    const home = setup.home;
    try {
      await registerTrackedProject(setup, {
        folder,
        name: "eval",
        title: "Eval",
      });
      await untilDocuments(
        setup,
        ["exp-001-plan", "F-003"],
        "추적한 파일이 문서가 되지 않았다",
      );
    } finally {
      await setup.close();
    }

    let ctx = "";
    const steps: Step[] = [
      // 1: 사람이 말한 것으로 context를 만든다.
      () =>
        toolCall("toolu_create", "context.create", {
          project: PROJECT,
          title: TITLE,
          purpose: PURPOSE,
        }),
      // 2: 초안을 쓴다. 만드는 중 탭을 사람이 볼 수 있도록 잠깐 둔다.
      async (body) => {
        ctx = lastId(body, "ctx");
        await delay(8_000);
        return toolCall("toolu_draft", "context.draft", {
          context: ctx,
          content,
        });
      },
      // 3: 지금 project 파일로 미리 본다.
      (body) =>
        toolCall("toolu_preview", "context.preview", {
          context: ctx,
          bundle: lastId(body, "cbn"),
        }),
      // 4: 제출한다.
      (body) =>
        toolCall("toolu_submit", "context.submit", {
          bundle: lastId(body, "cbn"),
        }),
      () => text(REPORT),
      // 위반을 넘긴 두 번째 요청: 위반을 읽고 파일 쪽 문제로 보고한다.
      () =>
        toolCall("toolu_violations", "context.violations", { context: ctx }),
      () => text(HANDED),
    ];
    const provider = startDynamicProvider(steps);
    const flow = await openFlowShell({ home, start: `project:${PROJECT}` });
    try {
      await flow.until(
        `document.querySelector("[data-space]")?.getAttribute("data-space") === "project"`,
        "project 작업대가 서지 않았다",
      );
      await setDefaults(flow, provider.url);

      const contexts = async (): Promise<ContextRow[]> =>
        (await mustCall(flow, {
          kind: "read",
          resource: "contexts",
          method: "list",
          body: { project: PROJECT },
        })).contexts as ContextRow[];
      const violations = async (): Promise<Violation[]> =>
        (await mustCall(flow, {
          kind: "read",
          resource: "contexts",
          method: "violations",
          body: { context: ctx },
        })).violations as Violation[];
      const notices = async (): Promise<Notified[]> =>
        (await mustCall(flow, {
          kind: "read",
          resource: "notifications",
          method: "list",
          body: {},
        })).notifications as Notified[];
      const dockText = async () =>
        String(
          await flow.evaluate(
            `document.querySelector(${
              JSON.stringify(DOCK)
            })?.innerText ?? null`,
          ),
        ).slice(0, 600);
      const engineerRuns = async (): Promise<RunRow[]> => {
        const assignments = await mustCall(flow, {
          kind: "read",
          resource: "assignments",
          method: "list",
          body: {},
        });
        const agent = (assignments.assignments as {
          id: string;
          role: string;
        }[]).find((entry) => entry.role === "context_engineer");
        assert(agent !== undefined, "context_engineer assignment가 없다");
        return (await mustCall(flow, {
          kind: "read",
          resource: "runs",
          method: "list",
          body: { assignment: agent.id },
        })).runs as RunRow[];
      };
      const untilRuns = async (count: number) => {
        const deadline = Date.now() + 180_000;
        for (;;) {
          const rows = await engineerRuns();
          if (
            rows.length === count &&
            rows.every((row) => row.outcome !== null)
          ) return rows;
          if (Date.now() > deadline) {
            throw new Error(
              `run이 끝나지 않았다 | runs=${
                JSON.stringify(rows)
              } calls=${provider.calls()} dock=${
                JSON.stringify(await dockText())
              }`,
            );
          }
          await delay(250);
        }
      };

      await t.step(
        "shell/workspace#R16 shell/workspace#R30 documents/contexts#R1 shell/desktop#R33: 1 Contexts 탭의 [New context]는 폼 없이 Context Engineer 대화를 열고 사람이 첫 메시지를 쓴다",
        async () => {
          // 접힌 sidebar에서는 바로 가기 rail이, 펼쳐진 sidebar에서는 Contexts 행이 같은 탭을 연다.
          await flow.until(
            `document.querySelector("[data-rail-action='contexts']") !== null || document.querySelector("[data-contexts-row]") !== null`,
            "Contexts로 가는 길이 없다",
          );
          await flow.click(
            await flow.count("[data-rail-action='contexts']") > 0
              ? "[data-rail-action='contexts']"
              : "[data-contexts-row]",
          );
          await flow.until(
            `[...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "New context")`,
            "Contexts 탭에 [New context]가 없다",
          );
          assertEquals(await flow.count("[data-context-card]"), 0);
          assertEquals(
            await flow.evaluate(clickTexted("button", "New context")),
            true,
          );
          await flow.until(
            `document.querySelector(${JSON.stringify(DOCK)}) !== null`,
            "Context Engineer 대화가 열리지 않았다",
          );
          await flow.until(
            `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
            "대화 입력칸이 서지 않았다",
          );
          // 폼은 열리지 않는다: 이름·목적을 받는 입력은 대화 칸 하나뿐이다.
          assertEquals(await flow.count("form input[type='text']"), 0);
          await flow.type(INPUT, FIRST_MESSAGE);
          await flow.click(SEND);
        },
      );

      await t.step(
        "documents/contexts#R5 documents/contexts#R6 shell/workspace#R30: 3 context가 생기면 drafting 상태의 Context 탭이 남는다",
        async () => {
          await flow.until(
            `document.querySelector("[data-drafting]")?.textContent?.includes("Context Engineer is drafting") === true`,
            "drafting 탭이 서지 않았다",
            90_000,
          );
          const head = await flow.text("[data-context-head]");
          assert(head?.includes(TITLE) === true, `머리에 이름이 없다: ${head}`);
          assertEquals((await contexts()).map((row) => row.status), [
            "drafting",
          ]);
        },
      );

      await t.step(
        "documents/contexts#R20 documents/contexts#R21 documents/contexts#R22 shell/workspace#R16: 4·5 제출한 판은 격리 검사를 통과하면 사람 승인 없이 적용되고 Contexts 탭의 카드에 판과 위반 수가 나온다",
        async () => {
          const deadline = Date.now() + 120_000;
          let row: ContextRow | undefined;
          for (;;) {
            row = (await contexts())[0];
            if (row?.status === "active") break;
            assert(
              Date.now() < deadline,
              `판이 적용되지 않았다 | ${
                JSON.stringify(row)
              } calls=${provider.calls()} dock=${await dockText()}`,
            );
            await delay(500);
          }
          assert(row.applied_bundle !== null, "적용된 판이 없다");
          await untilRuns(1);
          // 4개 호출(create·draft·preview·submit) 뒤 보고 한 번으로 끝난다. 확인 창은 없다.
          assertEquals(provider.calls(), 5);
          assertEquals(await flow.count("[data-confirmation]"), 0);
          // 검사에서 센 위반은 적용을 막지 않고 남는다.
          const found = await violations();
          assert(
            found.length >= 4,
            `snapshot의 위반이 남지 않았다: ${found.length}`,
          );
        },
      );

      await t.step(
        "shell/workspace#R30 shell/workspace#R16: 5 판이 적용되면 열어 둔 drafting 탭이 보통 Context 탭이 된다",
        async () => {
          // 탭을 다시 열거나 창을 다시 읽지 않아도 같은 탭이 drafting을 벗어나야 한다.
          // context 목록을 다시 읽는 간격(30초) 안에 따라온다.
          await flow.until(
            `document.querySelector("[data-drafting]") === null && document.querySelector("[data-kept-up-to-date]") !== null`,
            "열어 둔 탭이 drafting에서 벗어나지 않았다",
            90_000,
          );
        },
      );

      await t.step(
        "shell/workspace#R16 documents/contexts#R21: 5 Contexts 탭의 카드에 이름·목적이 나온다",
        async () => {
          await flow.click(
            await flow.count("[data-rail-action='contexts']") > 0
              ? "[data-rail-action='contexts']"
              : "[data-contexts-row]",
          );
          await flow.until(
            `document.querySelector("[data-context-card='${ctx}']") !== null`,
            "Contexts 탭에 카드가 서지 않았다",
            60_000,
          );
          const card = await flow.text(`[data-context-card='${ctx}']`);
          assert(card?.includes(TITLE) === true, `카드에 이름이 없다: ${card}`);
          assert(
            card?.includes(PURPOSE) === true,
            `카드에 목적이 없다: ${card}`,
          );
        },
      );

      await t.step(
        "shell/workspace#R17 shell/workspace#R18: 6 [Open]으로 연 Context 탭은 drafting을 벗어나 Overview와 하위 탭을 보인다",
        async () => {
          assertEquals(
            await flow.evaluate(
              `(() => { const card = document.querySelector("[data-context-card='${ctx}']"); const open = [...card.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Open"); if (!open) return false; open.click(); return true; })()`,
            ),
            true,
          );
          await flow.until(
            `document.querySelector("[data-kept-up-to-date]") !== null`,
            "applied Context 탭이 서지 않았다",
          );
          assertEquals(await flow.count("[data-drafting]"), 0);
          await flow.until(
            `document.querySelector("[data-type-card], [data-entity]") !== null`,
            "Overview에 개체 카드가 없다",
          );
        },
      );

      await t.step(
        "shell/workspace#R22 shell/workspace#R23 shell/workspace#R24 documents/contexts#R16: 7 Search 하위 탭에서 선언된 검색을 고르면 Search 탭이 열리고 결과가 선언대로 나온다",
        async () => {
          await flow.mouseClickText("[role='tab']", "Search");
          try {
            await flow.until(
              `document.querySelector("[data-context-search] [data-declared='experiments_by_status']") !== null`,
              "Search 하위 탭에 선언된 검색이 없다",
              20_000,
            );
          } catch (error) {
            throw new Error(
              `${(error as Error).message} | tabs=${await flow.evaluate(
                `JSON.stringify([...document.querySelectorAll("[role=tab]")].map((e) => e.textContent + ":" + e.getAttribute("aria-selected")))`,
              )} | body=${await flow.evaluate(
                `(document.querySelector("main")?.innerText ?? document.body.innerText).slice(0, 700)`,
              )}`,
            );
          }
          await flow.click(
            "[data-context-search] [data-declared='experiments_by_status']",
          );
          await flow.until(
            `document.querySelector("[data-result-count]") !== null`,
            "Search 탭에 결과가 나오지 않았다",
          );
          const count = await flow.text("[data-result-count]");
          assert(/^\d+ /.test(count ?? ""), `결과 개수 글: ${count}`);
          assert(
            await flow.count("[data-board-column]") > 0,
            "board 열이 없다",
          );
          assert(
            await flow.count("[data-board-card]") > 0,
            "board 카드가 없다",
          );
        },
      );

      await t.step(
        "shell/workspace#R27 documents/contexts#R18: 8 선언에 든 saved view를 고르면 그 입력을 채운 Search 탭에서 결과를 다시 계산한다",
        async () => {
          await flow.until(
            `document.querySelector("[data-saved-views] [data-saved-view]") !== null`,
            "Saved views에 보기가 없다",
          );
          const all = await flow.count("[data-board-card]");
          await flow.click("[data-saved-views] [data-saved-view]");
          await flow.until(
            `document.querySelectorAll("[data-board-card]").length > 0 && document.querySelectorAll("[data-board-card]").length < ${all}`,
            "saved view의 입력으로 결과가 좁혀지지 않았다",
          );
        },
      );

      const before = (await violations()).length;
      const noticesBefore = (await notices()).filter((item) =>
        item.source_event === "ContextViolationsRecorded"
      ).length;

      await t.step(
        "documents/contexts#R23 documents/contexts#R24 documents/contexts#R25 platform/notifications#R1 shell/workspace#R29: 9·10 파일을 고쳐 계약을 어기면 위반이 늘고 notification과 toast가 온다",
        async () => {
          const path = `${folder}/${EDITED}`;
          const source = await Deno.readTextFile(path);
          assert(source.includes("status: running"), "고칠 줄이 없다");
          await Deno.writeTextFile(
            path,
            source.replace("status: running", "status: stuck"),
          );
          const deadline = Date.now() + 120_000;
          for (;;) {
            const rose = (await violations()).length > before;
            const noticed = (await notices()).filter((item) =>
              item.source_event === "ContextViolationsRecorded"
            ).length > noticesBefore;
            if (rose && noticed) {
              break;
            }
            assert(
              Date.now() < deadline,
              `위반이나 notification이 늘지 않았다 | violations=${
                (await violations()).length
              }/${before} notices=${(await notices()).length}`,
            );
            await delay(500);
          }
          // 화면 toast는 context 목록을 다시 읽을 때 나온다.
          await flow.until(
            `document.querySelector("[data-violation-toasts]")?.textContent?.includes("don't match the contract") === true`,
            "위반 toast가 나오지 않았다",
            120_000,
          );
          const toast = await flow.text("[data-violation-toasts]");
          assert(
            toast?.includes(TITLE) === true,
            `toast에 context 이름이 없다: ${toast}`,
          );
        },
      );

      await t.step(
        "shell/workspace#R29 shell/workspace#R19 documents/contexts#R24: 10·11 toast의 [View]는 Violations를 열고 줄마다 파일·어긋난 것·규칙을 보인다",
        async () => {
          // 알림만으로 agent의 run이 늘지 않는다.
          assertEquals((await engineerRuns()).length, 1);
          assertEquals(provider.calls(), 5);
          assertEquals(
            await flow.evaluate(
              clickTexted("[data-violation-toasts] button", "View"),
            ),
            true,
          );
          await flow.until(
            `document.querySelector("[data-violation]") !== null`,
            "Violations 하위 탭이 열리지 않았다",
          );
          const row = `[data-violation][data-path='${EDITED}']`;
          await flow.until(
            `document.querySelector(${JSON.stringify(row)}) !== null`,
            "고친 파일의 위반 줄이 없다",
          );
          const line = await flow.text(row);
          assert(
            line?.includes("exp-002-sight.md") === true,
            `파일 이름: ${line}`,
          );
          assert(
            await flow.count(`${row} [data-violation-message]`) === 1,
            "어긋난 것 글이 없다",
          );
          assert(
            (await flow.text(`${row} [data-violation-rule]`))?.includes(
              "status-known",
            ) === true,
            "어긴 규칙 글이 없다",
          );
        },
      );

      await t.step(
        "documents/contexts#R25 lophn-agent/roles/context-engineer#R11 shell/workspace#R19: 11·12 [Send to Context Engineer]로 넘기면 근거를 담은 Context Engineer run이 시작되고 줄은 'on it'으로 바뀐다",
        async () => {
          const row = `[data-violation][data-path='${EDITED}']`;
          assertEquals(
            await flow.evaluate(
              `(() => { const button = [...document.querySelectorAll(${
                JSON.stringify(row)
              } + " button")].find((b) => b.textContent?.trim() === "Send to Context Engineer"); if (!button) return false; button.click(); return true; })()`,
            ),
            true,
          );
          await flow.until(
            `document.querySelector(${
              JSON.stringify(row + " [data-violation-status]")
            })?.textContent?.includes("Context Engineer is on it") === true`,
            "줄이 'Context Engineer is on it'으로 바뀌지 않았다",
          );
          const rows = await untilRuns(2);
          assertEquals(rows.length, 2);
          assertEquals(provider.calls(), 7);
          // 근거(파일 경로·규칙)가 자동으로 붙는다. 사람이 설명을 쓰지 않았다.
          const request = provider.body(5);
          assert(
            request.includes("Look at the contract violations of context"),
            "넘긴 요청 글이 model 요청에 없다",
          );
          assert(request.includes(EDITED), "넘긴 요청에 파일 경로가 없다");
          assert(request.includes("status-known"), "넘긴 요청에 규칙이 없다");
        },
      );
    } finally {
      await flow.close();
      await removeHome(home);
      await provider.close();
      await Deno.remove(folder, { recursive: true });
    }
  },
});
