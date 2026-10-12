// 앱 결정 네 종류: release activation, 접근·앱 쌍 grant, confirm command, automation 켜기.
// 넷 다 platform approval request로 온다(고정 concern·command). 요청이 싣고 온 정확한 동작(대상·입력·
// 비교 기준)은 approvals/get의 값 그대로이고, 그 위에 사람이 읽을 사실은 apps read를 독립으로
// 다시 읽어 만든다. 요청자가 쓴 글은 이 사실을 바꾸지 못한다. 하나라도 못 읽거나 요청과 지금 apps의
// 사실이 어긋나면 일부만 보이지 않고 읽기 실패다.
// 결정 제출·binding은 approval 종류와 같다(approval.ts). 여기는 표시 값만 만든다.
import { canonicalize } from "../canonical.ts";
import { failed, type KindCore, readFailure, record, text } from "./core.ts";

export type AppsView =
  | { ok: true; view: Record<string, unknown> | null }
  | { ok: false; error: { code: string; message: string } };

const RELEASES = "apps/releases";
const PERMISSIONS = "apps/permissions";
const INVOCATIONS = "apps/invocations";

type Action = {
  concern: string;
  command: string;
  targets: string[];
  value: Record<string, unknown> | null;
};

type Found = { ok: true; value: Record<string, unknown> } | {
  ok: false;
  error: { code: string; message: string };
};

const MOVED = failed("conflict", "앱의 지금 사실이 이 요청과 다르다");

function same(a: unknown, b: unknown): boolean {
  return canonicalize(a ?? null) === canonicalize(b ?? null);
}

async function read(
  core: KindCore,
  resource: string,
  method: string,
  body: Record<string, unknown>,
): Promise<Found> {
  const got = await core.internal("read", resource, method, body);
  return got.ok ? { ok: true, value: record(got.value) } : readFailure(got);
}

/** 앱 이름. 읽지 못해도 결정 표시는 막지 않는다(이름은 식별 보조이고 정확한 ID는 따로 보인다). */
async function nameOf(core: KindCore, app: unknown): Promise<string | null> {
  if (typeof app !== "string") return null;
  const got = await read(core, "apps", "get", { app });
  return got.ok ? text(record(got.value.app).name) : null;
}

/** 앱 결정이 아니면 null view다. 앱 결정인데 입력이 접수 모양이 아니면 읽기 실패다. */
export async function readAppsView(
  core: KindCore,
  action: Record<string, unknown>,
  base: Record<string, unknown>,
): Promise<AppsView> {
  const input = record(action.input);
  const parsed: Action = {
    concern: String(action.concern),
    command: String(action.command),
    targets: Array.isArray(action.targets) ? action.targets.map(String) : [],
    value: input.kind === "inline" ? record(input.value) : null,
  };
  const which = classify(parsed);
  if (which === null) return { ok: true, view: null };
  if (parsed.value === null) {
    return failed("invalid_input", "입력 모양이 다르다");
  }
  const made = which === "release"
    ? await releaseActivation(core, parsed, parsed.value)
    : which === "grant"
    ? await grant(core, parsed, parsed.value)
    : which === "automation"
    ? await automation(core, parsed, parsed.value)
    : await confirmCommand(core, parsed, parsed.value);
  if (!made.ok) return made;
  return { ok: true, view: { ...base, ...made.value } };
}

function classify(
  action: Action,
): "release" | "grant" | "automation" | "confirm" | null {
  if (
    action.concern === RELEASES && action.command === "release.start_activation"
  ) return "release";
  if (action.concern === PERMISSIONS && action.command === "grant.revoke") {
    return "grant";
  }
  if (action.concern === PERMISSIONS && action.command === "grant.create") {
    return record(record(action.value).scope).kind === "automation.run"
      ? "automation"
      : "grant";
  }
  if (
    action.concern === INVOCATIONS &&
    action.command === "invocation.accept_confirm"
  ) return "confirm";
  return null;
}

async function releaseActivation(
  core: KindCore,
  action: Action,
  value: Record<string, unknown>,
): Promise<Found> {
  const release = value.release;
  if (typeof release !== "string" || action.targets[0] !== release) {
    return MOVED;
  }
  const previous = typeof value.previous_release === "string"
    ? value.previous_release
    : null;
  const got = await read(core, "releases", "get", { release });
  if (!got.ok) return got;
  const found = record(got.value.release);
  if (found.id !== release) return MOVED;
  const compared = await read(core, "releases", "compare", {
    release,
    ...(previous === null ? {} : { previous_release: previous }),
  });
  if (!compared.ok) return compared;
  const comparison = record(compared.value.comparison);
  if ((comparison.previous_release ?? null) !== previous) return MOVED;
  // 안전 preview는 apps/preview의 읽기 결과로만 말한다. 시작하지 않고 없으면 없다고 둔다.
  const preview = await read(core, "previews", "get", { app: found.app });
  const watched = preview.ok ? record(preview.value.observation) : {};
  return {
    ok: true,
    value: {
      kind: "release_activation",
      app: { id: found.app, name: await nameOf(core, found.app) },
      version: {
        number: found.number,
        data_schema: found.data_schema,
        status: found.status,
      },
      compare: comparison,
      preview:
        watched.ready === true && watched.bundle_hash === found.bundle_hash
          ? { ready: true }
          : null,
    },
  };
}

function scopeOf(value: Record<string, unknown>): Record<string, unknown> {
  const { kind: _kind, ...scope } = record(value.scope);
  return scope;
}

async function grant(
  core: KindCore,
  action: Action,
  value: Record<string, unknown>,
): Promise<Found> {
  if (action.command === "grant.revoke") {
    const listed = await read(core, "grants", "list", {
      ...(typeof value.app === "string" ? { app: value.app } : {}),
      limit: 200,
    });
    if (!listed.ok) return listed;
    const found =
      (Array.isArray(listed.value.grants) ? listed.value.grants : []).map(
        record,
      ).find((item) => item.id === value.grant && item.status === "active");
    if (found === undefined || action.targets[0] !== value.grant) return MOVED;
    const shown = await grant(core, {
      ...action,
      command: "grant.create",
      targets: [String(found.app)],
    }, found);
    return shown.ok
      ? { ok: true, value: { ...shown.value, operation: "revoke" } }
      : shown;
  }
  const app = value.app;
  const kind = value.kind;
  if (
    typeof app !== "string" || typeof kind !== "string" ||
    action.targets[0] !== app || record(value.scope).kind !== kind
  ) return MOVED;
  const listed = await read(core, "grants", "list", { app });
  if (!listed.ok) return listed;
  // 경고와 한계는 apps가 준 자료만 쓴다. 그 자료가 없으면 경고를 빼고 보이지 않는다.
  const display = listed.value.display;
  if (display === null || display === undefined) {
    return failed("unavailable", "접근 경고 자료를 읽지 못했다");
  }
  const shown = record(display);
  const scope = scopeOf(value);
  const asked = (Array.isArray(shown.requirements) ? shown.requirements : [])
    .map(record).find((item) => item.kind === kind && same(item.scope, scope));
  const combos =
    (Array.isArray(shown.combination_warnings)
      ? shown.combination_warnings
      : []).map(record).filter((item) =>
        Array.isArray(item.kinds) && item.kinds.includes(kind)
      );
  const target = kind === "app.call" ? scope.app : undefined;
  return {
    ok: true,
    value: {
      kind: "grant",
      app: { id: app, name: await nameOf(core, app) },
      access: { kind, scope },
      target_app: target === undefined
        ? null
        : { id: target, name: await nameOf(core, target) },
      requirement: asked === undefined ? null : {
        reason: text(asked.reason),
        granted: asked.granted === true,
        warnings: Array.isArray(asked.warnings) ? asked.warnings : [],
        outside_links: Array.isArray(asked.outside_links)
          ? asked.outside_links
          : [],
      },
      combination_warnings: combos.map((item) => item.key),
      limit_keys: Array.isArray(shown.limit_keys) ? shown.limit_keys : [],
    },
  };
}

async function automation(
  core: KindCore,
  action: Action,
  value: Record<string, unknown>,
): Promise<Found> {
  const app = value.app;
  const scope = scopeOf(value);
  if (typeof app !== "string" || action.targets[0] !== app) return MOVED;
  const blueprint = await read(core, "apps", "blueprint", { app });
  if (!blueprint.ok) return blueprint;
  const declared =
    (Array.isArray(record(blueprint.value.declarations).automations)
      ? record(blueprint.value.declarations).automations as unknown[]
      : []).map(record).find((item) => item.key === scope.automation);
  // 승인 범위는 지금 선언과 정확히 같아야 한다(command·고정 입력·주기).
  if (
    declared === undefined || declared.command !== scope.command ||
    declared.input_hash !== scope.input_hash || !same(declared.when, scope.when)
  ) return MOVED;
  const label =
    (Array.isArray(blueprint.value.automations)
      ? blueprint.value.automations
      : []).map(record).find((item) => item.key === scope.automation);
  const command =
    (Array.isArray(blueprint.value.commands) ? blueprint.value.commands : [])
      .map(record).find((item) => item.key === scope.command);
  if (command === undefined) return MOVED;
  const observed = await read(core, "apps", "automations", { app });
  if (!observed.ok) return observed;
  const state =
    (Array.isArray(observed.value.automations)
      ? observed.value.automations
      : []).map(record).find((item) => item.key === scope.automation);
  return {
    ok: true,
    value: {
      kind: "automation",
      app: { id: app, name: await nameOf(core, app) },
      automation: {
        key: scope.automation,
        label: text(label?.label),
        when: scope.when,
        input_hash: scope.input_hash,
        external: declared.external === true,
        runnable: state === undefined ? null : state.runnable === true,
        reason: text(state?.reason),
      },
      app_command: commandOf(command),
    },
  };
}

function commandOf(command: Record<string, unknown>): Record<string, unknown> {
  return {
    key: command.key,
    label: text(command.label),
    description: text(command.description),
    effect: text(command.effect),
    confirm: command.confirm === true,
    input: command.input ?? null,
  };
}

async function confirmCommand(
  core: KindCore,
  action: Action,
  value: Record<string, unknown>,
): Promise<Found> {
  const app = value.app;
  if (
    typeof app !== "string" || action.targets[0] !== app ||
    action.targets[1] !== value.release
  ) return MOVED;
  const blueprint = await read(core, "apps", "blueprint", { app });
  if (!blueprint.ok) return blueprint;
  // 확인 요청은 정확한 release의 command다. release가 바뀌었으면 새 요청이 있어야 한다.
  if (blueprint.value.release !== value.release) return MOVED;
  const command =
    (Array.isArray(blueprint.value.commands) ? blueprint.value.commands : [])
      .map(record).find((item) => item.key === value.command);
  if (command === undefined || command.confirm !== true) return MOVED;
  const caller = record(value.caller);
  return {
    ok: true,
    value: {
      kind: "confirm_command",
      app: { id: app, name: await nameOf(core, app) },
      app_command: commandOf(command),
      input_hash: value.input_hash,
      caller: {
        kind: caller.kind,
        app: caller.kind === "app"
          ? { id: caller.app, name: await nameOf(core, caller.app) }
          : null,
      },
    },
  };
}
