// The computer's coding agents (Claude Code, Codex, ...) on the phone. The list (`useCodingSessions`, in hooks.tsx) and the actions are the core's
// `coding_sessions/*` routes (and `acp/send` for a new session's first message); a chat-view session's conversation goes through the core's ACP routes
// (`acp/snapshot`, `acp/send`, `AcpUpdated`), and is shown by the desktop's harness GUI source
// (`guiAgentTabSource`) fed by the phone instead of by the app's IPC. What the session can do (rewind, images, ...) is
// told by `session.capabilities` in the ACP state, the same as on the desktop. Tool bodies and pictures are read from the computer when shown.
import {
  acpSend,
  acpSnapshot,
  acpToolBodyRead,
  EMPTY_ACP_STATE,
  reduceAcp,
  type AcpState,
  type AcpUpdate,
} from "../../../protocol/acp/mod.ts";
import {
  codingSessionsOpen,
  codingSessionsSwitch,
  codingSessionsSwitchPlan,
  type SwitchStops,
} from "../../../protocol/coding-agent/relay.ts";
import { isGuiHarness } from "../../../protocol/extensions/mod.ts";
import { textBlocks } from "../../../protocol/lophn-agent/content-block.ts";
import { lophnIdOf } from "../../../protocol/lophn-agent/workspaces.ts";
import { guiAgentTabSource } from "../../../shell/renderer/conversation/agent-tab-gui-source.ts";
import {
  createEnv,
  createGate,
  type Env,
} from "../../../shell/renderer/conversation/agent-tab-core-source-env.ts";
import type {
  AgentTabSource,
  SourceResult,
} from "../../../shell/renderer/conversation/agent-tab-source.ts";
import type {
  EventClient,
  EventMessage,
} from "../../../shell/renderer/desktop/connection/events/client.ts";
import { newId } from "../../../shell/renderer/prefixed-id.ts";
import { ask, type Asked } from "./ask.ts";
import { codingImages } from "./attach.ts";
import { openTerminal } from "./terminal.ts";

/** A coding session to open a conversation with (a row of `useCodingSessions`: its id, harness, project and folder). */
export interface CodingTarget {
  readonly session: string;
  readonly coding: {
    readonly harness: string;
    readonly project: string;
    readonly cwd: string | null;
  };
}

// ---- the conversation

interface Feed {
  readonly session: string;
  state(): AcpState;
  changed(listener: () => void): () => void;
  /** The result of the latest snapshot read; waits for the first one after the screen attaches. */
  loaded(): Promise<SourceResult<void>>;
}

/**
 * The state of one coding session's conversation: the core's snapshot with the updates since folded in. It listens only
 * while a screen listens to `changed`. A snapshot is read when the watch is ready (first time and after every
 * reconnect) and when the core replaced its copy (`StateChanged{coding_sessions}` for this session); updates that arrive
 * while a snapshot is on its way are folded after it.
 */
export function codingFeed(
  client: EventClient,
  env: Env,
  session: string,
): Feed {
  let state = EMPTY_ACP_STATE;
  let last: SourceResult<void> | null = null;
  let waiting: (() => void)[] = [];
  let buffer: AcpUpdate[] | null = null;
  let reads = 0;
  let stop: (() => void) | null = null;
  const listeners = new Set<() => void>();

  async function load() {
    const mine = ++reads;
    buffer = [];
    const read = await env.read(acpSnapshot, { session });
    if (mine !== reads) return;
    const updates = buffer;
    buffer = null;
    if (read.ok) state = updates.reduce(reduceAcp, read.value);
    last = read.ok ? { ok: true, value: undefined } : read;
    for (const wake of waiting) wake();
    waiting = [];
    if (read.ok) for (const listener of [...listeners]) listener();
  }

  function onAcp(message: EventMessage) {
    if (message.kind === "ready") void load();
    else if (message.kind === "event" && message.event.type === "AcpUpdated") {
      const { update } = message.event.payload;
      if (buffer === null) state = reduceAcp(state, update);
      else buffer.push(update);
    }
  }

  function onChanges(message: EventMessage) {
    if (
      message.kind === "event" &&
      message.event.type === "StateChanged" &&
      message.event.payload.changes.some(
        (change) => change.name === "coding_sessions" && change.id === session,
      )
    ) {
      void load();
    }
  }

  return {
    session,
    state: () => state,
    changed(listener) {
      listeners.add(listener);
      if (stop === null) {
        const offAcp = client.subscribe(
          { session, types: ["AcpUpdated"] },
          onAcp,
        );
        const offChanges = client.subscribe(
          { types: ["StateChanged"] },
          onChanges,
        );
        stop = () => {
          offAcp();
          offChanges();
        };
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        stop?.();
        stop = null;
        reads += 1;
        last = null;
      };
    },
    async loaded() {
      while (last === null) await new Promise<void>((r) => waiting.push(r));
      return last;
    },
  };
}

/**
 * The desktop's harness GUI source over the core's relay. Everything the desktop gets from the app's IPC that the phone
 * cannot (past CLI sessions, rewind preview) answers unavailable, so the screen hides it by capability.
 */
function codingSource(
  client: EventClient,
  env: Env,
  { session, coding }: CodingTarget,
): AgentTabSource {
  if (!isGuiHarness(coding.harness)) {
    return new Proxy({} as AgentTabSource, {
      get: (_target, key) =>
        key === "changed" || key === "draft"
          ? undefined
          : () => Promise.resolve({ ok: false, code: "not_found" }),
    });
  }
  const feed = codingFeed(client, env, session);
  const images = codingImages(client.core, session);
  const gui = guiAgentTabSource({
    info: { harness: coding.harness, cwd: coding.cwd ?? "" },
    feed,
    input: async (input) => (await env.read(acpSend, input)).ok,
    toolBody: (toolCall, part) => env.read(acpToolBodyRead, { session, tool_call: toolCall, part }),
    sessions: () => Promise.resolve([]),
    rewindPreview: () => Promise.resolve(null),
    writeImage: images.writeImage,
  });
  return {
    ...gui,
    imageUrl: (_session, id) => images.imageUrl(id),
    acp: async (id) => {
      const read = await feed.loaded();
      return read.ok ? gui.acp(id) : read;
    },
  };
}

// ---- the list and the actions

// How long a new session's CLI may take to start on the computer before the phone stops waiting for its chat.
const STANDING_MS = 60_000;

/**
 * Whether the core has the session's chat (its GUI handle stood) within `STANDING_MS`: `coding_sessions/open` answers
 * when the CLI is typed into a new terminal, and the handle stands later, which the core says with
 * `StateChanged{coding_sessions}`. The chat is read again on each such change.
 */
function standing(client: EventClient, env: Env, session: string): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (stood: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      resolve(stood);
    };
    const check = async () => {
      if ((await env.read(acpSnapshot, { session })).ok) finish(true);
    };
    const off = client.subscribe({ types: ["StateChanged"] }, (message) => {
      if (
        message.kind === "ready" ||
        (message.kind === "event" &&
          message.event.type === "StateChanged" &&
          message.event.payload.changes.some(
            (change) => change.name === "coding_sessions" && (change.id === session || change.id === null),
          ))
      ) {
        void check();
      }
    });
    const timer = setTimeout(() => finish(false), STANDING_MS);
  });
}

/** A coding route's answer. A refusal carries the sentence the computer gave, to show as it is (`open`: "Open the project on the computer"). */
export type CodingResult<T> = Asked<T>;

export interface CodingActions {
  /** What switching the session's view would stop and whether it is blocked. Ask before `switchView`. */
  switchPlan(
    session: string,
  ): Promise<SourceResult<{
    to: "gui" | "tui";
    stops: { turn: boolean; tasks: number; queued: number };
    blocked: "no_session" | "not_running" | "unsupported_os" | null;
  }>>;
  /** Only after the person confirmed what `switchPlan` showed: the core refuses a switch without it. */
  switchView(
    session: string,
    to: "gui" | "tui",
    stops?: SwitchStops,
  ): Promise<SourceResult<void>>;
  /**
   * A new chat-view coding session in a new terminal on the computer, or one that resumes a harness agent session.
   * Answers once its chat stands on the computer (`standing`), so the first message can go to it at once.
   */
  open(input: {
    project: string;
    harness: string;
    resume?: { session: string };
  }): Promise<CodingResult<{ session: string }>>;
  /** Sends a message to a coding session `open` gave, before any screen reads its conversation (the new session's first message). */
  send(session: string, message: { id: string; key: string; text: string }): Promise<SourceResult<void>>;
  /** A new terminal running a shell in the project's folder on the computer; gives its terminal (`openTerminal`). */
  openTerminal(project: string): Promise<CodingResult<string>>;
}

export interface Coding extends CodingActions {
  source(target: CodingTarget): AgentTabSource;
}

/** One computer's coding sessions: the conversation sources and the actions, over its event client. */
export function codingOf(client: EventClient): Coding {
  const env = createEnv(
    client.core,
    { assignment: lophnIdOf(null), workspace: { kind: "global", id: "" } },
    Date.now,
    createGate(),
  );
  return {
    source: (target) => codingSource(client, env, target),
    switchPlan: (session) => env.read(codingSessionsSwitchPlan, { session }),
    async switchView(session, to, stops) {
      const done = await env.read(codingSessionsSwitch, {
        session,
        to,
        confirmed: true,
        key: newId("switch"),
        ...(stops === undefined ? {} : { stops }),
      });
      return done.ok ? { ok: true, value: undefined } : done;
    },
    async open({ project, harness, resume }) {
      const opened = await ask(client.core, codingSessionsOpen, {
        project,
        harness,
        ...(resume === undefined ? {} : { resume }),
        key: newId("open"),
      });
      if (!opened.ok || (await standing(client, env, opened.value.session))) return opened;
      return { ok: false, code: "unavailable" };
    },
    async send(session, { id, key, text }) {
      const sent = await env.read(acpSend, {
        type: "send",
        session,
        id,
        key,
        content: textBlocks(text),
        delivery: "next_turn",
      });
      return sent.ok ? { ok: true, value: undefined } : sent;
    },
    openTerminal: (project) => openTerminal(client, project),
  };
}
