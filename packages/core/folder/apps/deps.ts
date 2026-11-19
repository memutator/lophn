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
    code_commit: string;
    data_schema: number;
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

/** 이 기계의 앱. */
export type LocalApp = {
  slug: string;
  source_path: string | null;
  revision: string;
  // 이 기계에서 가장 늦게 넣은 release의 commit. 처음 만드는 source 저장소의 main이 된다.
  code_commit: string | null;
};

/** take-in과 source 받기가 core/apps에 기대는 면. core/apps가 구현하고(apps/folder-host.ts) 조립이 넘긴다. */
export type FolderAppsHost = {
  app(id: Id<"app">): Result<LocalApp | null>;
  slugOwner(slug: string): Result<Id<"app"> | null>;
  releaseWithCommit(
    app: Id<"app">,
    codeCommit: string,
  ): Result<Id<"rel"> | null>;
  published(name: string, version: string): boolean;
  createApp(input: {
    id: Id<"app">;
    slug: string;
    name: string;
    description: string;
  }): Promise<Result<{ revision: string }>>;
  connectSource(
    app: Id<"app">,
    revision: string,
    sourcePath: string,
  ): Promise<Result<void>>;
  /** 이 기계의 source 저장소에서 지정한 commit으로 local release를 준비해 `prepared`로 적는다. */
  prepareRelease(input: {
    app: Id<"app">;
    sourcePath: string;
    commit: string;
  }): Promise<Result<Id<"rel">>>;
};

export type FolderAppsDeps = {
  machine: () => Id<"mch">;
  destinations: DestinationsView;
  apps(): readonly FolderLocalApp[];
  records(): readonly FolderAppRecordCopy[];
  progress(app: Id<"app">): FolderAppProgress;
  host: FolderAppsHost;
  /** ledger. folder 표를 쓴다. */
  sql: Sql;
  clock: Clock;
  random: RandomSource;
  dataRoot: string;
};
