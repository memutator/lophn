import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import {
  type AgentPlace,
  type McpServerConfig,
  placeExtensionSettingsChange,
  placeExtensionSettingsChanged,
  placeExtensionSettingsRead,
} from "../../contracts/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Compare,
  Input,
  Output,
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
  Tx,
} from "../../contracts/platform/mod.ts";
import { checkMcpConfig } from "./mcp-config.ts";
import {
  dataRootOf,
  fileHash,
  parsePlaceMcpFile,
  type PlaceFiles,
  type PlaceMcpFile,
  placeMcpPathOf,
  placeSkillsOf,
  type ReadSql,
  serializePlaceMcpFile,
} from "./place-store.ts";
import {
  listSkillsSync,
  type SkillSources,
  type SyncSkillFiles,
} from "./skills-sync.ts";

// 자리(project·app) 층의 MCP 서버 목록을 저장하고 읽는다(concern lophn-agent/extensions R32, R33). 서버 등록은
// 사람만 한다(route actors, R11). 순서는 입력 검사 → CAS 비교 → 쓰기 → event다. 파일은 transaction 안에서 마지막에
// 쓰고, 쓰기가 실패하면 handler가 err를 돌려 event까지 전체가 되돌아간다.

// 다른 concern의 값을 읽는 길이다. 정본은 각 concern이고 여기서는 읽기만 한다.
export type PlaceExtensionLookups = {
  placeExists(place: AgentPlace): boolean;
  // 전역(Workspace)에 등록된 서버 전부다. 켜짐 여부와 상관없이 이름이 겹치면 거절한다(R33).
  globalServers(): readonly McpServerConfig[];
  // 전역 층의 skill 출처다. 자리 폴더는 data root와 자리에서 정해진다.
  skillSources(): Omit<SkillSources, "place">;
};

export type PlaceExtensionDeps = {
  files: PlaceFiles;
  skillFiles: SyncSkillFiles;
  lookups(sql: ReadSql): PlaceExtensionLookups;
  // 없으면 ledger 파일이 있는 폴더가 data root다.
  dataRoot?: string;
};

const FIRST_REVISION = 1;

function notFound(what: string): Result<never> {
  return err({ code: "not_found", message: `${what} not found` });
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

type Current = { hash: string; file: PlaceMcpFile | null };

// 파일이 없으면 null이다. 틀린 파일은 hash만 있고 내용이 없는 것으로 읽는다: 새 내용 전체로 덮어쓸 수는 있다.
function readCurrent(
  deps: PlaceExtensionDeps,
  root: string,
  place: AgentPlace,
): Result<Current | null> {
  try {
    const text = deps.files.read(placeMcpPathOf(root, place));
    if (text === null) return ok(null);
    const parsed = parsePlaceMcpFile(text);
    return ok({ hash: fileHash(text), file: parsed.ok ? parsed.value : null });
  } catch {
    return err({
      code: "unavailable",
      message: "place MCP file could not be read",
    });
  }
}

function withoutRevision(server: McpServerConfig): string {
  return canonicalize({ ...server, revision: 0 });
}

// 서버의 revision은 받은 값이 아니라 바뀐 설정에 맞춰 올린다(domain model McpServerConfig.revision).
function revised(
  next: readonly McpServerConfig[],
  before: readonly McpServerConfig[],
): McpServerConfig[] {
  const known = new Map(before.map((server) => [server.name, server]));
  return next.map((server) => {
    const old = known.get(server.name);
    if (old === undefined) return { ...server, revision: FIRST_REVISION };
    return {
      ...server,
      revision: withoutRevision(old) === withoutRevision(server)
        ? old.revision
        : old.revision + 1,
    };
  });
}

// 전역 서버와 이름이 겹치거나(R33) 설정이 상충하면(R12) 그 서버만이 아니라 변경 전체를 거절한다.
function checkServers(
  servers: readonly McpServerConfig[],
  global: readonly McpServerConfig[],
): Result<void> {
  const names = new Set<string>();
  for (const server of servers) {
    if (names.has(server.name)) {
      return invalid(`mcp server name ${server.name} is repeated`);
    }
    names.add(server.name);
  }
  const taken = new Set(global.map((server) => server.name));
  for (const server of servers) {
    if (taken.has(server.name)) {
      return invalid(
        `mcp server name ${server.name} is already a global server`,
      );
    }
  }
  const checked = checkMcpConfig(servers);
  if (!checked.ok) return checked;
  const problem = checked.value.problems[0];
  if (problem !== undefined) {
    return invalid(`mcp server ${problem.server}: ${problem.reason}`);
  }
  return ok(undefined);
}

export function createPlaceExtensionCommands(deps: PlaceExtensionDeps): {
  change: CommandDefinition<typeof placeExtensionSettingsChange>;
} {
  return {
    change: {
      route: placeExtensionSettingsChange,
      handle(
        tx: Tx,
        _ctx: RequestContext,
        input: Input<typeof placeExtensionSettingsChange>,
        compare: Compare<typeof placeExtensionSettingsChange>,
      ): Result<Output<typeof placeExtensionSettingsChange>> {
        const { place } = input;
        const lookups = deps.lookups(tx.sql);
        if (!lookups.placeExists(place)) return notFound("place");
        const root = dataRootOf(tx.sql, deps.dataRoot);
        if (!root.ok) return root;
        const current = readCurrent(deps, root.value, place);
        if (!current.ok) return current;
        const before = current.value?.hash ?? null;
        if (compare.hash !== before) {
          return err({
            code: "conflict",
            message: "place MCP file hash changed",
          });
        }
        const checked = checkServers(
          input.mcp_servers,
          lookups.globalServers(),
        );
        if (!checked.ok) return checked;

        const old = current.value?.file ?? null;
        const text = serializePlaceMcpFile({
          revision: old === null ? FIRST_REVISION : old.revision + 1,
          mcp_servers: revised(input.mcp_servers, old?.mcp_servers ?? []),
        });
        const after = fileHash(text);
        tx.emit(placeExtensionSettingsChanged, place.id, {
          place,
          before_hash: before,
          after_hash: after,
        });
        try {
          deps.files.writeAtomic(placeMcpPathOf(root.value, place), text);
        } catch {
          return err({
            code: "unavailable",
            message: "place MCP file could not be written",
          });
        }
        return ok({ place, hash: after });
      },
    },
  };
}

export function createPlaceExtensionReads(deps: PlaceExtensionDeps): {
  read: ReadDefinition<typeof placeExtensionSettingsRead>;
} {
  return {
    read: {
      route: placeExtensionSettingsRead,
      handle(
        snapshot: ReadSnapshot,
        _ctx: RequestContext,
        input: Input<typeof placeExtensionSettingsRead>,
      ): Result<Output<typeof placeExtensionSettingsRead>> {
        const { place } = input;
        const lookups = deps.lookups(snapshot.sql);
        if (!lookups.placeExists(place)) return notFound("place");
        const root = dataRootOf(snapshot.sql, deps.dataRoot);
        if (!root.ok) return root;
        const current = readCurrent(deps, root.value, place);
        if (!current.ok) return current;
        if (current.value !== null && current.value.file === null) {
          return err({
            code: "invalid_input",
            message: "place MCP file is invalid",
          });
        }
        const file = current.value?.file ?? null;
        const listing = listSkillsSync(deps.skillFiles, {
          ...lookups.skillSources(),
          place: placeSkillsOf(root.value, place),
        });
        return ok({
          place,
          settings: {
            revision: file?.revision ?? FIRST_REVISION,
            mcp_servers: [...(file?.mcp_servers ?? [])],
          },
          hash: current.value?.hash ?? null,
          skills: [...listing.entries],
          shadowed: [...listing.shadowed],
          skipped: [...listing.skipped],
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
