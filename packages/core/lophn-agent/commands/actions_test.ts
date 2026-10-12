import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { AgentRole } from "../../../protocol/lophn-agent/mod.ts";
import {
  type CommandPorts,
  createCommandQueue,
  runCommand,
} from "./actions.ts";
import { buildRegistry, type RegistrySkill } from "./registry.ts";
import {
  CHECK_CONTRACTS_PROMPT,
  NEW_APP_PROMPT,
  NEW_CONTEXT_PROMPT,
  REPAIR_APP_PROMPT,
  skillPrompt,
} from "./role-prompts.ts";

// 명령 실행(concern lophn-agent/commands). session 동작은 port로만 부르므로 fake port가 부른 것을
// 그대로 적는다. 실제 session command의 결과는 conversation의 ledger 시험이 본다.

const SESSION = "ses_01arz3ndektsv4rrffq69g5fav";

type Call = [string, ...unknown[]];

function fakePorts(
  options: { fail?: string } = {},
): { ports: CommandPorts; calls: Call[] } {
  const calls: Call[] = [];
  function reply<T>(name: string, value: T, args: unknown[] = []): Result<T> {
    calls.push([name, ...args]);
    return options.fail === name
      ? err({ code: "conflict", message: `${name} failed` })
      : ok(value);
  }
  const ports: CommandPorts = {
    newSession: () => Promise.resolve(reply("new", { session: "ses_new" })),
    renameSession: (title) =>
      Promise.resolve(reply("rename", undefined, [title])),
    archiveSession: () => Promise.resolve(reply("archive", undefined)),
    requestCompact: () => Promise.resolve(reply("compact", undefined)),
    forkSession: () => Promise.resolve(reply("fork", { session: "ses_fork" })),
    sendMessage: (text) => Promise.resolve(reply("send", undefined, [text])),
  };
  return { ports, calls };
}

const skill = (
  name: string,
  over: Partial<RegistrySkill> = {},
): RegistrySkill => ({
  name,
  description: `Use ${name}`,
  origin: "workspace",
  selected: true,
  ...over,
});

function world(
  role: AgentRole = "lophn",
  skills: readonly RegistrySkill[] = [],
  options: { fail?: string } = {},
) {
  const { ports, calls } = fakePorts(options);
  const queue = createCommandQueue();
  const registry = buildRegistry({ role, skills });
  return {
    calls,
    queue,
    ports,
    run: (text: string, working = false) =>
      runCommand({ registry, ports, queue, session: SESSION }, {
        text,
        working,
      }),
  };
}

Deno.test("lophn-agent/commands#R9 [agent-I16]: New session, Archive and Rename run the session actions", async () => {
  const w = world();
  assertEquals(await w.run("/new"), {
    kind: "opened_session",
    command: "new",
    session: "ses_new",
  });
  assertEquals(await w.run("/archive"), { kind: "done", command: "archive" });
  assertEquals(await w.run("/rename  Weekly plan "), {
    kind: "done",
    command: "rename",
  });
  assertEquals(w.calls, [["new"], ["archive"], ["rename", "Weekly plan"]]);
});

Deno.test("lophn-agent/commands#R9 [agent-I16]: Rename without a title asks for one and changes nothing", async () => {
  const w = world();
  assertEquals(await w.run("/rename"), {
    kind: "needs_argument",
    command: "rename",
  });
  assertEquals(await w.run("/rename   "), {
    kind: "needs_argument",
    command: "rename",
  });
  assertEquals(w.calls, []);
});

Deno.test("lophn-agent/commands#R8 [agent-I16]: Rename, Archive and New session run at once while the agent works", async () => {
  const w = world();
  assertEquals((await w.run("/rename Plan", true)).kind, "done");
  assertEquals((await w.run("/archive", true)).kind, "done");
  assertEquals((await w.run("/new", true)).kind, "opened_session");
  assertEquals(w.calls.map(([name]) => name), ["rename", "archive", "new"]);
});

Deno.test("lophn-agent/commands#R9 [agent-I16]: Fork copies the session into a new one when nothing is running", async () => {
  const w = world();
  assertEquals(await w.run("/fork"), {
    kind: "opened_session",
    command: "fork",
    session: "ses_fork",
  });
  assertEquals(w.calls, [["fork"]]);
});

Deno.test("lophn-agent/commands#R8 [agent-I16]: Fork is blocked while the agent works and nothing is called", async () => {
  const w = world();
  assertEquals(await w.run("/fork", true), {
    kind: "blocked",
    command: "fork",
  });
  assertEquals(w.calls, []);
});

Deno.test("lophn-agent/commands#R8 [agent-I16b]: Compact is requested at once when idle and waits for the run to end when working", async () => {
  const w = world();
  assertEquals(await w.run("/compact"), {
    kind: "requested",
    command: "compact",
  });
  assertEquals(w.calls, [["compact"]]);

  // 작업 중이면 부르지 않고 줄 세운다. 같은 session에 두 번 줄 세워도 한 번만 실행한다.
  assertEquals(await w.run("/compact", true), {
    kind: "queued",
    command: "compact",
  });
  assertEquals(await w.run("/compact", true), {
    kind: "queued",
    command: "compact",
  });
  assertEquals(w.calls, [["compact"]]);
  // 이번 일이 끝난 뒤 한 번 실행되고 다시 비운다.
  assertEquals(await w.queue.drain(SESSION, w.ports), [
    { kind: "requested", command: "compact" },
  ]);
  assertEquals(w.calls, [["compact"], ["compact"]]);
  assertEquals(await w.queue.drain(SESSION, w.ports), []);
  assertEquals(w.calls.length, 2);
});

Deno.test("lophn-agent/commands#R8 [agent-I16]: a queued Compact belongs to its session and a failed one is reported once", async () => {
  const w = world("lophn", [], { fail: "compact" });
  assertEquals((await w.run("/compact", true)).kind, "queued");
  // 다른 session이 끝나도 실행하지 않는다.
  assertEquals(await w.queue.drain("ses_other", w.ports), []);
  assertEquals(w.calls, []);
  const drained = await w.queue.drain(SESSION, w.ports);
  assertEquals(drained.length, 1);
  assertEquals(drained[0]!.kind, "failed");
  // 실패해도 줄에 다시 남지 않는다. 사람이 다시 부른다.
  assertEquals(await w.queue.drain(SESSION, w.ports), []);
});

Deno.test("lophn-agent/commands#R9 [agent-I16]: MCP, Skills and Permissions only open their screen", async () => {
  const w = world();
  for (const screen of ["mcp", "skills", "permissions"] as const) {
    assertEquals(await w.run(`/${screen}`), {
      kind: "open_screen",
      screen,
    });
    assertEquals(await w.run(`/${screen}`, true), {
      kind: "open_screen",
      screen,
    });
  }
  // 화면을 여는 것으로 session 동작도 메시지도 만들지 않는다(R10: 명령이 권한을 늘리지 않는다).
  assertEquals(w.calls, []);
});

Deno.test("lophn-agent/commands#R9 [agent-I16]: a role command is accepted as the person's message from its prompt", async () => {
  const lophn = world("lophn");
  assertEquals(await lophn.run("/new-app"), {
    kind: "sent",
    command: "new-app",
    queued: false,
  });
  assertEquals(await lophn.run("/repair-app"), {
    kind: "sent",
    command: "repair-app",
    queued: false,
  });
  assertEquals(lophn.calls, [
    ["send", NEW_APP_PROMPT],
    ["send", REPAIR_APP_PROMPT],
  ]);

  const ce = world("context_engineer");
  assertEquals((await ce.run("/check-contracts")).kind, "sent");
  assertEquals((await ce.run("/new-context")).kind, "sent");
  assertEquals(ce.calls, [
    ["send", CHECK_CONTRACTS_PROMPT],
    ["send", NEW_CONTEXT_PROMPT],
  ]);
});

Deno.test("lophn-agent/commands#R9 [agent-I16]: text after a role command is appended to its prompt", async () => {
  const w = world("lophn");
  await w.run("/new-app  a habit tracker ");
  assertEquals(w.calls, [["send", `${NEW_APP_PROMPT}\n\na habit tracker`]]);
});

Deno.test("lophn-agent/commands#R8 [agent-I16]: a role command given while the agent works is accepted as the next request", async () => {
  const w = world("lophn");
  assertEquals(await w.run("/new-app", true), {
    kind: "sent",
    command: "new-app",
    queued: true,
  });
  assertEquals(w.calls, [["send", NEW_APP_PROMPT]]);
});

Deno.test("lophn-agent/commands#R3 [agent-I16]: another role's command is neither sent nor run", async () => {
  const lophn = world("lophn");
  assertEquals(await lophn.run("/check-contracts"), {
    kind: "unknown_command",
    name: "check-contracts",
  });
  const ae = world("app_engineer");
  assertEquals(await ae.run("/new-app"), {
    kind: "unknown_command",
    name: "new-app",
  });
  assertEquals(lophn.calls, []);
  assertEquals(ae.calls, []);
});

Deno.test("lophn-agent/commands#R9 [agent-I16]: a skill command is accepted as a message naming the skill and keeps the text after it", async () => {
  const w = world("operator", [skill("review")]);
  assertEquals(await w.run("/review src/a.ts"), {
    kind: "sent",
    command: "review",
    queued: false,
  });
  assertEquals(await w.run("/review", true), {
    kind: "sent",
    command: "review",
    queued: true,
  });
  assertEquals(w.calls, [
    ["send", skillPrompt("review", "src/a.ts")],
    ["send", skillPrompt("review", "")],
  ]);
  assert(skillPrompt("review", "src/a.ts").includes("review"));
  assert(skillPrompt("review", "src/a.ts").includes("src/a.ts"));
  assert(!skillPrompt("review", "").includes("\n\n"));
});

Deno.test("lophn-agent/commands#R6 [agent-I16]: a name shared by two skills asks which one and sends nothing", async () => {
  const w = world("lophn", [
    skill("review", { origin: "place" }),
    skill("review", { origin: "workspace" }),
  ]);
  const outcome = await w.run("/review");
  assertEquals(outcome.kind, "choose_skill");
  if (outcome.kind === "choose_skill") {
    assertEquals(outcome.name, "review");
    assertEquals(outcome.candidates.map((entry) => entry.skill_origin), [
      "place",
      "workspace",
    ]);
  }
  assertEquals(w.calls, []);
});

Deno.test("lophn-agent/commands#R5 [agent-I16]: a skill named like a built-in never runs, the built-in does", async () => {
  const w = world("lophn", [skill("compact")]);
  assertEquals(await w.run("/compact"), {
    kind: "requested",
    command: "compact",
  });
  assertEquals(w.calls, [["compact"]]);
});

Deno.test("lophn-agent/commands#R11 [agent-I16]: an unknown command is reported and never sent as a message", async () => {
  const w = world("lophn", [skill("review")]);
  assertEquals(await w.run("/compcat"), {
    kind: "unknown_command",
    name: "compcat",
  });
  assertEquals(await w.run("/compcat now", true), {
    kind: "unknown_command",
    name: "compcat",
  });
  assertEquals(w.calls, []);
});

Deno.test("lophn-agent/commands#R11 [agent-I16]: text that does not start with a slash is left to the normal send", async () => {
  const w = world();
  assertEquals(await w.run("compact the notes"), { kind: "message" });
  assertEquals(await w.run("see /compact later"), { kind: "message" });
  assertEquals(w.calls, []);
});

Deno.test("lophn-agent/commands#R9 [agent-I16]: a refused session action is reported with its error and nothing is retried", async () => {
  for (
    const [text, name] of [
      ["/new", "new"],
      ["/archive", "archive"],
      ["/rename Plan", "rename"],
      ["/fork", "fork"],
      ["/compact", "compact"],
      ["/new-app", "send"],
    ] as const
  ) {
    const w = world("lophn", [], { fail: name });
    const outcome = await w.run(text);
    assertEquals(outcome.kind, "failed");
    if (outcome.kind === "failed") {
      assertEquals(outcome.error.code, "conflict");
    }
    assertEquals(w.calls.length, 1);
  }
});
