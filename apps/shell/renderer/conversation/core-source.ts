// ConversationSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route
// output schema로 이미 검사했다. 아래 모양은 그 schema(assignments.list, sessions.list,
// messages.list, messages.body, runs.list, sessions.open, messages.receive, runs.stop,
// documents.get)에서 이 화면이 읽는 field만 옮긴 것이다.
import type { CoreCall } from "../../ipc/core.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import type {
  Agent,
  BodyPart,
  ConversationSource,
  MessageActor,
  MessageRow,
  ResultLink,
  RunRow,
  SessionRow,
  SourceResult,
} from "./source.ts";

interface Page {
  next_cursor: string | null;
}

interface AssignmentValue {
  id: string;
  state: Agent["state"];
  revision: number;
}

interface SessionValue {
  id: string;
  state: "open" | "closed";
  state_seq: string;
}

interface MessageValue {
  message: {
    id: string;
    actor: string;
    body: string;
    run: string | null;
    mode: "request" | "correction" | null;
    applied_at_call: string | null;
    links: { kind: string; document?: string; version?: string }[];
  };
}

interface BodyValue {
  content: {
    parts: (
      | { kind: "text"; text: string }
      | { kind: "visual"; block: { key: string; kind: string; title: string } }
    )[];
  };
}

interface RunValue {
  id: string;
  session: string | null;
  state: RunRow["state"];
  outcome: { kind: "completed" | "failed" | "stopped" } | null;
  state_seq: string;
  accepted_seq: string;
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 20;

async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  try {
    const reply = await core.call({ kind, resource, method, body });
    if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
    return { ok: true, value: reply.value as T };
  } catch {
    // 통로가 끊겨 결과를 모른다. 보낸 말은 접수 조회로 확인한다.
    return { ok: false, code: "unavailable" };
  }
}

async function command<T>(
  core: CoreSource,
  resource: string,
  method: string,
  body: { input: unknown; compare: unknown; key: string },
): Promise<SourceResult<T>> {
  const result = await call<{ result: T }>(core, "command", resource, method, {
    input: body.input,
    idempotency_key: body.key,
    compare: body.compare,
    prepared: [],
  });
  return result.ok ? { ok: true, value: result.value.result } : result;
}

async function pages<T, V extends Page>(
  core: CoreSource,
  resource: string,
  method: string,
  input: Record<string, unknown>,
  rows: (value: V) => readonly T[],
): Promise<SourceResult<readonly T[]>> {
  const found: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const result: SourceResult<V> = await call<V>(
      core,
      "read",
      resource,
      method,
      cursor === null ? input : { ...input, cursor },
    );
    if (!result.ok) return result;
    found.push(...rows(result.value));
    cursor = result.value.next_cursor;
    if (cursor === null) break;
  }
  return { ok: true, value: found };
}

function actorOf(actor: string): MessageActor {
  if (actor === "user") return "user";
  if (actor === "machine") return "machine";
  return "agent";
}

// 결과로 보이는 것은 문서와 판뿐이다. 질문·approval·model·tool 링크는 결과가 아니다.
function resultsOf(links: MessageValue["message"]["links"]): ResultLink[] {
  const results: ResultLink[] = [];
  for (const link of links) {
    if (link.kind === "document" && link.document) {
      results.push({ kind: "document", document: link.document });
    }
    if (link.kind === "version" && link.document && link.version) {
      results.push({
        kind: "version",
        document: link.document,
        version: link.version,
      });
    }
  }
  return results;
}

// 시각 블록은 블록 renderer(shell#T35)가 들어오기 전까지 제목과 종류만 넘긴다. payload는
// 이 화면에 오지 않으므로 그릴 수도 실행할 수도 없다.
function partOf(part: BodyValue["content"]["parts"][number]): BodyPart {
  if (part.kind === "text") return { kind: "text", text: part.text };
  return {
    kind: "visual",
    key: part.block.key,
    visual: part.block.kind,
    title: part.block.title,
  };
}

function sessionOf(value: SessionValue): SessionRow {
  return { id: value.id, state: value.state, stateSeq: value.state_seq };
}

export function coreConversationSource(core: CoreSource): ConversationSource {
  return {
    watch: (listener) => core.subscribe(listener),

    async agent() {
      const listed = await pages<
        AssignmentValue,
        Page & {
          assignments: AssignmentValue[];
        }
      >(
        core,
        "assignments",
        "list",
        { role: "lophn" },
        (value) => value.assignments,
      );
      if (!listed.ok) return listed;
      const usable = listed.value.find((item) => item.state !== "withdrawn") ??
        listed.value[0];
      return {
        ok: true,
        value: usable === undefined ? null : {
          id: usable.id,
          state: usable.state,
          revision: usable.revision,
        },
      };
    },

    async sessions(agent) {
      const listed = await pages<
        SessionValue,
        Page & {
          sessions: SessionValue[];
        }
      >(
        core,
        "sessions",
        "list",
        { assignment: agent },
        (value) => value.sessions,
      );
      return listed.ok
        ? { ok: true, value: listed.value.map(sessionOf) }
        : listed;
    },

    async messages(session) {
      const listed = await pages<
        MessageValue,
        Page & {
          messages: MessageValue[];
        }
      >(
        core,
        "messages",
        "list",
        { session },
        (value) => value.messages,
      );
      if (!listed.ok) return listed;
      return {
        ok: true,
        value: listed.value.map(({ message }): MessageRow => ({
          id: message.id,
          actor: actorOf(message.actor),
          body: message.body,
          run: message.run,
          mode: message.mode,
          applied: message.applied_at_call !== null,
          results: resultsOf(message.links),
        })),
      };
    },

    async runs(agent) {
      const listed = await pages<RunValue, Page & { runs: RunValue[] }>(
        core,
        "runs",
        "list",
        { assignment: agent },
        (value) => value.runs,
      );
      if (!listed.ok) return listed;
      return {
        ok: true,
        value: listed.value.map((run): RunRow => ({
          id: run.id,
          session: run.session,
          state: run.state,
          outcome: run.outcome?.kind ?? null,
          stateSeq: run.state_seq,
          acceptedSeq: run.accepted_seq,
        })),
      };
    },

    async openSession({ id, agent, workPlace }) {
      const opened = await command<SessionValue>(core, "sessions", "open", {
        input: {
          id,
          assignment: agent.id,
          role: "lophn",
          work_place: workPlace,
          continued_from: null,
        },
        compare: {
          assignment_revision: agent.revision,
          assignment_state: agent.state,
        },
        key: `sessions-open-${id}`,
      });
      return opened.ok ? { ok: true, value: sessionOf(opened.value) } : opened;
    },

    async send(input) {
      const sent = await command<unknown>(core, "messages", "receive", {
        input: {
          id: input.id,
          session: input.session.id,
          content: input.content,
          mode: input.mode,
          ...(input.run === null ? {} : { run: input.run }),
        },
        compare: {
          session_state: "open",
          session_state_seq: input.session.stateSeq,
          assignment_revision: input.agent.revision,
          assignment_state: input.agent.state,
        },
        key: input.key,
      });
      return sent.ok ? { ok: true, value: undefined } : sent;
    },

    async body(message) {
      const read = await call<BodyValue>(core, "read", "messages", "body", {
        message,
      });
      return read.ok
        ? { ok: true, value: read.value.content.parts.map(partOf) }
        : read;
    },

    async stop(run, key) {
      const stopped = await command<unknown>(core, "runs", "stop", {
        input: { run: run.id, request_key: key, reason: "user_stopped" },
        compare: { state_seq: run.stateSeq },
        key,
      });
      return stopped.ok ? { ok: true, value: undefined } : stopped;
    },

    async documentTitle(document) {
      const read = await call<{ document: { title: string } }>(
        core,
        "read",
        "documents",
        "get",
        { document },
      );
      return read.ok ? { ok: true, value: read.value.document.title } : read;
    },
  };
}
