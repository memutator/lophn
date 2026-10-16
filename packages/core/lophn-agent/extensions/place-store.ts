import { createHash } from "node:crypto";
import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentPlace,
  type McpServerConfig,
  mcpServerConfigSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";

// 옛 place(project·app) 층의 저장 위치와 파일 모양이다. register.ts가 옛 `ReadPlaceExtensionSettings`·
// `ChangePlaceExtensionSettings` handler를 내리면 이 file에서 PlaceFiles, ReadSql, dataRootOf, fileHash만 남기고 지운다.
// 새 project 층은 project-settings.ts다. 파일 IO는 port로 받는다.

export const PLACE_MCP_FILE = "mcp-servers.json";

// 한 파일의 읽기와 원자 쓰기다. 없는 파일 읽기는 null이고 그 밖의 IO 실패는 던진다.
export type PlaceFiles = {
  read(path: string): string | null;
  writeAtomic(path: string, text: string): void;
};

export type ReadSql = Pick<Tx["sql"], "get" | "all">;

export function placeFolderOf(root: string, place: AgentPlace): string {
  return `${root}/${
    place.kind === "project" ? "projects" : "apps"
  }/${place.id}`;
}

export function placeMcpPathOf(root: string, place: AgentPlace): string {
  return `${placeFolderOf(root, place)}/${PLACE_MCP_FILE}`;
}

export type PlaceMcpFile = {
  revision: number;
  mcp_servers: readonly McpServerConfig[];
};

const fileSchema = z.strictObject({
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  mcp_servers: z.array(mcpServerConfigSchema).max(32),
});

export function serializePlaceMcpFile(value: PlaceMcpFile): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// 파일은 사람이 손으로 고칠 수도 있어 읽을 때 다시 검사한다. 틀린 파일은 오류 이유를 돌려준다.
export function parsePlaceMcpFile(text: string): Result<PlaceMcpFile, string> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err("place MCP file is not JSON");
  }
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) return err("place MCP file has a wrong shape");
  const names = parsed.data.mcp_servers.map((server) => server.name);
  if (new Set(names).size !== names.length) {
    return err("place MCP file repeats a server name");
  }
  return ok(parsed.data);
}

export function fileHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// 코드가 data root를 따로 받지 않으면 ledger 파일이 있는 폴더가 data root다(agent 정의 저장소와 같은 규칙).
export function dataRootOf(
  sql: ReadSql,
  fixed: string | undefined,
): Result<string> {
  if (fixed !== undefined) return ok(fixed);
  const row = sql.get(
    "select file from pragma_database_list where name = 'main'",
    [],
  );
  const file = row?.["file"];
  if (typeof file !== "string" || !file.includes("/")) {
    return err({ code: "unavailable", message: "ledger location is unknown" });
  }
  return ok(file.slice(0, file.lastIndexOf("/")));
}
