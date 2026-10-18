import { err, ok, type Result } from "../../../../packages/base/mod.ts";
import type { VersionRef } from "../../types.ts";
import { contentFiles, readEntries, TEXT_KINDS } from "../../versions/mod.ts";

export type ComponentChange = { from: VersionRef; to: VersionRef };
export type ChangedText = {
  change: ComponentChange;
  before: Record<string, string>;
  after: Record<string, string>;
};

// 글 component가 아니면(tool, assembly, runtime) registry에 내용이 없어 null이다.
export async function loadChangedText(
  registryDir: string,
  change: ComponentChange,
): Promise<Result<ChangedText | null>> {
  if (!TEXT_KINDS.includes(change.to.kind)) return ok(null);
  const files: Record<string, string>[] = [];
  for (const ref of [change.from, change.to]) {
    const entry = (await readEntries(registryDir, ref.kind, ref.name))
      .find((e) => e.n === ref.n);
    if (entry === undefined) {
      return err({
        code: "not_found",
        message: `registry에 ${ref.kind}:${ref.name}@${ref.n}이 없다`,
      });
    }
    files.push(contentFiles(entry));
  }
  return ok({ change, before: files[0], after: files[1] });
}
