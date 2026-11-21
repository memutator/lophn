import type { RandomSource } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { FolderReader, FolderWriter } from "../fs.ts";
import type { FolderLocalApp } from "./deps.ts";

/** 앱 하나를 그 앱의 destination에 한 번 쓰는 데 드는 것. */
export type Target = {
  me: Id<"mch">;
  app: FolderLocalApp;
  /** destination 이름. */
  destination: string;
  writer: FolderWriter;
  reader: FolderReader;
  sql: Sql;
  random: RandomSource;
  dataRoot: string;
  now(): string;
  nowMs(): number;
};
