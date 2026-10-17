// 내장 앱 템플릿을 `<dataRoot>/templates/app/`에 읽기 전용(파일 0444·디렉터리 0555)으로 둔다.
// 고정 hash는 없다. 설치할 때마다 저장소 원본을 읽어 byte를 비교하고, 다르면 새 판으로 바꾼다.
import { ok, type Result } from "../../../../base/mod.ts";
import {
  removeInstallCopy,
  sameInstallCopy,
  writeInstallCopy,
} from "../install.ts";
import { builtinTemplate, sortTemplateFiles } from "./files.ts";
import type { TemplateFile } from "./files.ts";

export type TemplateInstallResult = {
  install_path: string;
  files: readonly string[];
};

export async function installTemplate(
  files: readonly TemplateFile[],
  deps: { dataRoot: string },
): Promise<Result<TemplateInstallResult>> {
  const sorted = sortTemplateFiles(files);
  const target = `${deps.dataRoot}/templates/app`;
  if (!await sameInstallCopy(target, sorted)) {
    await removeInstallCopy(target);
    const copied = await writeInstallCopy(target, sorted);
    if (!copied.ok) return copied;
  }
  return ok({ install_path: target, files: sorted.map((file) => file.path) });
}

export async function installBuiltinTemplate(deps: {
  dataRoot: string;
  directory?: string;
}): Promise<Result<TemplateInstallResult>> {
  const read = await builtinTemplate(deps.directory);
  if (!read.ok) return read;
  return await installTemplate(read.value, deps);
}
