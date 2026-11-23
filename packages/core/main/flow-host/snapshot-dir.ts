import { rm } from "node:fs/promises";
import type { Result } from "../../../base/mod.ts";
import {
  type MaterializeSnapshotOptions,
  materializeSnapshot,
} from "../../workflows/snapshot.ts";

// <data>/projects/.flow-snapshots/<instance>-<runId>/ 아래에 snapshot을 복원한다.
// <data>/projects/node_modules/@lophn/flow가 상위 폴더에 있어 Node가 설치된 SDK를 그대로 찾는다.
const SNAPSHOTS_DIR = ".flow-snapshots";

export function flowSnapshotRunDir(
  dataRoot: string,
  instance: string,
  runId: string,
): string {
  return `${dataRoot}/projects/${SNAPSHOTS_DIR}/${instance}-${runId}`;
}

export async function prepareFlowRunDir(input: {
  dataRoot: string;
  instance: string;
  runId: string;
  manifestJson: string;
  readBlob?: MaterializeSnapshotOptions["readBlob"];
}): Promise<Result<{ dir: string; files: string[] }>> {
  const targetDir = flowSnapshotRunDir(
    input.dataRoot,
    input.instance,
    input.runId,
  );
  const options: MaterializeSnapshotOptions =
    input.readBlob !== undefined
      ? { readBlob: input.readBlob }
      : { dataRoot: input.dataRoot };
  const materialized = await materializeSnapshot(
    input.manifestJson,
    targetDir,
    options,
  );
  if (!materialized.ok) {
    await cleanupFlowRunDir(targetDir);
    return materialized;
  }
  return materialized;
}

export async function cleanupFlowRunDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
