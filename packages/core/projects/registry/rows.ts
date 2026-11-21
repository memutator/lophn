import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ProjectFolder,
  projectFolderOutputSchema,
  projectRecordSchema,
} from "../../../protocol/projects/mod.ts";
import type { SqlRow } from "../../../protocol/server/mod.ts";
import { type Project, validateFolderRoots } from "./model.ts";

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored project" });
}

// 틀린 JSON은 undefined가 되어 schema가 거절한다.
function jsonOf(text: unknown): unknown {
  try {
    return JSON.parse(String(text));
  } catch {
    return undefined;
  }
}

function inOrder(position: unknown, index: number): boolean {
  return position === index || position === BigInt(index);
}

export function projectFromRows(
  row: SqlRow,
  folderRows: readonly SqlRow[],
): Result<Project> {
  const folders: ProjectFolder[] = [];
  for (let index = 0; index < folderRows.length; index++) {
    const folder = folderRows[index]!;
    if (!inOrder(folder.position, index)) return invalidStored();
    const parsed = projectFolderOutputSchema.safeParse({
      path: folder.path,
      description: folder.description,
    });
    if (!parsed.success) return invalidStored();
    folders.push(parsed.data);
  }
  if (!validateFolderRoots(folders).ok) return invalidStored();
  const parsed = projectRecordSchema.omit({ folders: true }).safeParse({
    id: row.id,
    name: row.name,
    title: row.title,
    purpose: row.purpose,
    revision: row.revision,
    status: row.status,
    identity: row.identity,
    former_identities: jsonOf(row.former_identities),
    separated: row.separated === 1 || row.separated === 1n,
    repo: row.repo,
    remote:
      row.remote_key === null
        ? null
        : { key: row.remote_key, url: row.remote_url },
  });
  return parsed.success ? ok({ ...parsed.data, folders }) : invalidStored();
}
