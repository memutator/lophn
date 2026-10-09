// lophn-agent slice flow E2E: resume-agent-session(docs/flows/resume-agent-session.md). 실제 shell(headless)·
// core(제품 runtime child를 띄우는 기동)를 임시 LOPHN_HOME으로 띄우고, model이 끼는 단계는
// tools/fake-provider(loopback fixture server)로 검증하며 실제 ~/.lophn은 열지 않는다.
// - 1·4: 일이 도는 중에 core가 죽어도 화면은 마지막 화면과 단절을 남기고, 창을 다시 열면 같은
//   열린 세션의 확정 메시지가 그대로 보이며 사람은 원래 요청을 다시 입력하지 않는다.
// - 2·3: 다시 세운 core의 runtime이 진행 중이던 run을 저장된 경계에서 같은 run으로 이어 간다.
//   죽을 때 붙들려 있던 판단 하나만 다시 부르고 이미 끝난 판단은 반복하지 않는다.
// - 5: 창을 닫았다 열어도 기다리는 질문은 그대로 기다리고 답 없음으로 바뀌지 않는다.
// - 6: 모델이 보낸 handoff는 보낸 run의 전달 사실(trace의 tool call·link)로 남고, 받는 역할의
//   run이 실제로 시작되어 맡긴 내용을 자기 prompt로 읽고 끝난다.
// 받는 run은 handoff 내용 blob을 runs/body(handoff_content)로 읽어 자기 요청으로 삼는다.
// 제품 결함으로 볼 수 없는 것: 세션 없는 run(handoff·주기)의 판단 call은 StartModelCall이 받지
// 않는다(model call 계약 `modelCallShape`와 model_calls 표 CHECK가 run이 있으면 session도 요구한다.
// domain model usage는 "run에 있으면 같은 session"이라 세션 없는 run을 허용한다). 그래서 받는 run은
// model을 부르기 전에 failed(configuration_unavailable)로 끝나고, 이 시험은 받는 run의 시작까지만 본다.
// 통로가 없어 볼 수 없는 것: 보낸 run을 handoff 자체로 자동 종료시키는 규칙은 제품 loop에 없다.
// 그래서 보낸 run의 끝은 모델이 tool 결과 뒤 답을 내는 것으로 만들고 전달 사실은 그 run의 trace로
// 확인한다. 창 닫기 자체로는 run이 이어지지 않는다: 창 닫기는 core를 정상 종료시키므로 진행 loop가
// 중단돼 실패로 끝나거나(쓰지 못했으면) 그대로 남는다. 그래서 2·3의 복구는 core를 실제로 죽여 본다.
import { assert, assertEquals } from "@std/assert";

import { startFakeProvider } from "../../tools/fake-provider/mod.ts";
import {
  descendantPids,
  e2eEnabled,
  processAlive,
  signalPids,
} from "../harness.ts";
import {
  commandBody,
  delay,
  mustCall,
  openFlowShell,
  removeHome,
} from "../flow-support.ts";

const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const MODEL = "claude-sonnet-4-5";

const INPUT = "[data-composer-input]";
const SEND = "[data-send]";
const STATUS = "[data-work-status]";
const DOCK = "[data-dock]";

const FIRST = "Tidy the glossary.";
const SECOND = "Change it later?";
const THIRD = "Hand the glossary words to the context engineer.";
const ASK = "Which wording?";
const WHAT = "Tidy the glossary words and record them.";
const ANSWER = "The glossary is tidy.";

/** 첫 판단 하나를 붙들어 두는 응답. 진행 중인 동안 core를 죽인다. */
function heldAnswer(id: string, gate: string, text: string) {
  const frames = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
    `event: content_block_delta\ndata: ${
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      })
    }\n\n`,
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
  return {
    id,
    protocol: "messages" as const,
    response: {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      chunks: [
        { bytes: frames[0]! },
        { bytes: frames.slice(1).join(""), gate },
      ],
    },
  };
}

function end(id: string, text: string) {
  return {
    id,
    protocol: "messages" as const,
    reply: { text, usage: { input: 40, output: 9 }, stop: "end" as const },
  };
}

/** 질문 하나를 만드는 판단. */
function ask(id: string) {
  return {
    id,
    protocol: "messages" as const,
    reply: {
      text: "One decision is yours.",
      toolCalls: [{
        id: "toolu_ask",
        name: "question.submit",
        arguments: JSON.stringify({
          prompt: ASK,
          reason: "the glossary has two possible meanings",
          options: [
            {
              key: "keep",
              label: "Keep the current wording",
              description: "Leave the glossary as it is.",
              evidence: [],
              adoption: null,
              action: null,
            },
          ],
          recommendation: null,
          expires_at: null,
        }),
      }],
      usage: { input: 20, output: 8 },
      stop: "tool_calls" as const,
    },
  };
}

/** 맡긴 일을 Context Engineer에게 보내는 판단. 받는 assignment는 시험이 읽어 넣는다. */
function handoff(id: string, assignment: string) {
  return {
    id,
    protocol: "messages" as const,
    reply: {
      text: "Handing the glossary to the context engineer.",
      toolCalls: [{
        id: "toolu_handoff",
        name: "handoff.submit",
        arguments: JSON.stringify({
          receiver_assignment: assignment,
          to_role: "context_engineer",
          what: WHAT,
          why: "the glossary needs one owner",
          excludes: ["the index is not touched"],
          expected_outputs: ["one context that owns the glossary"],
          references: [{
            document: "doc_01arz3ndektsv4rrffq69g5fav",
            version: "ver_01arz3ndektsv4rrffq69g5fav",
            section: null,
            question: null,
          }],
          dedup_key: "flow-handoff-one",
        }),
      }],
      usage: { input: 30, output: 9 },
      stop: "tool_calls" as const,
    },
  };
}

type RunRow = {
  id: string;
  state: string;
  session: string | null;
  source: { kind: string };
  started_at: string | null;
  outcome: { kind: string } | null;
  accepted_seq: string;
};

type QuestionRow = {
  id: string;
  status: string;
  answer: unknown;
};

Deno.test({
  name:
    "lophn-agent/conversation#R2 lophn-agent/harness/waiting-and-recovery#R8 lophn-agent/questions#R10 lophn-agent/handoff#R5 flow resume-agent-session: core가 죽어도 같은 세션이 남고 run은 저장된 경계에서 이어지며 맡긴 일은 받는 역할의 run으로 간다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    // 받는 assignment ID를 먼저 읽어야 model이 handoff tool call에 실을 수 있다. script는 시작
    // 전에 고정되므로 provider는 그 뒤에 띄운다.
    const setup = await openFlowShell({ start: "lophn" });
    const home = setup.home;
    let provider: ReturnType<typeof startFakeProvider> | undefined;
    try {
      const listed = await mustCall(setup, {
        kind: "read",
        resource: "assignments",
        method: "list",
        body: { role: "context_engineer" },
      });
      const editor = (listed.assignments as { id: string; role: string }[])
        .find((entry) => entry.role === "context_engineer");
      assert(editor !== undefined, "Context Engineer assignment가 없다");
      provider = startFakeProvider({
        script: {
          steps: [
            heldAnswer("tidy-hold", "hold-tidy", "Working on the glossary."),
            end("tidy-answer", ANSWER),
            ask("ask-question"),
            end("ask-end", "One decision is yours."),
            handoff("handoff-send", editor.id),
            end("handoff-end", "The context engineer has the glossary."),
          ],
        },
        nowMs: () => Date.now(),
        instant: true,
      });
    } finally {
      await setup.close();
    }
    const fixture = provider!;
    let flow = await openFlowShell({ home, start: "lophn" });
    try {
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
          endpoint: fixture.url,
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
      const assignments = await mustCall(flow, {
        kind: "read",
        resource: "assignments",
        method: "list",
        body: {},
      });
      const roles = assignments.assignments as { id: string; role: string }[];
      const agent = roles.find((entry) => entry.role === "lophn");
      const editor = roles.find((entry) => entry.role === "context_engineer");
      assert(agent !== undefined && editor !== undefined, "assignment가 없다");

      /** 한 assignment의 run들(사람 token의 runs/list 읽기). 접수 순서다. */
      const runsOf = async (assignment: string): Promise<RunRow[]> => {
        const listed = await mustCall(flow, {
          kind: "read",
          resource: "runs",
          method: "list",
          body: { assignment },
        });
        return listed.runs as RunRow[];
      };
      /** 마지막으로 접수된 run. 없으면 null이다. */
      const latestRun = async (assignment: string): Promise<RunRow | null> => {
        const rows = await runsOf(assignment);
        return rows.reduce<RunRow | null>(
          (found, row) =>
            found === null ||
              BigInt(row.accepted_seq) > BigInt(found.accepted_seq)
              ? row
              : found,
          null,
        );
      };
      /** 질문 기록(사람 token의 questions/list 읽기). */
      const questions = async (): Promise<QuestionRow[]> => {
        const listed = await mustCall(flow, {
          kind: "read",
          resource: "questions",
          method: "list",
          body: {},
        });
        return listed.questions as QuestionRow[];
      };
      /** 도크가 마지막으로 보인 글. 실패했을 때 이유를 담는다. */
      const dockText = async () =>
        String(
          await flow.evaluate(
            `document.querySelector(${
              JSON.stringify(DOCK)
            })?.innerText ?? null`,
          ),
        ).slice(0, 600);
      /** 상태 줄이 `want`가 될 때까지 기다린다. 못 되면 지금 사실을 담아 던진다. */
      const untilStatus = async (want: string, what: string) => {
        try {
          await flow.until(
            `document.querySelector(${
              JSON.stringify(STATUS)
            })?.getAttribute("data-work-status") === ${JSON.stringify(want)}`,
            what,
            180_000,
          );
        } catch (error) {
          throw new Error(
            `${(error as Error).message} | runs=${
              JSON.stringify(await runsOf(agent.id))
            } model_calls=${fixture.requests().length} dock=${
              JSON.stringify(await dockText())
            }`,
          );
        }
      };
      /** 조건을 채우는 run이 나올 때까지 기다린다. */
      const untilRun = async (
        assignment: string,
        want: (row: RunRow) => boolean,
        what: string,
      ): Promise<RunRow> => {
        const deadline = Date.now() + 180_000;
        for (;;) {
          const row = (await runsOf(assignment)).find(want);
          if (row !== undefined) return row;
          assert(
            Date.now() < deadline,
            `${what}: ${
              JSON.stringify(await runsOf(assignment))
            } model_calls=${fixture.requests().length}`,
          );
          await delay(250);
        }
      };
      /** run 수가 `count`가 될 때까지 기다린다. */
      const untilRuns = async (
        assignment: string,
        count: number,
        what: string,
      ) => {
        const deadline = Date.now() + 120_000;
        while ((await runsOf(assignment)).length < count) {
          assert(
            Date.now() < deadline,
            `${what}: ${JSON.stringify(await runsOf(assignment))}`,
          );
          await delay(250);
        }
      };
      /** fixture server가 받은 call 수가 `count`에 이르거나 지나칠 때까지 기다린다. */
      const untilCalls = async (count: number, what: string) => {
        const deadline = Date.now() + 120_000;
        while (fixture.requests().length < count) {
          assert(
            Date.now() < deadline,
            `${what}: ${fixture.requests().length} call`,
          );
          await delay(250);
        }
      };
      /** 마지막 사람 말이 접수로 확정될 때까지 기다린다. */
      const untilConfirmed = () =>
        flow.until(
          `(() => { const rows = [...document.querySelectorAll("[data-actor='user']")]; const last = rows.at(-1)?.querySelector("[data-delivery]")?.getAttribute("data-delivery"); return rows.length > 0 && last !== null && last !== undefined && last !== "sending"; })()`,
          "보낸 말이 접수로 확정되지 않았다",
        );
      /** 도크를 연다. 이미 열린 세션이 있으면 그 세션이 서고, 없으면 하나 연다. */
      const openDock = async () => {
        await flow.until(
          `document.querySelector("[data-dock-toggle]") !== null`,
          "도크 토글이 없다",
        );
        await flow.click("[data-dock-toggle]");
        await flow.until(
          `document.querySelector(${JSON.stringify(DOCK)}) !== null`,
          "대화 도크가 열리지 않았다",
        );
        await flow.until(
          `document.querySelector("[data-new-session]") !== null`,
          "새 세션 단추가 서지 않았다",
        );
        if (
          await flow.evaluate(
            `document.querySelector(${JSON.stringify(INPUT)}) === null`,
          ) === true
        ) {
          await flow.click("[data-new-session]");
        }
        await flow.until(
          `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
          "입력칸이 서지 않았다",
        );
      };
      /** 창을 닫고 같은 데이터 root로 다시 연다(core도 다시 뜬다). */
      const reopen = async () => {
        await flow.close();
        flow = await openFlowShell({ home, start: "lophn" });
      };
      /** 이 시험이 띄운 shell의 자손 중 core 프로세스의 pid. */
      const corePid = async (): Promise<number> => {
        for (const pid of await descendantPids(flow.shell.pid)) {
          try {
            const cmdline = await readCmdline(pid);
            if (cmdline.includes("apps/core/main.ts")) return pid;
          } catch { /* 이미 끝난 pid */ }
        }
        throw new Error("core pid를 찾지 못했다");
      };

      await openDock();

      await t.step(
        "lophn-agent/conversation#R2 lophn-agent/harness/waiting-and-recovery#R8: 1·2·3·4 진행 중 core가 죽어도 화면은 마지막 확인을 남기고 다시 열면 같은 세션·같은 run이 이어진다",
        async () => {
          await flow.type(INPUT, FIRST);
          await flow.click(SEND);
          await untilConfirmed();
          // 판단이 시작되어 진행 중으로 선다. 그 call은 fixture server가 붙들고 있다.
          await untilCalls(1, "첫 판단이 시작되지 않았다");
          await untilStatus("in-progress", "상태가 진행 중이 되지 않았다");
          const started = await runsOf(agent.id);
          assertEquals(started.length, 1, "요청 하나가 run 하나를 갖지 않았다");
          assertEquals(started[0]!.state, "running");
          const run = started[0]!.id;

          // core를 죽인다. runtime child도 감독 pipe를 잃고 끝나며 진행 중이던 run은 완료로
          // 확정할 수 없어 ledger에 running으로 남는다.
          const pid = await corePid();
          signalPids([pid], "SIGKILL");
          const deadline = Date.now() + 30_000;
          while (processAlive(pid)) {
            assert(Date.now() < deadline, "core가 끝나지 않았다");
            await delay(200);
          }
          // 화면은 마지막 화면을 그대로 두고 단절을 한 줄로 보인다(desktop#R7). 도크가 마지막
          // 확인 시각을 담은 줄을 세운다.
          await flow.until(
            `document.querySelector("[data-dock] [data-stale]") !== null`,
            "core가 죽었는데 단절 표시가 없다",
          );

          // 창을 다시 연다. 같은 LOPHN_HOME이므로 같은 세션·같은 기록이다.
          await reopen();
          await openDock();

          // 원래 요청을 다시 입력시키지 않는다: 확정 메시지가 그대로 보인다.
          await flow.until(
            `document.querySelector(${
              JSON.stringify(DOCK)
            })?.innerText.includes(${JSON.stringify(FIRST)})`,
            "다시 연 도크에 확정 메시지가 없다",
          );
          assertEquals(
            await flow.evaluate(
              `[...document.querySelectorAll("[data-actor='user']")].length`,
            ),
            1,
            "사람 말이 중복되거나 사라졌다",
          );
          // 같은 run이 저장된 경계에서 이어진다: 다시 부른 판단은 죽을 때 붙들려 있던 하나뿐이고
          // 끝난 판단은 반복하지 않는다. 끝나면 정상 종료 결과가 남는다.
          await untilStatus("done", "이어진 run이 끝나지 않았다");
          const finished = await runsOf(agent.id);
          assertEquals(finished.length, 1, "이어가기가 run을 새로 만들었다");
          assertEquals(finished[0]!.id, run, "다른 run으로 이어졌다");
          assertEquals(finished[0]!.outcome?.kind, "completed");
          assertEquals(
            fixture.requests().length,
            2,
            "다시 부른 판단 수가 하나가 아니다",
          );
          assert(
            (await dockText()).includes(ANSWER),
            `이어간 결과가 도크에 없다: ${JSON.stringify(await dockText())}`,
          );
        },
      );

      await t.step(
        "lophn-agent/questions#R10: 5 창을 닫았다 열어도 기다리는 질문은 그대로 기다린다",
        async () => {
          await flow.type(INPUT, SECOND);
          await flow.click(SEND);
          await untilConfirmed();
          await untilRuns(agent.id, 2, "두 번째 run이 접수되지 않았다");
          const asked = await latestRun(agent.id);
          assert(asked !== null, "두 번째 run이 없다");
          // 질문을 만든 run은 답을 기다리는 상태가 아니라 끝난다(제품 loop는 approval만 건다).
          // 질문 자체는 답을 기다린다.
          const deadline = Date.now() + 120_000;
          while ((await questions()).length === 0) {
            assert(Date.now() < deadline, "질문이 만들어지지 않았다");
            await delay(250);
          }
          const [question] = await questions();
          assert(question !== undefined, "질문이 없다");
          assertEquals(question.status, "pending");
          await untilRun(
            agent.id,
            (row) => row.id === asked.id && row.state === "finished",
            "질문을 만든 run이 끝나지 않았다",
          );
          await flow.until(
            `document.querySelector("[data-question-text='ready']") !== null`,
            "기다리는 질문이 칸에 서지 않았다",
          );

          // 창을 닫았다 다시 연다. 결정되지 않는다: 질문은 답 없이 그대로 기다린다.
          await reopen();
          await openDock();
          const kept = (await questions()).find((row) =>
            row.id === question.id
          );
          assertEquals(kept?.status, "pending", "창을 닫았다고 질문이 닫혔다");
          assertEquals(kept?.answer, null, "답 없이 답이 생겼다");
          const text = await mustCall(flow, {
            kind: "read",
            resource: "questions",
            method: "text",
            body: { question: question.id },
          });
          assertEquals(text.prompt, ASK, "질문 본문이 바뀌었다");
          await flow.until(
            `document.querySelector("[data-question-text='ready']")?.textContent === ${
              JSON.stringify(ASK)
            }`,
            "다시 연 화면에 기다리는 질문이 없다",
          );
        },
      );

      await t.step(
        "lophn-agent/handoff#R5: 6 맡긴 일은 보낸 run의 전달 사실로 남고 받는 역할의 독립 run으로 시작한다",
        async () => {
          await flow.type(INPUT, THIRD);
          await flow.click(SEND);
          await untilConfirmed();
          await untilRuns(agent.id, 3, "세 번째 run이 접수되지 않았다");
          const sent = await latestRun(agent.id);
          assert(sent !== null, "세 번째 run이 없다");
          // 보낸 run: handoff tool call 하나를 내고 그 결과 뒤 답으로 끝난다.
          const sender = await untilRun(
            agent.id,
            (row) => row.id === sent.id && row.state === "finished",
            "보낸 run이 끝나지 않았다",
          );
          // 전달 사실은 보낸 run의 trace에 남는다: tool call 하나와 받는 run으로의 연결.
          const trace = await mustCall(flow, {
            kind: "read",
            resource: "agent-traces",
            method: "read",
            body: { target: { kind: "run", run: sender.id } },
          });
          assertEquals(
            sender.outcome?.kind,
            "completed",
            `보낸 run이 정상 종료하지 않았다: ${JSON.stringify(sender)} ${
              JSON.stringify(trace).slice(0, 1500)
            } last_call=${
              JSON.stringify(fixture.requests().at(-1)?.body).slice(-1500)
            }`,
          );
          const facts = trace.trace as {
            handoff_links: { sender_run: string; receiver_run: string }[];
            tool_calls: string[];
          };
          assertEquals(
            facts.handoff_links.length,
            1,
            "전달 사실이 trace에 없다",
          );
          assertEquals(facts.handoff_links[0]!.sender_run, sender.id);
          assertEquals(facts.tool_calls.length, 1, "전달 tool call이 없다");
          // 받는 역할의 run: 독립 run 하나가 handoff 출처로 접수되고 실제로 시작한다. 맡긴 내용은
          // 그 run의 요청으로 읽힌다(runs/body handoff_content). 받는 run의 판단 call은 지금 제품이
          // 기록하지 못해(머리 주석) 끝 결과는 보지 않는다.
          const receiver = await untilRun(
            editor.id,
            (row) => row.source.kind === "handoff" && row.started_at !== null,
            "받는 run이 시작하지 않았다",
          );
          assertEquals(receiver.id, facts.handoff_links[0]!.receiver_run);
          assertEquals(
            (receiver.source as { sender_run?: string }).sender_run,
            sender.id,
          );
        },
      );
    } finally {
      await flow.close();
      await removeHome(home);
      await fixture.close();
    }
  },
});

async function readCmdline(pid: number): Promise<string> {
  const raw = await Deno.readFile(`/proc/${pid}/cmdline`);
  return new TextDecoder().decode(raw).replaceAll("\0", " ");
}
