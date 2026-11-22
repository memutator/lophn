// 복제: 저장된 정의 하나에서 새 agent의 첫 편집 값을 만든다. 만들기는 보통 새 agent와 같은 저장(agents/create)이다.
// handle과 name만 새로 짓고 나머지 칸은 그대로 옮긴다. 사람이 하는 일이라 사람만 쓰는 칸(할당, MCP server, skip, browser profile)도 옮긴다.
import type {
  AgentRuntime,
  AgentWorkspace,
} from "../../../../../protocol/lophn-agent/agent-values.ts";
import type { AgentDraft } from "../source.ts";

/** 새로 짓는 handle의 상한(정의 schema와 같다). */
const HANDLE_MAX = 40;

/**
 * `<handle>-copy`, 겹치면 `-copy-2`, `-copy-3` … 이다. 옛 정의의 handle은 새 규칙(소문자·숫자·`-`·`_`)에 맞지 않을 수 있어
 * 그 규칙으로 고쳐 쓴다. 겹침은 대소문자를 가리지 않는다(handle 열쇠와 같다).
 */
export function copyHandle(handle: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((one) => one.trim().toLowerCase()));
  const stem =
    handle
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent";
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? "-copy" : `-copy-${n}`;
    const candidate = `${stem.slice(0, HANDLE_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

export interface CopySource {
  /** 원래 agent의 저장된 정의(할당 칸 포함). */
  readonly definition: AgentDraft;
  /** 원래 agent의 id. agent 층 MCP server의 secret 이름이 이 id를 쓴다. */
  readonly id: string;
  /** 원래 agent의 범위. lophn은 정의 file이 아니라 id가 말해서 따로 받는다. 전역이면 null이다. */
  readonly scope: AgentWorkspace | null;
  /** 정의 file에 runtime이 없을 때 쓰는 값(정의 file 없는 내장 coding agent는 명함이 runtime을 말한다). */
  readonly runtime: AgentRuntime | undefined;
}

/**
 * 복제한 정의. 올린 이미지 avatar는 원래 agent의 file이라 옮기지 못해 기본 character로 둔다(imageDropped).
 * agent 층 MCP server의 secret 이름(`mcp.<agent id>.…`)은 새 id로 바꾼다: 값은 옮기지 않고 만든 뒤 보호 입력으로 받는다.
 */
export function copyDefinition(
  source: CopySource,
  copy: { readonly name: string; readonly handle: string; readonly id: string },
): { readonly definition: AgentDraft; readonly imageDropped: boolean } {
  const {
    handle: _handle,
    name: _name,
    workspace: _workspace,
    avatar,
    runtime,
    mcp_servers,
    ...rest
  } = source.definition;
  const imageDropped = avatar?.kind === "image";
  const shownRuntime = runtime ?? source.runtime;
  return {
    imageDropped,
    definition: {
      ...rest,
      handle: copy.handle,
      name: copy.name,
      ...(source.scope === null ? {} : { workspace: source.scope }),
      ...(avatar === undefined || imageDropped ? {} : { avatar }),
      ...(shownRuntime === undefined || shownRuntime === "lophn"
        ? {}
        : { runtime: shownRuntime }),
      ...(mcp_servers === undefined
        ? {}
        : {
            mcp_servers: JSON.parse(
              JSON.stringify(mcp_servers).replaceAll(
                `"mcp.${source.id}.`,
                `"mcp.${copy.id}.`,
              ),
            ) as AgentDraft["mcp_servers"],
          }),
    },
  };
}
