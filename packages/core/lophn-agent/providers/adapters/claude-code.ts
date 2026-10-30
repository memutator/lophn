// Claude 구독 OAuth로 Anthropic Messages를 부를 때의 Claude Code client profile이다. packer가 만든 Messages body에
// Claude Code가 보내는 모양을 더한다: header 묶음, system 앞의 billing·identity block, custom tool 이름 앞 `_`,
// metadata.user_id, 마지막 byte의 cch. 값은 2026-10 조사 snapshot의 profile이고 Anthropic이 공개 보장한 계약이 아니다.
// 서버가 이 가운데 어느 칸을 검증하는지는 실제 계정으로 확인하지 않았다.

import type { ProviderAccount } from "../../../../protocol/lophn-agent/mod.ts";
import { joinEndpoint, type ShapedCall } from "./compat.ts";
import { sha256Text as sha256, stableUuid } from "./stable-id.ts";
import { xxh64 } from "./xxh64.ts";

export const CLAUDE_CLI_VERSION = "2.1.280";
export const CLAUDE_SDK_VERSION = "0.112.1";
export const CLAUDE_OAUTH_BETA = "oauth-2025-04-20";

const API_VERSION = "2023-06-01";
const AGENT_BETAS = [
  "claude-code-20250219",
  CLAUDE_OAUTH_BETA,
  "interleaved-thinking-2025-05-14",
];
const EFFORT_BETA = "effort-2025-11-24";
const IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const SUFFIX_SALT = "59cf53e54c78";
const CCH_SEED = 0x4d659218e32a3268n;
const CCH_PLACEHOLDER = "00000";
// Anthropic이 한 요청에 받는 cache_control 표시 수다.
const CACHE_MARKS_MAX = 4;
// 구독 요청의 cache 수명이다. Claude Code도 plan 안에서는 1시간을 쓴다. 5분이면 tool 실행이나 사람의 답을 기다리는
// 사이에 cache가 사라진다. 모든 표시를 같은 값으로 두어 "긴 TTL이 짧은 것보다 앞" 규칙에 걸리지 않는다.
const CACHE_CONTROL = { type: "ephemeral", ttl: "1h" } as const;
// 이 순서로 직렬화한다. 나머지 칸은 packer가 둔 순서로 뒤에 붙고 stream이 마지막이다.
const LEADING_KEYS = [
  "model",
  "messages",
  "system",
  "tools",
  "metadata",
  "max_tokens",
];

export type ClaudeHost = {
  // X-Stainless-OS 값이다: Linux, MacOS, Windows.
  os: string;
  // X-Stainless-Arch 값이다: x64, arm64, x86.
  arch: string;
};

export function claudeHostOf(platform: string, arch: string): ClaudeHost {
  return {
    os:
      platform === "darwin"
        ? "MacOS"
        : platform === "win32"
          ? "Windows"
          : "Linux",
    arch: arch === "arm64" ? "arm64" : arch === "ia32" ? "x86" : "x64",
  };
}

type Block = Record<string, unknown>;

function isRecord(value: unknown): value is Block {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// version suffix의 입력 글이다. 첫 대화 user message에서 글이 있는 첫 text block 하나를 쓴다. 글 없이 image만 있으면
// 빈 글이고, 비어 있거나 tool 결과뿐인 message는 건너뛴다.
export function firstUserText(messages: readonly unknown[]): string {
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") {
      if (content.trim() !== "") return content;
      continue;
    }
    if (!Array.isArray(content)) continue;
    const text = content.find(
      (block) =>
        isRecord(block) &&
        block.type === "text" &&
        typeof block.text === "string" &&
        block.text.trim() !== "",
    ) as Block | undefined;
    if (text !== undefined) return text.text as string;
    if (content.some((block) => isRecord(block) && block.type === "image")) {
      return "";
    }
  }
  return "";
}

// 글의 UTF-16 code unit 4·7·20번째와 CLI version으로 만든 세 자리 hex다.
export function versionSuffix(text: string, version: string): string {
  const picked = [4, 7, 20].map((at) => text[at] ?? "0").join("");
  return sha256(`${SUFFIX_SALT}${picked}${version}`).slice(0, 3);
}

function billingText(suffix: string, cch: string): string {
  return `x-anthropic-billing-header: cc_version=${CLAUDE_CLI_VERSION}.${suffix}; cc_entrypoint=cli; cch=${cch};`;
}

// placeholder를 넣어 직렬화한 body에서 host가 만든 billing block의 다섯 byte만 cch로 바꾼다. 사용자 글에 같은 글자가
// 있어도 따옴표가 escape되어 있어 `"system":[{` 꼴은 system 칸 하나뿐이다.
export function sealBody(json: string, billing: string): string | null {
  const marker = `"system":[${JSON.stringify({ type: "text", text: billing })}`;
  const at = json.indexOf(marker);
  if (at < 0) return null;
  const slot = at + marker.lastIndexOf(`cch=${CCH_PLACEHOLDER}`) + 4;
  const hash = xxh64(new TextEncoder().encode(json), CCH_SEED);
  const cch = (hash & 0xfffffn).toString(16).padStart(5, "0");
  return json.slice(0, slot) + cch + json.slice(slot + CCH_PLACEHOLDER.length);
}

function countCacheMarks(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((sum: number, item) => sum + countCacheMarks(item), 0);
  }
  if (!isRecord(value)) return 0;
  let count = value.cache_control === undefined ? 0 : 1;
  for (const [key, item] of Object.entries(value)) {
    if (key !== "cache_control") count += countCacheMarks(item);
  }
  return count;
}

// packer가 단 표시(5분)를 구독 수명으로 바꾼다. 다른 칸은 그대로다.
function withLongCache<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withLongCache) as T;
  if (!isRecord(value)) return value;
  const out: Block = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = key === "cache_control" ? CACHE_CONTROL : withLongCache(item);
  }
  return out as T;
}

// custom tool은 wire 이름 앞에 `_`를 붙인다. type이 있는 server tool은 그대로다.
function wireToolName(name: string): string {
  return `_${name}`;
}

function renameToolUses(messages: readonly unknown[]): unknown[] {
  return messages.map((message) => {
    if (!isRecord(message) || !Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((block) => {
        if (!isRecord(block)) return block;
        if (block.type === "tool_use" && typeof block.name === "string") {
          return { ...block, name: wireToolName(block.name) };
        }
        if (block.type === "tool_result" && Array.isArray(block.content)) {
          return {
            ...block,
            content: block.content.map((item) =>
              isRecord(item) &&
              item.type === "tool_reference" &&
              typeof item.tool_name === "string"
                ? { ...item, tool_name: wireToolName(item.tool_name) }
                : item,
            ),
          };
        }
        return block;
      }),
    };
  });
}

function betasOf(body: Block, extra: string | undefined): string {
  const betas = [...AGENT_BETAS];
  const config = body.output_config;
  if (isRecord(config) && config.effort !== undefined) betas.push(EFFORT_BETA);
  for (const beta of (extra ?? "").split(",")) {
    const name = beta.trim();
    if (name !== "" && !betas.includes(name)) betas.push(name);
  }
  return betas.join(",");
}

export function claudeCodeProfile(options: {
  // 연결한 provider ID다. 설치·계정별 device id의 재료다.
  provider: string;
  account: ProviderAccount | null;
  host: ClaudeHost;
  // option·defer가 정한 anthropic-beta다. 같은 header로 합친다.
  betas?: string;
}): (input: {
  endpoint: string;
  session: string | null;
  body: Record<string, unknown>;
}) => ShapedCall | null {
  const accountId = options.account?.id ?? null;
  const deviceId = sha256(
    `lophn.claude.device\n${options.provider}\n${accountId ?? ""}`,
  );
  return (input) => {
    const packed = input.body;
    const sessionId = stableUuid(
      "lophn.claude.session",
      input.session ?? options.provider,
    );
    const messages = Array.isArray(packed.messages) ? packed.messages : [];
    const declared = Array.isArray(packed.tools) ? packed.tools : [];
    const back = new Map<string, string>();
    const tools = declared.map((tool) => {
      if (!isRecord(tool) || typeof tool.name !== "string") return tool;
      if (tool.type !== undefined && tool.type !== "custom") return tool;
      const wire = wireToolName(tool.name);
      back.set(wire, tool.name);
      return { ...tool, name: wire };
    });
    const system = Array.isArray(packed.system)
      ? packed.system
      : typeof packed.system === "string" && packed.system !== ""
        ? [{ type: "text", text: packed.system }]
        : [];
    const renamed = withLongCache(renameToolUses(messages));
    const room =
      countCacheMarks(system) +
        countCacheMarks(renamed) +
        countCacheMarks(tools) <
      CACHE_MARKS_MAX;
    const billing = billingText(
      versionSuffix(firstUserText(messages), CLAUDE_CLI_VERSION),
      CCH_PLACEHOLDER,
    );
    const shaped: Record<string, unknown> = {
      model: packed.model,
      messages: renamed,
      system: [
        { type: "text", text: billing },
        {
          type: "text",
          text: IDENTITY,
          ...(room ? { cache_control: CACHE_CONTROL } : {}),
        },
        ...withLongCache(system),
      ],
      tools: withLongCache(tools),
      metadata: {
        user_id: JSON.stringify({
          device_id: deviceId,
          session_id: sessionId,
          ...(accountId === null ? {} : { account_uuid: accountId }),
        }),
      },
      max_tokens: packed.max_tokens,
    };
    for (const [key, value] of Object.entries(packed)) {
      if (!LEADING_KEYS.includes(key) && key !== "stream") shaped[key] = value;
    }
    shaped.stream = true;
    const body = sealBody(JSON.stringify(shaped), billing);
    if (body === null) return null;
    return {
      url: `${joinEndpoint(input.endpoint, "/messages")}?beta=true`,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": `claude-cli/${CLAUDE_CLI_VERSION} (external, cli)`,
        "anthropic-version": API_VERSION,
        "anthropic-beta": betasOf(packed, options.betas),
        "anthropic-dangerous-direct-browser-access": "true",
        "x-app": "cli",
        "x-claude-code-session-id": sessionId,
        "x-stainless-lang": "js",
        "x-stainless-package-version": CLAUDE_SDK_VERSION,
        "x-stainless-retry-count": "0",
        "x-stainless-runtime": "node",
        "x-stainless-runtime-version": "v26.3.0",
        "x-stainless-timeout": "600",
        "x-stainless-arch": options.host.arch,
        "x-stainless-os": options.host.os,
      },
      body,
      toolName: (name) => back.get(name) ?? name,
    };
  };
}
