import type { Clock, RandomSource, Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AppRecord } from "../../../protocol/folder/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { DestinationsView } from "../destinations.ts";

/** 이 기계에서 활성 선언에 `sync_to`가 있는 앱. */
export type FolderLocalApp = {
  app: Id<"app">;
  slug: string;
  name: string;
  description: string;
  sync_to: string;
  source_path: string | null;
  release: {
    id: Id<"rel">;
    bundle_hash: string;
    code_commit: string;
    data_schema: number;
    data_changes: readonly Record<string, unknown>[];
    created_at: string;
  } | null;
};

/** 앱 기록에 싣는 읽은 번호(`folder-import`의 cursor)와 `settled`·`horizon`(`folder-export`). */
export type FolderAppProgress = {
  read: Record<Id<"mch">, { n: number; at: string }>;
  settled: string | null;
  horizon: string | null;
};

/** `folder-import`가 둔 다른 기계의 앱 기록 사본. 지운 기계(forgotten)의 것은 빠진다. */
export type FolderAppRecordCopy = {
  origin: Id<"mch">;
  destination: string;
  record: AppRecord;
};

/** core command를 이 module의 machine 자격(`FOLDER_APPS_CONTEXT`)으로 부른다. 성공이면 command의 result다. */
export type FolderCommand = (envelope: {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
}) => Promise<Result<unknown>>;

export type FolderAppsDeps = {
  machine: () => Id<"mch">;
  destinations: DestinationsView;
  apps(): readonly FolderLocalApp[];
  records(): readonly FolderAppRecordCopy[];
  progress(app: Id<"app">): FolderAppProgress;
  command: FolderCommand;
  /** ledger. folder 표를 쓰고 core/apps의 store 함수로 앱·release를 읽는다. */
  sql: Sql;
  clock: Clock;
  random: RandomSource;
  dataRoot: string;
};
