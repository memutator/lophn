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

function inOrder(position: unknown, index: number): boolean {
  return position === index || position === BigInt(index);
}

export function projectFromRows(
  row: SqlRow,
  folderRows: readonly SqlRow[],
  subfolderRows: readonly SqlRow[],
): Result<Project> {
  const folders: ProjectFolder[] = [];
  for (let index = 0; index < folderRows.length; index++) {
    const folder = folderRows[index]!;
    if (!inOrder(folder.position, index)) return invalidStored();
    const subfolders: { path: string; description: string }[] = [];
    for (const sub of subfolderRows) {
      if (sub.folder_path !== folder.path) continue;
      if (!inOrder(sub.position, subfolders.length)) return invalidStored();
      subfolders.push({
        path: sub.path as string,
        description: sub.description as string,
      });
    }
    const parsed = projectFolderOutputSchema.safeParse({
      path: folder.path,
      description: folder.description,
      subfolders,
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
  });
  return parsed.success ? ok({ ...parsed.data, folders }) : invalidStored();
}
