// lophn-agent/questions: 질문의 글(본문·이유·선택지 설명·추천 이유·자유 답·취소 이유)은 요청에
// 값으로 실려 오고, core가 redaction을 거쳐 blob으로 준비하며, command가 같은 transaction에서
// 영구 참조를 등록한다. 읽기(ReadQuestionText)는 메시지 본문 읽기와 같은 길이다. 실제 core와
// temp LOPHN_HOME, 가짜 시계에서 본다(사람 데이터 root와 실제 provider는 쓰지 않는다).
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  ask,
  blobBytes,
  blobHashes,
  command,
  created,
  fixture,
  grant,
  groupBody,
  id,
  only,
  option,
  plainAnswer,
  post,
  readText,
  refs,
  SECRET,
  settingsAction,
  sha,
  start,
  status,
  type Text,
  world,
} from "./testing/question-world.ts";

Deno.test("lophn-agent/questions#R4 [agent-I13]: the person reads the group text with redaction applied, and each text is one permanent reference of the group", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const q = await created(w, 1, {
        prompt: `Which one? ${SECRET} 어느 쪽이 좋을까요`,
        reason: `Both work. ${SECRET}`,
        options: [option("a"), option("b")],
        recommendation: { option_key: "a", explanation: "Smaller change." },
      });
      assertEquals(q.status, "pending");
      const read = await readText(w, w.user, q.id);
      assertEquals(read.status, 200, JSON.stringify(read.body));
      const text = read.body as Text;
      assertEquals(text.group, q.id);
      assertEquals(text.questions.length, 1);
      const first = only(text);
      // 글은 redaction을 거친 값이다. secret 원문은 응답에도 blob 어디에도 남지 않는다.
      assertEquals(first.prompt, "Which one? * 어느 쪽이 좋을까요");
      assertEquals(first.reason, "Both work. *");
      assertEquals(first.options, [
        { key: "a", description: "Description of a" },
        { key: "b", description: "Description of b" },
      ]);
      assertEquals(first.recommendation, {
        option_key: "a",
        explanation: "Smaller change.",
      });
      assertEquals(first.answer_text, null);
      assertEquals(text.closed_reason_text, null);
      assert(!JSON.stringify(read.body).includes(SECRET));
      for (const name of await blobHashes(f.home)) {
        assert(!(await blobBytes(f.home, name)).includes(SECRET));
      }
      // 저장된 묶음 record의 hash는 읽은 글의 UTF-8 bytes의 hash다.
      const record = await post(
        core.port,
        "questions/read",
        { group: q.id },
        w.user,
      );
      assertEquals(record.status, 200, JSON.stringify(record.body));
      const stored = (record.body as {
        group: {
          questions: {
            prompt_blob: string;
            reason_blob: string;
            options: { description_blob: string }[];
          }[];
        };
      }).group.questions[0]!;
      assertEquals(
        stored.prompt_blob,
        await sha("Which one? * 어느 쪽이 좋을까요"),
      );
      assertEquals(
        stored.options[1]!.description_blob,
        await sha("Description of b"),
      );
      // 참조는 묶음이 owner이고 field마다 영구 하나다(같은 글은 한 참조).
      assertEquals(
        refs(f.home, q.id).map((ref) => ref.field),
        [
          "option_description",
          "option_description",
          "prompt",
          "reason",
          "recommendation",
        ],
      );
      // 질문한 agent와 machine도 읽는다.
      for (const token of [w.agent, w.machine]) {
        const same = await readText(w, token, q.id);
        assertEquals(same.status, 200, JSON.stringify(same.body));
        assertEquals(only(same.body as Text).prompt, first.prompt);
      }
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/questions#R4 [agent-I13]: a group with several questions keeps each question's own text and the same text is one reference", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const question = (n: number, extra: Record<string, unknown> = {}) => ({
        id: id("qst", n),
        prompt: `Prompt ${n} ${SECRET}`,
        reason: "Shared reason",
        options: [option("a")],
        recommendation: null,
        ...extra,
      });
      const q = await created(w, 1, {
        questions: [question(1), question(2), question(3, { options: [] })],
      });
      const text = (await readText(w, w.user, q.id)).body as Text;
      // 질문은 묶음 순서로 나오고 글마다 자기 질문에 속한다. secret은 어디에도 없다.
      assertEquals(text.questions.map((one) => one.question), [
        id("qst", 1),
        id("qst", 2),
        id("qst", 3),
      ]);
      assertEquals(text.questions.map((one) => one.prompt), [
        "Prompt 1 *",
        "Prompt 2 *",
        "Prompt 3 *",
      ]);
      assertEquals(text.questions.map((one) => one.options.length), [1, 1, 0]);
      assert(!JSON.stringify(text).includes(SECRET));
      for (const name of await blobHashes(f.home)) {
        assert(!(await blobBytes(f.home, name)).includes(SECRET));
      }
      // 질문 셋의 같은 이유·같은 선택지 설명은 묶음의 참조 하나씩이다. 본문은 질문마다 하나다.
      const fields = refs(f.home, q.id).map((ref) => ref.field);
      assertEquals(fields.filter((field) => field === "prompt").length, 3);
      assertEquals(fields.filter((field) => field === "reason").length, 1);
      assertEquals(
        fields.filter((field) => field === "option_description").length,
        1,
      );
      // 자유 답 둘은 한 Submit으로 받고 질문마다 자기 글을 읽는다. 읽기 범위는 묶음이다.
      const submitted = await plainAnswer(w, q, [
        { question: id("qst", 1), answer: { kind: "option", option_key: "a" } },
        {
          question: id("qst", 2),
          answer: { kind: "text", text: "Second answer" },
        },
        {
          question: id("qst", 3),
          answer: { kind: "text", text: "Third answer" },
        },
      ], "answer-group");
      assertEquals(submitted.status, 200, JSON.stringify(submitted.body));
      const answered = (await readText(w, w.user, q.id)).body as Text;
      assertEquals(answered.questions.map((one) => one.answer_text), [
        null,
        "Second answer",
        "Third answer",
      ]);
      const asCoding = (await readText(w, w.coding, q.id)).body as Text;
      assertEquals(asCoding.questions.map((one) => one.answer_text), [
        null,
        null,
        null,
      ]);
      assertEquals(
        refs(f.home, q.id).filter((ref) => ref.field === "answer").length,
        2,
      );
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/questions#R10: an agent of another assignment and any other caller get the same not_found as for an absent group", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const q = await created(w, 1, { options: [option("a")] });
      const missing = id("qgr", 77);
      // 다른 assignment의 agent가 받는 답은 없는 묶음에 받는 답과 같다.
      const outOfScope = await readText(w, w.otherAgent, q.id);
      const absent = await readText(w, w.otherAgent, missing);
      assertEquals(outOfScope.status, 404, JSON.stringify(outOfScope.body));
      assertEquals(outOfScope, absent);
      assertEquals(await readText(w, w.user, missing), {
        status: 404,
        body: absent.body,
      });
      // 읽는 쪽으로 열려 있지 않은 자격(app)도 있는 묶음과 없는 묶음을 구별해 답하지 않는다.
      const app = await grant(f, core, `app:${id("app", 1)}`);
      const appReal = await readText(w, app, q.id);
      const appAbsent = await readText(w, app, missing);
      assertNotEquals(appReal.status, 200);
      assertEquals(appReal, appAbsent);
      // 읽을 수 없는 자격이 아무것도 바꾸지 않았다.
      assertEquals(status(f.home, q.id), "pending");
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/questions#R6 [agent-I13]: a plain answer needs no confirmation handle and a free-text answer's text is stored and readable", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      // action 없는 선택지는 handle 없이 받는다.
      const first = await created(w, 1, {
        options: [option("a"), option("b")],
      });
      const picked = await plainAnswer(
        w,
        first,
        { kind: "option", option_key: "a" },
        "answer-1",
      );
      assertEquals(picked.status, 200, JSON.stringify(picked.body));
      assertEquals(status(f.home, first.id), "answered");
      const pickedText = await readText(w, w.user, first.id);
      assertEquals(pickedText.status, 200, JSON.stringify(pickedText.body));
      // 선택지 답에는 자유 답 글이 없다.
      assertEquals(only(pickedText.body as Text).answer_text, null);
      // 같은 답의 재전송은 저장된 결과이고 새 결정이 아니다.
      const again = await plainAnswer(
        w,
        first,
        { kind: "option", option_key: "a" },
        "answer-1",
      );
      assertEquals(again, picked);
      // 자유 답은 글을 값으로 보낸다. core가 blob으로 준비하고 hash는 호출자가 만들지 않는다.
      const second = await created(w, 2);
      const said = "두 번째 안으로 가 주세요. Please use the second one.";
      const answered = await plainAnswer(
        w,
        second,
        { kind: "text", text: said },
        "answer-2",
      );
      assertEquals(answered.status, 200, JSON.stringify(answered.body));
      const read = await readText(w, w.user, second.id);
      assertEquals(read.status, 200, JSON.stringify(read.body));
      assertEquals(only(read.body as Text).answer_text, said);
      const record = await post(
        core.port,
        "questions/read",
        { group: second.id },
        w.user,
      );
      assertEquals(
        (record.body as {
          group: { questions: { answer: unknown }[] };
        }).group.questions[0]!.answer,
        { kind: "text", option_key: null, text_blob: await sha(said) },
      );
      const saidHash = await sha(said);
      assert(
        refs(f.home, second.id).some((ref) =>
          ref.field === "answer" && ref.hash === saidHash &&
          Number(ref.size_bytes) === new TextEncoder().encode(said).length
        ),
      );
      // 질문한 agent는 자기 묶음의 답을 읽고, coding_agent는 사람이 남긴 글을 받지 않는다.
      const asAgent = await readText(w, w.agent, second.id);
      assertEquals(only(asAgent.body as Text).answer_text, said);
      const asCoding = await readText(w, w.coding, second.id);
      assertEquals(asCoding.status, 200, JSON.stringify(asCoding.body));
      assertEquals(only(asCoding.body as Text).prompt, "Prompt 2");
      assertEquals(only(asCoding.body as Text).answer_text, null);
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/questions#R11 [agent-I13]: a free-text answer that looks like a secret holds back the whole Submit before anything is stored", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const q = await created(w, 1);
      const before = await blobHashes(f.home);
      for (
        const text of [`my token is ${SECRET}`, "   \n ", ""]
      ) {
        const held = await plainAnswer(
          w,
          q,
          { kind: "text", text },
          `answer-${text.length}`,
        );
        assertEquals(held.status, 400, JSON.stringify(held.body));
        assert(!JSON.stringify(held.body).includes(SECRET));
      }
      // 막힌 답은 저장도 준비도 되지 않고 묶음은 미답으로 남는다.
      assertEquals(status(f.home, q.id), "pending");
      assertEquals(await blobHashes(f.home), before);
      assertEquals(refs(f.home, q.id).filter((r) => r.field === "answer"), []);
      // 질문 둘 중 하나의 자유 답만 secret이어도 묶음 전체가 막히고 맞는 답도 저장되지 않는다.
      // 같은 run은 묶음 하나씩만 기다리므로 앞 묶음은 미룬다.
      const deferred = await post(
        core.port,
        "questions/defer",
        command(
          { group: q.id, created_seq: q.created_seq },
          "defer-first",
          { created_seq: q.created_seq },
        ),
        w.user,
      );
      assertEquals(deferred.status, 200, JSON.stringify(deferred.body));
      const pair = await created(w, 2, {
        questions: [2, 3].map((n) => ({
          id: id("qst", n),
          prompt: `Prompt ${n}`,
          reason: "r",
          options: [],
          recommendation: null,
        })),
      });
      const mixed = await plainAnswer(w, pair, [
        { question: id("qst", 2), answer: { kind: "text", text: "Fine." } },
        {
          question: id("qst", 3),
          answer: { kind: "text", text: `token ${SECRET}` },
        },
      ], "answer-mixed");
      assertEquals(mixed.status, 400, JSON.stringify(mixed.body));
      assert(!JSON.stringify(mixed.body).includes(SECRET));
      assertEquals(status(f.home, pair.id), "pending");
      assertEquals(
        refs(f.home, pair.id).filter((r) => r.field === "answer"),
        [],
      );
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("platform/identity#R14: a fixed-change answer is refused without a confirmation handle on either route", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const action = settingsAction(id("qst", 1));
      const q = await created(w, 1, {
        options: [option("plain"), option("apply", action)],
      });
      // user token은 클릭의 증거가 아니다. action이 있는 선택지는 확인 없는 일반 답으로
      // 받지 않는다.
      const viaPlain = await plainAnswer(
        w,
        q,
        { kind: "option", option_key: "apply" },
        "answer-plain",
      );
      assertEquals(viaPlain.status, 403, JSON.stringify(viaPlain.body));
      const actionInput = {
        group: q.id,
        created_seq: q.created_seq,
        answer: { kind: "option", option_key: "apply" },
        binding_hash: action.binding_hash,
        evidence: { question: id("qst", 1), option: "apply" },
      };
      // action 답 route는 handle 없이 받지 않는다.
      const viaAction = await post(
        core.port,
        "questions/answer-action",
        command(actionInput, "answer-action", {
          created_seq: q.created_seq,
        }),
        w.user,
      );
      // 확인 handle이 요청 모양의 필수 부분이라 요청이 계약 검사에서 거절된다.
      assertEquals(viaAction.status, 400, JSON.stringify(viaAction.body));
      // 잘못된 모양의 handle도 받지 않는다.
      const forged = await post(
        core.port,
        "questions/answer-action",
        {
          ...command(actionInput, "answer-forged", {
            created_seq: q.created_seq,
          }),
          confirmation: "x".repeat(43),
        },
        w.user,
      );
      assertNotEquals(forged.status, 200, JSON.stringify(forged.body));
      assertEquals(status(f.home, q.id), "pending");
      // action 없는 선택지는 같은 묶음에서 확인 없이 답할 수 있다.
      const plain = await plainAnswer(
        w,
        q,
        { kind: "option", option_key: "plain" },
        "answer-ok",
      );
      assertEquals(plain.status, 200, JSON.stringify(plain.body));
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/questions#R9 [agent-I13]: a cancel reason carries text and is readable by the person but not by a coding agent", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const q = await created(w, 1, { options: [option("a")] });
      const reason = `더는 필요 없다. ${SECRET}`;
      const cancelled = await post(
        core.port,
        "questions/cancel",
        command(
          {
            group: q.id,
            created_seq: q.created_seq,
            closed_reason: "cancelled",
            closed_reason_text: reason,
          },
          "cancel-1",
          { created_seq: q.created_seq },
        ),
        w.user,
      );
      assertEquals(cancelled.status, 200, JSON.stringify(cancelled.body));
      const read = await readText(w, w.user, q.id);
      assertEquals(read.status, 200, JSON.stringify(read.body));
      assertEquals((read.body as Text).closed_reason_text, "더는 필요 없다. *");
      assertEquals(
        (await readText(w, w.agent, q.id)).body as Text,
        read.body as Text,
      );
      assertEquals(
        ((await readText(w, w.coding, q.id)).body as Text).closed_reason_text,
        null,
      );
      assertEquals(
        refs(f.home, q.id).filter((ref) => ref.field === "closed").length,
        1,
      );
      // 미루기는 사람 글이 없다. 이유 글도 없다.
      const deferred = await created(w, 2);
      const closed = await post(
        core.port,
        "questions/defer",
        command(
          { group: deferred.id, created_seq: deferred.created_seq },
          "defer-2",
          { created_seq: deferred.created_seq },
        ),
        w.user,
      );
      assertEquals(closed.status, 200, JSON.stringify(closed.body));
      assertEquals(
        ((await readText(w, w.user, deferred.id)).body as Text)
          .closed_reason_text,
        null,
      );
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/questions#R10 [agent-I13]: an unreadable text blob makes the whole group read unavailable", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const q = await created(w, 1, {
        questions: [1, 2].map((n) => ({
          id: id("qst", n),
          prompt: `Prompt ${n}`,
          reason: "r",
          options: [option("a")],
          recommendation: null,
        })),
      });
      assertEquals((await readText(w, w.user, q.id)).status, 200);
      // 둘째 질문의 blob 파일이 사라지면 일부만 돌려주지 않고 unavailable이다.
      const hash = await sha("Prompt 2");
      await Deno.remove(
        `${f.home}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`,
      );
      const lost = await readText(w, w.user, q.id);
      assertEquals(lost.status, 503, JSON.stringify(lost.body));
      assertEquals(
        (lost.body as { error?: { code?: string } }).error?.code ??
          (lost.body as { code?: string }).code,
        "unavailable",
      );
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/questions#R3 [agent-I13]: an oversize text or the old hash-only shape is rejected before anything is stored", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const before = await blobHashes(f.home);
      const big = await ask(w, 1, { prompt: "a".repeat(33_000) });
      assertEquals(big.status, 400, JSON.stringify(big.body));
      // hash만 보내는 옛 모양도 받지 않는다: 호출자는 blob을 만들지 않는다.
      const hashed = await post(
        core.port,
        "questions/create",
        command(
          {
            id: id("qgr", 2),
            run: w.run,
            session: null,
            expires_at: null,
            questions: [{
              id: id("qst", 2),
              prompt_blob: "ab".repeat(32),
              reason_blob: "cd".repeat(32),
              options: [],
              recommendation: null,
            }],
          },
          "ask-hash",
          {},
          w.run,
        ),
        w.agent,
      );
      assertEquals(hashed.status, 400, JSON.stringify(hashed.body));
      assertEquals(await blobHashes(f.home), before);
      assertEquals(refs(f.home, id("qgr", 1)), []);
      // 둘째 질문의 글이 상한을 넘어도 묶음 전체가 거절되고 첫 질문의 글도 준비되지 않는다.
      const second = await ask(w, 4, {
        questions: [
          {
            id: id("qst", 4),
            prompt: "fine",
            reason: "r",
            options: [],
            recommendation: null,
          },
          {
            id: id("qst", 5),
            prompt: "b".repeat(33_000),
            reason: "r",
            options: [],
            recommendation: null,
          },
        ],
      });
      assertEquals(second.status, 400, JSON.stringify(second.body));
      assertEquals(await blobHashes(f.home), before);
      // 상한 안의 가장 큰 글은 받는다.
      const fits = await ask(w, 3, { prompt: "a".repeat(32_768) });
      assertEquals(fits.status, 200, JSON.stringify(fits.body));
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R1 [agent-I13]: WaitRun carries a new group whose texts are redacted and prepared like CreateQuestionGroup", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const read = await post(
        core.port,
        "runs/read",
        { run: w.run },
        w.machine,
      );
      assertEquals(read.status, 200, JSON.stringify(read.body));
      const group = groupBody(w, 1, {
        questions: [1, 2].map((n) => ({
          id: id("qst", n),
          prompt: `Prompt ${n} ${SECRET}`,
          reason: `Reason ${n}`,
          options: [option("a")],
          recommendation: null,
        })),
      });
      const waited = await post(
        core.port,
        "runs/wait",
        command(
          {
            run: w.run,
            request: { kind: "question", input: group },
            call: null,
          },
          "wait-group",
          {
            state_seq:
              (read.body as { run: { state_seq: string } }).run.state_seq,
          },
        ),
        w.machine,
      );
      assertEquals(waited.status, 200, JSON.stringify(waited.body));
      // 묶음이 만들어졌고 run은 그 묶음 하나를 기다린다. 글은 redaction을 거친 값이다.
      const waiting = await post(
        core.port,
        "runs/read",
        { run: w.run },
        w.machine,
      );
      const run = (waiting.body as {
        run: { state: string; waiting_on: string };
      }).run;
      assertEquals(run.state, "waiting_user");
      assertEquals(run.waiting_on, group.id);
      const text = (await readText(w, w.user, group.id)).body as Text;
      assertEquals(text.questions.map((one) => one.prompt), [
        "Prompt 1 *",
        "Prompt 2 *",
      ]);
      assert(!JSON.stringify(text).includes(SECRET));
      for (const name of await blobHashes(f.home)) {
        assert(!(await blobBytes(f.home, name)).includes(SECRET));
      }
      assertEquals(status(f.home, group.id), "pending");
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});
