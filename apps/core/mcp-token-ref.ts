import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  type AgentPlace,
  type McpServerConfig,
  mcpServersSetting,
  placeExtensionSettingsChange,
} from "../../packages/contracts/lophn-agent/mod.ts";
import {
  applySettings,
  type ReadRoute,
  settingsGet,
} from "../../packages/contracts/platform/mod.ts";
import {
  fileHash,
  parsePlaceMcpFile,
  placeMcpPathOf,
} from "../../packages/lophn-agent/extensions/mod.ts";
import type { McpAuthTarget } from "./mcp-auth.ts";

// 로그인이 끝난 서버의 설정에 token 참조(`token_ref`)를 쓰거나 지운다(extensions#R16, R17). 참조는 값이 아니라
// 서버(자리+이름)에서 정해지는 이름이다. 설정을 바꾸는 길은 사람이 설정을 바꾸는 것과 같다: 전역 서버는 settings
// 의 ApplySettings(설정 판 비교), 자리 서버는 ChangePlaceExtensionSettings(파일 hash 비교)다. 서버 판은 바뀐
// 설정에 맞춰 올라가서 그 서버의 옛 연결이 새 설정으로 다시 열린다. 사람이 그 사이에 설정을 바꿨으면 한 번 더
// 읽고 시도한 뒤 conflict로 돌려준다.

type Deps = {
  dataRoot: string;
  // 읽기 통로(reader pool)다. 로그인을 부른 사람의 자격으로 읽는다.
  read(
    route: ReadRoute,
    ctx: unknown,
    input: unknown,
  ): Promise<Result<unknown>>;
  // 쓰기 통로(writer)다. 로그인을 부른 사람의 자격으로 낸다.
  command(
    ctx: unknown,
    envelope: {
      command: string;
      input: unknown;
      idempotency_key: string;
      compare: unknown;
      prepared: readonly string[];
    },
  ): Promise<Result<unknown>>;
};

const ATTEMPTS = 2;

function withRef(
  servers: readonly McpServerConfig[],
  name: string,
  ref: string | null,
  bumpRevision: boolean,
): McpServerConfig[] | undefined {
  let found = false;
  const next = servers.map((server) => {
    if (
      server.name !== name || server.transport !== "http" ||
      server.http.auth.kind !== "oauth2"
    ) return server;
    found = true;
    return {
      ...server,
      revision: bumpRevision ? server.revision + 1 : server.revision,
      http: {
        ...server.http,
        auth: { ...server.http.auth, token_ref: ref },
      },
    } as McpServerConfig;
  });
  return found ? next : undefined;
}

export function createMcpTokenRefWriter(deps: Deps) {
  async function writeGlobal(
    ctx: unknown,
    name: string,
    ref: string | null,
  ): Promise<Result<void>> {
    const read = await deps.read(settingsGet, ctx, {
      keys: [mcpServersSetting.key],
    });
    if (!read.ok) return read;
    const got = read.value as {
      settings: { key: string; value: unknown }[];
      revision: number;
      defaults_revision: string;
    };
    const current = got.settings.find((entry) =>
      entry.key === mcpServersSetting.key
    );
    const parsed = mcpServersSetting.value_type.safeParse(current?.value);
    if (!parsed.success) {
      return err({ code: "not_found", message: "등록한 서버가 아니다" });
    }
    const next = withRef(parsed.data, name, ref, true);
    if (next === undefined) {
      return err({ code: "not_found", message: "등록한 서버가 아니다" });
    }
    const applied = await deps.command(ctx, {
      command: applySettings.name,
      input: {
        changes: [{
          layer: "common",
          key: mcpServersSetting.key,
          action: "set",
          value: next,
        }],
      },
      idempotency_key: `mcp-token-ref:global:${name}:${got.revision}`,
      compare: {
        revision: got.revision,
        defaults_revision: got.defaults_revision,
      },
      prepared: [],
    });
    return applied.ok ? ok(undefined) : applied;
  }

  async function writePlace(
    ctx: unknown,
    place: AgentPlace,
    name: string,
    ref: string | null,
  ): Promise<Result<void>> {
    const path = placeMcpPathOf(deps.dataRoot, place);
    let text: string | null;
    try {
      text = await Deno.readTextFile(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        return err({
          code: "unavailable",
          message: "자리 서버 파일을 읽지 못했다",
        });
      }
      text = null;
    }
    const file = text === null ? undefined : parsePlaceMcpFile(text);
    if (file === undefined || !file.ok) {
      return err({ code: "not_found", message: "등록한 서버가 아니다" });
    }
    // 서버 판은 자리 설정 변경이 바뀐 서버에 맞춰 올린다.
    const next = withRef(file.value.mcp_servers, name, ref, false);
    if (next === undefined) {
      return err({ code: "not_found", message: "등록한 서버가 아니다" });
    }
    const hash = fileHash(text!);
    const changed = await deps.command(ctx, {
      command: placeExtensionSettingsChange.name,
      input: { place, mcp_servers: next },
      idempotency_key: `mcp-token-ref:${place.id}:${name}:${hash}`,
      compare: { hash },
      prepared: [],
    });
    return changed.ok ? ok(undefined) : changed;
  }

  return async function writeTokenRef(
    ctx: unknown,
    target: McpAuthTarget,
    ref: string | null,
  ): Promise<Result<void>> {
    let last: Result<void> = ok(undefined);
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      last = target.place === null
        ? await writeGlobal(ctx, target.name, ref)
        : await writePlace(ctx, target.place, target.name, ref);
      if (last.ok || last.error.code !== "conflict") return last;
    }
    return last;
  };
}
