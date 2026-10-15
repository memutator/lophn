import { canonicalize } from "../../../base/mod.ts";
import {
  type AgentGrantEntry,
  type AskSetting,
  DEFAULT_ASK,
  type GateGrants,
  type GateVerdict,
  type Intent,
  SETTINGS_EDIT_DEFAULT_ASK,
} from "../../../protocol/approvals/mod.ts";
import { activationComparisonSchema } from "../../../protocol/apps/activation/activation.ts";
import type { AppGrant } from "../../../protocol/apps/grants.ts";
import type { AppGrantScope } from "../../../protocol/apps/permissions.ts";

const RUN: GateVerdict = { verdict: "run" };
const ASK: GateVerdict = { verdict: "ask" };
const NOT_GRANTED: GateVerdict = { verdict: "deny", reason: "not_granted" };

function ofSetting(setting: AskSetting): GateVerdict {
  return setting === "never" ? RUN : ASK;
}

// 정규화는 호출자가 끝냈다. 이 함수는 시각, IO, 전역 상태를 쓰지 않는다.
export const gate = (intent: Intent, grants: GateGrants): GateVerdict => {
  const target = intent.target;
  switch (target.kind) {
    case "reaction": {
      const mode = grants.reaction[target.event];
      if (mode === "off") return { verdict: "deny", reason: "reaction_off" };
      return mode === "open" ? RUN : ASK;
    }
    case "activation": {
      const comparison = activationComparisonSchema.safeParse(intent.input);
      if (!comparison.success) return ASK;
      const { first, added_resources, added_app_apis, loss_steps } =
        comparison.data;
      const changed = first || added_resources.length > 0 ||
        added_app_apis.length > 0 || loss_steps.length > 0;
      return changed ? ASK : RUN;
    }
    case "app_resource":
      return intent.actor.kind === "app"
        ? appScopeVerdict(grants.app, intent.actor.app, target.scope)
        : NOT_GRANTED;
    case "app_api":
      if (intent.actor.kind === "app") {
        return appScopeVerdict(grants.app, intent.actor.app, {
          kind: "app.call",
          app: target.app,
          app_apis: [target.api],
        });
      }
      return agentVerdict(intent, grants);
    default:
      return agentVerdict(intent, grants);
  }
};

function agentVerdict(intent: Intent, grants: GateGrants): GateVerdict {
  if (intent.actor.kind !== "agent" || grants.agent === null) {
    return NOT_GRANTED;
  }
  const entries = grants.agent.entries;
  const target = intent.target;
  switch (target.kind) {
    case "app_api": {
      const entry = entries.find((one) =>
        one.kind === "app" && one.app === target.app
      );
      if (entry === undefined || entry.kind !== "app") return NOT_GRANTED;
      const override = entry.apis.find((one) => one.api === target.api);
      if (override?.setting === "excluded") {
        return { verdict: "deny", reason: "excluded" };
      }
      return ofSetting(override?.setting ?? DEFAULT_ASK[intent.effect]);
    }
    case "mcp_tool": {
      const entry = entries.find((one) =>
        one.kind === "mcp_tool" && one.server === target.server &&
        one.tool === target.tool
      );
      if (entry === undefined) return NOT_GRANTED;
      return ofSetting(settingOf(entry) ?? DEFAULT_ASK[intent.effect]);
    }
    case "agent_call": {
      const wanted = canonicalize(target.agent);
      const entry = entries.find((one) =>
        one.kind === "agent" && canonicalize(one.agent) === wanted
      );
      if (entry === undefined) return NOT_GRANTED;
      return ofSetting(settingOf(entry) ?? DEFAULT_ASK.read);
    }
    case "settings_edit": {
      const entry = entries.find((one) => one.kind === "settings");
      return ofSetting(
        (entry === undefined ? undefined : settingOf(entry)) ??
          SETTINGS_EDIT_DEFAULT_ASK,
      );
    }
    default:
      return NOT_GRANTED;
  }
}

function settingOf(entry: AgentGrantEntry): AskSetting | undefined {
  return entry.kind === "app" ? undefined : entry.setting;
}

// 앱 grant는 묻지 않는다. 덮으면 run, 아니면 deny.
function appScopeVerdict(
  grants: readonly AppGrant[],
  app: string,
  wanted: AppGrantScope,
): GateVerdict {
  const covered = grants.some((grant) =>
    grant.status === "active" && grant.app === app &&
    covers(grant.scope, wanted)
  );
  return covered ? RUN : NOT_GRANTED;
}

function covers(grant: AppGrantScope, wanted: AppGrantScope): boolean {
  switch (grant.kind) {
    case "fs.read":
    case "fs.write": {
      if (wanted.kind !== grant.kind) return false;
      if (!grant.recursive) {
        return !wanted.recursive && wanted.path === grant.path;
      }
      return isSameOrInside(wanted.path, grant.path);
    }
    case "net.fetch":
    case "net.listen":
      return wanted.kind === grant.kind && wanted.host === grant.host &&
        wanted.port === grant.port;
    case "secret.use":
      return wanted.kind === "secret.use" && wanted.name === grant.name;
    case "app.call":
      return wanted.kind === "app.call" && wanted.app === grant.app &&
        wanted.app_apis.every((api) => grant.app_apis.includes(api));
  }
}

// lexical 경로의 구성요소 관계다. 문자열 prefix는 쓰지 않는다.
function isSameOrInside(path: string, root: string): boolean {
  const one = path.replaceAll("\\", "/");
  const base = root.replaceAll("\\", "/").replace(/\/+$/, "");
  return one === base || one.startsWith(`${base}/`);
}
