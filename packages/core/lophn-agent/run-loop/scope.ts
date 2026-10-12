import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentAppScope,
  agentAppScopeSchema,
  type AgentRole,
} from "../../../protocol/lophn-agent/mod.ts";

// StartRun이 agent credential에 싣는 AgentAppScope 계산(requirements
// lophn-agent/roles/common R11). 역할이 닿을 수 있는 앱 command의 상한이다.
// platform은 이 값을 해석하지 않고 발급 뒤 넓히지 못하게만 한다. 현재 grant 회수·
// release 변경은 호출마다 다시 교집합한다(tool 정의는 다른 작업). 여기서는 시작 상한만 낸다.

export type OfferedCommand = {
  key: string;
  effect: "read" | "write" | "external";
  // blueprint의 confirm 선언. true면 사람 approval을 거친다.
  confirm: boolean;
  revert_supported: boolean;
};

// 앱 하나의 현재 선언과 사람이 agent 사용을 허락한 command(agent.commands grant).
// 호출자가 apps contract read로 읽은 값만 넣는다. grant가 없으면 granted는 빈 목록이다.
export type AppOffer = {
  app: string;
  commands: readonly OfferedCommand[];
  granted: readonly string[];
};

type ReadCommand = { app: string; command: string };

export type ScopeInput = {
  role: AgentRole;
  assignment: string;
  // assignment의 담당 범위. App Engineer는 app 하나, 그 밖에는 앱 범위가 없다.
  work: { kind: "all" | "project" | "app"; id: string | null };
  // Operator가 승인받은 읽기 앱·command. 다른 역할은 쓰지 않는다.
  read_apps: readonly string[];
  read_commands: readonly ReadCommand[];
  offers: readonly AppOffer[];
};

type Entry = AgentAppScope["apps"][number];

const EFFECT_ORDER = ["read", "write", "external"] as const;

function entryOf(
  offer: AppOffer,
  commands: readonly OfferedCommand[],
  options: { revertRequired: boolean; confirmAllowed: boolean },
): Entry | undefined {
  if (commands.length === 0) return undefined;
  const effects = EFFECT_ORDER.filter((effect) =>
    commands.some((command) => command.effect === effect)
  );
  return {
    app: offer.app,
    commands: commands.map((command) => command.key).sort(),
    effects: [...effects],
    revert_required: options.revertRequired && effects.includes("write"),
    confirm_allowed: options.confirmAllowed,
  };
}

// 선언 ∩ 허락 안에서 역할이 받을 command를 고른다.
function allowed(offer: AppOffer): OfferedCommand[] {
  const granted = new Set(offer.granted);
  return offer.commands.filter((command) => granted.has(command.key));
}

export function computeAgentAppScope(
  input: ScopeInput,
): Result<AgentAppScope> {
  const apps: Entry[] = [];
  for (const offer of input.offers) {
    const pool = allowed(offer);
    let entry: Entry | undefined;
    switch (input.role) {
      case "context_engineer":
        // 실행 없이 목록·설명 조회만. 앱 command는 하나도 없다.
        break;
      case "lophn":
        // 사람이 허락한 앱의 command. effect는 tool 판정(ask·allow)이 가른다.
        entry = entryOf(offer, pool, {
          revertRequired: false,
          confirmAllowed: true,
        });
        break;
      case "app_engineer":
        // 담당 앱의 read와 되돌리기를 지원하는 write. external은 없다.
        if (input.work.kind !== "app" || input.work.id !== offer.app) break;
        entry = entryOf(
          offer,
          pool.filter((command) =>
            command.effect === "read" ||
            (command.effect === "write" && command.revert_supported)
          ),
          { revertRequired: true, confirmAllowed: true },
        );
        break;
      case "operator": {
        // assignment에 승인된 read만. confirm 선언 command는 사람 없이 못 부른다.
        if (!input.read_apps.includes(offer.app)) break;
        const approved = new Set(
          input.read_commands
            .filter((item) => item.app === offer.app)
            .map((item) => item.command),
        );
        entry = entryOf(
          offer,
          pool.filter((command) =>
            command.effect === "read" && !command.confirm &&
            approved.has(command.key)
          ),
          { revertRequired: false, confirmAllowed: false },
        );
        break;
      }
    }
    if (entry !== undefined) apps.push(entry);
  }
  apps.sort((a, b) => a.app < b.app ? -1 : a.app > b.app ? 1 : 0);
  const parsed = agentAppScopeSchema.safeParse({
    role: input.role,
    assignment: input.assignment,
    apps,
  });
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "agent scope is outside the role bound",
    });
  }
  return ok(parsed.data);
}
