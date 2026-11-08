// 전역 lophn 하나를 workspace마다의 lophn(`lophn_home`, `lophn_<prj|app id>`)으로 나누는 wiring이다. 사람의 data root가
// 새 판으로 이어지게 한다. 옛 `lophn` id로 저장된 것은 동작을 그대로 잇도록 옮긴다: workspace가 함께 적힌 것은 그 workspace의
// lophn으로, 여럿에 걸리는 것은 모든 lophn으로 복사한다. 그 뒤 workspace마다 빼는 것은 사람의 일이다.
// - ledger step(schema): sessions·jobs·runs·agent_calls의 agent, share_requests.agents. 낸 뒤에는 고치지 않는다.
// - data step: 전역 `agents/lophn.md`, settings의 call policy `agents` 규칙, secrets의 `mcp.lophn.*`·`mcp-oauth.lophn.*`,
//   shell layout 탭의 agent. data step은 schema migration 뒤에 돈다.
// 옮기지 못하는 것: events·command_results(고치지 못하는 기록)와 그 안의 옛 id.
// 기존 `agents.*`·`approvals.*` data step이 아직 전역 lophn.md를 보므로 assembly.ts의 WIRINGS에서 그보다 뒤다.
import {
  lstat,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import { CALL_POLICY_SETTING_KEY } from "../../../../protocol/lophn-agent/call-policy.ts";
import {
  LOPHN_HOME_ID,
  lophnIdOf,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import type { SchemaStep } from "../../../../protocol/server/mod.ts";
import { appIds } from "../../../apps/lookups.ts";
import { projectIds } from "../../../projects/lookups.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import type { WiringFactory } from "./context.ts";

// workspace 하나의 lophn id를 workspace 칸(NULL이면 Home)에서 정하는 SQL 식이다.
const lophnOf = (workspaceId: string) =>
  `coalesce('lophn_' || ${workspaceId}, '${LOPHN_HOME_ID}')`;

export const lophnSplitSchemaSteps: readonly SchemaStep[] = [
  {
    // 끝난 행을 막는 trigger(session identity, call, run)는 잠시 내렸다 같은 정의로 세운다.
    id: "lophn.split-per-workspace",
    sql: `
drop trigger sessions_identity_immutable;
update sessions set agent = ${lophnOf("workspace_id")} where agent = 'lophn';
create trigger sessions_identity_immutable
before update of id, agent, project, app, workspace_kind, workspace_id,
  forked_from_session, forked_from_through_seq,
  created_seq on sessions
begin
  select raise(abort, 'session identity is immutable');
end;

update jobs set creator_agent = ${lophnOf("creator_workspace")} where creator_agent = 'lophn';
update jobs set action = json_set(action, '$.agent', ${lophnOf("(action ->> '$.agent_workspace.id')")})
where action ->> '$.kind' = 'agent_run' and action ->> '$.agent' = 'lophn';

drop trigger runs_finished_stays;
update runs set
  target = json_set(target, '$.agent.agent', ${lophnOf("(target ->> '$.agent.workspace.id')")}),
  agent_key = ${lophnOf("(target ->> '$.agent.workspace.id')")}
    || coalesce('@' || (target ->> '$.agent.workspace.id'), '')
where kind = 'agent' and target ->> '$.agent.agent' = 'lophn';
create trigger runs_finished_stays BEFORE UPDATE ON runs
WHEN old.state <> 'running'
BEGIN SELECT RAISE(ABORT, 'a finished run does not change'); END;

drop trigger agent_calls_finished_stays;
update agent_calls set "to" = json_set("to", '$.agent.agent', ${lophnOf(`("to" ->> '$.agent.workspace.id')`)})
where "to" ->> '$.agent.agent' = 'lophn';
create trigger agent_calls_finished_stays before update on agent_calls
  when old.state <> 'accepted'
begin
  select raise(abort, 'a finished call does not change');
end;

update share_requests set agents = (
  select json_group_array(value) from (
    select value from json_each(share_requests.agents) where value != 'lophn'
    union all select '${LOPHN_HOME_ID}'
    union all select 'lophn_' || id from projects
    union all select 'lophn_' || id from apps
  )
) where exists (select 1 from json_each(share_requests.agents) where value = 'lophn');`,
  },
];

const OLD = "lophn";
const FENCE = "---";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exists = (path: string) =>
  lstat(path)
    .then(() => true)
    .catch(() => false);

async function readIfThere(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT") return null;
    throw thrown;
  }
}

// 고치는 파일은 원래 mode를 지킨다(settings·secrets는 0600).
async function writeAtomic(path: string, text: string): Promise<void> {
  const mode = (await stat(path)).mode & 0o777;
  await writeFile(`${path}.tmp`, text, { mode });
  await rename(`${path}.tmp`, path);
}

// 규칙의 from·to 가운데 옛 lophn을 모든 lophn으로 늘린다. 순서는 지키고(먼저 적힌 것이 이긴다) 같은 쌍은 한 번만 둔다.
function expandAgentRules(rules: unknown[], lophns: readonly string[]) {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const rule of rules) {
    if (!isRecord(rule) || (rule["from"] !== OLD && rule["to"] !== OLD)) {
      out.push(rule);
      continue;
    }
    for (const from of rule["from"] === OLD ? lophns : [rule["from"]]) {
      for (const to of rule["to"] === OLD ? lophns : [rule["to"]]) {
        const pair = `${String(from)}\n${String(to)}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        out.push({ ...rule, from, to });
      }
    }
  }
  return out;
}

async function splitCallPolicy(
  root: string,
  lophns: readonly string[],
): Promise<void> {
  const path = `${root}/settings.json`;
  const text = await readIfThere(path);
  if (text === null) return;
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch {
    // 사람이 고칠 파일이다. 옮길 수 없으면 그대로 둔다.
    return;
  }
  if (!isRecord(settings)) return;
  const policy = settings[CALL_POLICY_SETTING_KEY];
  if (!isRecord(policy) || !Array.isArray(policy["agents"])) return;
  const agents = expandAgentRules(policy["agents"], lophns);
  if (agents.length === policy["agents"].length) return;
  settings[CALL_POLICY_SETTING_KEY] = { ...policy, agents };
  await writeAtomic(path, `${JSON.stringify(settings, null, 2)}\n`);
}

// `mcp.lophn.<서버>`와 `mcp-oauth.lophn.<서버>.<access|refresh|meta>`를 lophn마다의 이름으로 복사하고 옛 이름은 지운다.
// 이미 있는 이름은 덮지 않는다. refresh token을 쓸 때마다 바꾸는 발급자면 lophn 하나가 refresh한 뒤 다른 lophn의 사본은
// 거절되고(`refresh_rejected`) 그 workspace에서 한 번 다시 인증한다. 다시 인증하는 길이 있고, 복사하지 않으면 모든 workspace가
// 처음부터 인증해야 해서 복사한다.
async function splitSecrets(
  root: string,
  lophns: readonly string[],
): Promise<void> {
  const path = `${root}/secrets.json`;
  const text = await readIfThere(path);
  if (text === null) return;
  let secrets: unknown;
  try {
    secrets = JSON.parse(text);
  } catch {
    return;
  }
  if (!isRecord(secrets)) return;
  const next: Record<string, unknown> = { ...secrets };
  let changed = false;
  for (const [name, value] of Object.entries(secrets)) {
    const match = /^(mcp|mcp-oauth)\.lophn\.(.+)$/.exec(name);
    if (match === null) continue;
    changed = true;
    delete next[name];
    for (const id of lophns) {
      const to = `${match[1]}.${id}.${match[2]}`;
      if (!(to in next)) next[to] = value;
    }
  }
  if (changed) await writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
}

// 전역 정의를 lophn마다의 파일로 복사하고 전역 파일은 마지막에 지운다(끊겨 다시 돌아도 원본이 남아 있다).
// 정의가 가리키는 secret 이름 `mcp.lophn.*`는 그 lophn의 이름으로 바꾼다. 앞머리(front matter) 밖은 건드리지 않는다.
async function splitDefinition(
  root: string,
  lophns: readonly string[],
): Promise<void> {
  const source = `${root}/agents/${OLD}.md`;
  const text = await readIfThere(source);
  if (text === null) return;
  const lines = text.split("\n");
  const close = lines.findIndex(
    (line, i) => i > 0 && line.replace(/\r$/, "") === FENCE,
  );
  for (const id of lophns) {
    const target = `${root}/agents/${id}.md`;
    if (await exists(target)) continue;
    const copy =
      close === -1
        ? text
        : [
            ...lines
              .slice(0, close)
              .map((line) => line.replaceAll("mcp.lophn.", `mcp.${id}.`)),
            ...lines.slice(close),
          ].join("\n");
    await writeFile(`${target}.tmp`, copy, "utf8");
    await rename(`${target}.tmp`, target);
  }
  await rm(source);
}

// 탭이 가리키는 agent id를 그 탭의 workspace의 lophn id로 바꾼다. 탭에 workspace가 없으면 layout 파일의 workspace다.
function retargetTabs(value: unknown, fileWorkspace: string): boolean {
  let changed = false;
  if (Array.isArray(value)) {
    for (const item of value) {
      changed = retargetTabs(item, fileWorkspace) || changed;
    }
  } else if (isRecord(value)) {
    if (
      (value["kind"] === "agent" || value["kind"] === "agents") &&
      value["agent"] === OLD
    ) {
      const workspace = value["workspace"];
      const key = !isRecord(workspace)
        ? fileWorkspace
        : workspace["kind"] === "home"
          ? "home"
          : String(workspace["id"]);
      value["agent"] = key === "home" ? LOPHN_HOME_ID : `lophn_${key}`;
      changed = true;
    }
    for (const item of Object.values(value)) {
      changed = retargetTabs(item, fileWorkspace) || changed;
    }
  }
  return changed;
}

async function splitLayouts(root: string): Promise<void> {
  const folder = `${root}/shell/workspaces`;
  let files: string[];
  try {
    files = await readdir(folder);
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT") return;
    throw thrown;
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const path = `${folder}/${file}`;
    let layout: unknown;
    try {
      layout = JSON.parse(await readFile(path, "utf8"));
    } catch {
      continue;
    }
    if (retargetTabs(layout, file.slice(0, -".json".length))) {
      await writeAtomic(path, JSON.stringify(layout));
    }
  }
}

export const lophnSplitDataStep: DataStep = {
  id: "lophn.split-per-workspace",
  async run(root): Promise<Result<void>> {
    const opened = openConnection(`${root}/lophn.db`);
    if (!opened.ok) return opened;
    try {
      const lophns = [
        LOPHN_HOME_ID,
        ...projectIds(opened.value.sql).map((id) =>
          lophnIdOf({ kind: "project", id } as never),
        ),
        ...appIds(opened.value.sql).map((id) =>
          lophnIdOf({ kind: "app", id } as never),
        ),
      ];
      await splitSecrets(root, lophns);
      await splitCallPolicy(root, lophns);
      await splitLayouts(root);
      await splitDefinition(root, lophns);
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message:
          "the global lophn could not be split into the workspace lophns of the data root",
      });
    } finally {
      opened.value.close();
    }
  },
};

export const lophnSplitWiring: WiringFactory = () => ({
  name: "lophn-split",
  // 새 step은 낸 step 목록의 끝에만 붙는다(schema-steps.lock.json).
  schemaStepsAfterTeams: lophnSplitSchemaSteps,
  dataSteps: [lophnSplitDataStep],
});
