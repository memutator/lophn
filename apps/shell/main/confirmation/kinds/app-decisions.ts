// app-detail의 참조 intent를 user 자격으로 approval에 고정한다. renderer가 보낸 scope·입력은
// 받지 않고 현재 release 선언을 독립 read한다. 같은 창의 재조회는 같은 request를 읽는다.
import { contentBasis } from "../handle.ts";
import type { ConfirmationIntent } from "../types.ts";
import { readApproval } from "./approval.ts";
import {
  failed,
  type KindCore,
  type Read,
  readFailure,
  record,
  sendCommand,
  type Sent,
} from "./core.ts";
import { newRevertId } from "./revert.ts";

type Intent = Extract<ConfirmationIntent, { kind: "owner_decision" }>;
type Fixed = { approval: string; action: Record<string, unknown> };
type Bound = { ok: true; value: Fixed } | ReturnType<typeof failed>;

export function appDecisions(
  now: () => number,
  random: (bytes: Uint8Array) => Uint8Array,
) {
  const windows = new Map<string, Promise<Bound>>();
  const owned = new Map<string, Fixed>();
  async function prepare(core: KindCore, intent: Intent): Promise<Bound> {
    const targets = intent.targets ?? [];
    const missing = () => failed("not_found", "이 결정을 찾지 못했다");
    const first = targets[0];
    if (first === undefined) return missing();
    const approval = newRevertId(now(), random).replace("rvt_", "apr_");
    let concern = "apps/permissions";
    let command = "grant.create";
    let actionTargets: string[];
    let value: Record<string, unknown>;
    let comparison: Record<string, unknown>;
    if (
      intent.concern === "apps/releases" &&
      intent.decision === "start_activation" && targets.length === 1
    ) {
      const got = await core.internal("read", "releases", "get", {
        release: first,
      });
      if (!got.ok) return readFailure(got);
      const release = record(record(got.value).release);
      if (release.id !== first || typeof release.app !== "string") {
        return missing();
      }
      const app = await core.internal("read", "apps", "get", {
        app: release.app,
      });
      if (!app.ok) return readFailure(app);
      const previous = record(record(app.value).app).active_release ?? null;
      let schema = 0;
      if (previous !== null) {
        const active = await core.internal("read", "releases", "get", {
          release: previous,
        });
        if (!active.ok) return readFailure(active);
        schema = Number(record(record(active.value).release).data_schema);
      }
      const grants = await core.internal("read", "grants", "list", {
        app: release.app,
      });
      if (!grants.ok) return readFailure(grants);
      const seq = record(grants.value).grants_seq;
      if (typeof seq !== "string") {
        return failed("unavailable", "grant 비교 기준을 읽지 못했다");
      }
      concern = "apps/releases";
      command = "release.start_activation";
      actionTargets = [first];
      value = {
        release: first,
        approval,
        previous_release: previous,
        expected_grants_seq: Number(seq),
        expected_schema: schema,
        key: approval,
      };
      comparison = {};
    } else {
      const app = first;
      const listed = await core.internal("read", "grants", "list", {
        app,
        limit: 200,
      });
      if (!listed.ok) return readFailure(listed);
      const grants = record(listed.value);
      if (typeof grants.grants_seq !== "string") {
        return failed("unavailable", "grant 비교 기준을 읽지 못했다");
      }
      comparison = { grants_seq: grants.grants_seq };
      if (
        intent.concern === "apps/permissions" &&
        intent.decision === "revoke_grant" && targets.length === 2
      ) {
        const grant = (Array.isArray(grants.grants) ? grants.grants : []).map(
          record,
        ).find((item) =>
          item.id === targets[1] && item.app === app && item.status === "active"
        );
        if (grant === undefined) return missing();
        command = "grant.revoke";
        actionTargets = [grant.id as string];
        value = {
          app,
          grant: targets[1],
          process_nonce: null,
          termination_confirmed: null,
        };
      } else {
        const got = await core.internal("read", "apps", "blueprint", { app });
        if (!got.ok) return readFailure(got);
        const declared = record(record(got.value).declarations);
        let scope: Record<string, unknown>;
        if (
          intent.concern === "apps/automations" &&
          intent.decision === "enable_automation" && targets.length === 1
        ) {
          const entry =
            (Array.isArray(declared.automations) ? declared.automations : [])
              .map(record).find((item) =>
                item.key === intent.automation && item.external === true
              );
          if (entry === undefined) return missing();
          scope = {
            kind: "automation.run",
            automation: entry.key,
            command: entry.command,
            input_hash: entry.input_hash,
            when: entry.when,
          };
        } else if (
          intent.concern === "apps/connections" &&
          intent.decision === "connect_apps" && targets.length === 2
        ) {
          const entry = (Array.isArray(declared.app_connections)
            ? declared.app_connections
            : []).map(record).find((item) =>
              item.app === targets[1]
            );
          if (
            entry === undefined || !Array.isArray(entry.commands) ||
            entry.commands.length === 0
          ) return missing();
          const target = await core.internal("read", "apps", "get", {
            app: targets[1],
          });
          if (!target.ok) return readFailure(target);
          scope = {
            kind: "app.call",
            app: targets[1],
            commands: [...entry.commands].sort(),
          };
        } else if (
          intent.concern === "apps/permissions" &&
          intent.decision === "grant_access" && targets.length === 1 &&
          intent.requirement !== undefined
        ) {
          const requirements = Array.isArray(declared.permissions)
            ? declared.permissions
            : [];
          const entry = record(requirements[intent.requirement]);
          if (typeof entry.kind !== "string") return missing();
          scope = { ...record(entry.scope), kind: entry.kind };
        } else return missing();
        actionTargets = [app];
        value = { app, kind: scope.kind, scope, approval };
      }
    }
    const basis = {
      concern,
      command,
      caller: "user",
      targets: actionTargets,
      input_hash: contentBasis(value),
      comparison,
    };
    const action = {
      ...basis,
      input: { kind: "inline", value },
      binding_hash: contentBasis(basis),
    };
    const created = await core.internal("command", "approvals", "create", {
      input: {
        id: approval,
        requester: "user",
        run: null,
        reason: "앱 상세에서 요청한 변경",
        effect: {
          changes: "선택한 앱의 정확한 대상과 범위를 변경한다",
          external: null,
          reversible: command !== "release.start_activation",
          reversibility: "회수한 허락은 다시 허락해야 한다",
        },
        action,
        expires_at: null,
      },
      idempotency_key: `app-detail:${approval}`,
      prepared: [],
    });
    if (!created.ok) return readFailure(created);
    const fixed = { approval, action };
    owned.set(approval, fixed);
    return { ok: true, value: fixed };
  }
  return {
    async read(core: KindCore, intent: Intent, window: string): Promise<Read> {
      let pending = windows.get(window);
      if (pending === undefined) {
        pending = prepare(core, intent);
        windows.set(window, pending);
      }
      const fixed = await pending;
      return fixed.ok ? readApproval(core, fixed.value.approval) : fixed;
    },
    async apply(core: KindCore, approval: string): Promise<Sent | null> {
      const fixed = owned.get(approval);
      if (fixed === undefined) return null;
      const applied = await sendCommand(core, "approvals", "apply", {
        input: {
          approval,
          action: fixed.action,
          idempotency_key: `app-detail-apply:${approval}`,
        },
        idempotency_key: `app-detail-apply:${approval}`,
        prepared: [],
      });
      if (!applied.ok) return applied;
      return {
        ok: true,
        value: {
          receipt: { kind: "entity", id: approval },
          result: fixed.action.command === "release.start_activation"
            ? "applying"
            : "applied",
        },
      };
    },
    forget(window: string) {
      windows.delete(window);
    },
  };
}
