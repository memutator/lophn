// OperatorSource를 core 통로로 만든다. 응답은 main의 contract client가 route output schema로 이미
// 검사했다. 붙이기·바꾸기는 사람이 고른 구성 전체를 승인 요청(`approvals/create`)으로 고정하고
// 보호 확인 창(`approval_request` 종류)을 연다. 허락은 창에서 handle로만 하고, 이 통로는 허락된
// 요청을 적용(`approvals/apply`)하기만 한다. 사람의 허락을 대신하는 길은 없다.
import type { CoreSource } from "../../../connection/connection.ts";
import { newId } from "../../model.ts";
import { call, command, type Page, pages } from "../core-calls.ts";
import type { DecisionIntent, PresetValue } from "../core-source.ts";
import type { PresetEntry } from "../source.ts";
import { fingerprint } from "./canonical.ts";
import type {
  OperatorDraft,
  OperatorSource,
  OutputChoice,
  Proposed,
  ReadChoice,
  Settled,
} from "./source.ts";

const CONCERN = "lophn-agent/assignments";
const COMMAND = "ApplyOperatorAssignment";
/** 보고 문서 후보를 확인할 최대 개수(문서마다 독점 여부를 읽는다). */
const OUTPUT_CANDIDATES = 60;

interface DocumentEntry {
  document: {
    id: string;
    title: string;
    status: "active" | "archived";
  };
  latest_version: { id: string };
}

interface DocumentGot {
  document: { file_source?: unknown };
  version: { id: string };
}

interface ApprovalValue {
  request: { status: string; action: Record<string, unknown> };
  use: unknown;
}

export interface OperatorDeps {
  openDecision: ((intent: DecisionIntent) => Promise<unknown>) | undefined;
  now: () => number;
  random: () => string;
  presetOf: (value: PresetValue) => PresetEntry;
}

const REASON = "Attached from the roles screen.";
const EFFECT = {
  changes:
    "Attaches or changes an Operator exactly as shown: its Preset version, where it works, the documents it reports to, the apps it may read, and its Repeating check.",
  external: null,
  reversible: true,
  reversibility: "You can pause, resume, or withdraw the Operator at any time.",
};

// 보호 창의 부모. main은 이 값이 아니라 IPC를 보낸 창을 부모로 쓴다(contracts#T13).
const PARENT_WINDOW = "requesting-window";

export function coreOperatorSource(
  core: CoreSource,
  deps: OperatorDeps,
): OperatorSource {
  return {
    async presets() {
      const listed = await pages<
        PresetValue,
        Page & { presets: PresetValue[] }
      >(
        core,
        "presets",
        "list",
        { kind: "operator" },
        (value) => value.presets,
      );
      return listed.ok
        ? { ok: true, value: listed.value.map(deps.presetOf) }
        : listed;
    },

    async outputChoices(scope) {
      const listed = await pages<
        DocumentEntry,
        Page & { documents: DocumentEntry[] }
      >(
        core,
        "documents",
        "list",
        { place: { kind: scope.kind, id: scope.id }, status: "active" },
        (value) => value.documents,
      );
      if (!listed.ok) return listed;
      const found: OutputChoice[] = [];
      // 원본 파일 연결 문서는 출력이 될 수 없고, 이미 다른 Operator가 쓰는 문서는 하나만 소유한다.
      for (const entry of listed.value.slice(0, OUTPUT_CANDIDATES)) {
        const got = await call<DocumentGot>(core, "read", "documents", "get", {
          document: entry.document.id,
        });
        if (!got.ok) return got;
        if (got.value.document.file_source != null) continue;
        const owner = await call<{
          output: { state: "enabled" | "paused" | "withdrawn" } | null;
        }>(core, "read", "assignments", "outputs", {
          document: entry.document.id,
        });
        if (!owner.ok) return owner;
        if (owner.value.output !== null) {
          if (owner.value.output.state !== "withdrawn") continue;
        }
        found.push({
          id: entry.document.id,
          title: entry.document.title,
          version: entry.latest_version.id,
        });
      }
      return { ok: true, value: found };
    },

    async versionOf(document) {
      const got = await call<DocumentGot>(core, "read", "documents", "get", {
        document,
      });
      return got.ok ? { ok: true, value: got.value.version.id } : got;
    },

    async readChoices(app) {
      const read = await call<{
        commands: {
          key: string;
          label: string;
          effect: "read" | "write" | "external";
          confirm: boolean;
        }[];
      }>(core, "read", "apps", "blueprint", { app });
      if (!read.ok) return read;
      return {
        ok: true,
        value: read.value.commands
          .filter((item) => item.effect === "read" && !item.confirm)
          .map((item): ReadChoice => ({
            app,
            command: item.key,
            label: item.label,
          })),
      };
    },

    async propose(draft: OperatorDraft) {
      if (deps.openDecision === undefined) {
        return { ok: false, code: "unavailable" };
      }
      const hash = draft.preset.hash;
      const first = draft.outputs[0];
      if (hash === undefined || first === undefined) {
        return { ok: false, code: "invalid_input" };
      }
      const now = deps.now();
      const assignment = draft.change?.id ?? newId("asg", now);
      const approval = newId("apr", now);
      const apps = [...new Set(draft.reads.map((read) => read.app))];
      const bundle = {
        // 사람이 직접 정한 구성이라 검토한 초안의 고정 판은 첫 보고 문서의 지금 판이다.
        draft_version: first.version,
        assignment: draft.change === null ? null : assignment,
        expected_assignment_revision: draft.change?.revision ?? null,
        preset: draft.preset.id,
        preset_revision: draft.preset.revision,
        preset_definition: hash,
        scope: { kind: draft.scope.kind, id: draft.scope.id },
        outputs: draft.outputs.map((output) => ({
          document: output.document,
          content: output.content,
        })),
        read_apps: apps,
        read_commands: draft.reads.map((read) => ({
          app: read.app,
          command: read.command,
        })),
        schedule: {
          first_at: draft.period.firstAt,
          every_ms: draft.period.everyMs,
        },
        reason: REASON,
      };
      // 허락이 확정한 결정 seq(lophn-agent#T53)는 적용 전에는 알 수 없는 값이라
      // 생략한다. apply handler가 승인 기록의 결정 seq로 맞춘다.
      const value = {
        approval,
        id: assignment,
        bundle,
      };
      const basis = {
        concern: CONCERN,
        command: COMMAND,
        caller: "user",
        targets: [assignment],
        input_hash: await fingerprint(value),
        comparison: {},
      };
      const action = {
        ...basis,
        input: { kind: "inline", value },
        binding_hash: await fingerprint(basis),
      };
      const created = await command(core, "approvals", "create", {
        input: {
          id: approval,
          requester: "user",
          run: null,
          reason: REASON,
          effect: EFFECT,
          action,
          expires_at: null,
        },
        key: `operator-approval-${approval}`,
      });
      if (!created.ok) return created;
      try {
        const opened = await deps.openDecision({
          request: { kind: "approval_request", approval },
          parentWindow: PARENT_WINDOW,
        }) as { windowId?: string; code?: string };
        if (typeof opened?.windowId !== "string") {
          // 창이 열리지 않으면 아무도 결정할 수 없는 요청이 남지 않게 취소한다.
          await cancel(core, approval, created.value);
          return { ok: false, code: opened?.code ?? "internal" };
        }
      } catch {
        await cancel(core, approval, created.value);
        return { ok: false, code: "unavailable" };
      }
      return { ok: true, value: { approval, assignment } };
    },

    async settle(proposed: Proposed): Promise<
      | { ok: true; value: Settled }
      | { ok: false; code: string }
    > {
      const read = await call<ApprovalValue>(
        core,
        "read",
        "approvals",
        "get",
        { approval: proposed.approval },
      );
      if (!read.ok) return read;
      const status = read.value.request.status;
      if (status === "pending") return { ok: true, value: "waiting" };
      if (status !== "granted") return { ok: true, value: "declined" };
      if (read.value.use !== null) return { ok: true, value: "attached" };
      const applied = await command(core, "approvals", "apply", {
        input: {
          approval: proposed.approval,
          action: read.value.request.action,
          idempotency_key: `operator-apply-${proposed.approval}`,
        },
        key: `operator-apply-${proposed.approval}`,
      });
      return applied.ok ? { ok: true, value: "attached" } : applied;
    },

    async pause(role) {
      const sent = await command(core, "assignments", "pause", {
        input: {
          assignment: role.id,
          reason: {
            kind: "user",
            detail: "Paused by you.",
            runs: [],
            target: null,
          },
        },
        compare: { revision: role.revision, state: "enabled" },
        key: `assignments-pause-${role.id}-${role.revision}`,
      });
      return sent.ok ? { ok: true, value: null } : sent;
    },

    async withdraw(role) {
      if (role.state === "withdrawn") return { ok: false, code: "conflict" };
      const sent = await command(core, "assignments", "withdraw", {
        input: { assignment: role.id },
        compare: { revision: role.revision, state: role.state },
        key: `assignments-withdraw-${role.id}-${role.revision}`,
      });
      return sent.ok ? { ok: true, value: null } : sent;
    },
  };
}

async function cancel(
  core: CoreSource,
  approval: string,
  created: unknown,
): Promise<void> {
  const seq = (created as { request?: { created_seq?: string } }).request
    ?.created_seq;
  if (seq === undefined) return;
  await command(core, "approvals", "cancel", {
    input: { approval, created_seq: seq, closed_reason: null },
    compare: { created_seq: seq },
    key: `operator-approval-cancel-${approval}`,
  });
}
