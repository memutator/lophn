// 앱 템플릿의 파일 묶음. 템플릿은 상대 경로와 byte의 묶음이고 별도 상태가 없다.
import { readdir, readFile } from "node:fs/promises";

import { err, ok, type Result } from "../../../../base/mod.ts";
import type { SourceFile } from "../vendor.ts";

export type TemplateFile = SourceFile;

export type TemplateFailure = {
  code: "invalid_input" | "not_found" | "unavailable";
  message: string;
};

// 저장소의 템플릿 원본 폴더. 파일 이름 끝의 `.tmpl`은 저장소 도구(fmt·lint·check·test)가 템플릿 소스를
// 앱으로 읽지 않게 하는 표시이고, 설치와 앱 만들기는 이 접미를 뗀다.
export const BUILTIN_TEMPLATE_DIRECTORY =
  new URL("./app/", import.meta.url).pathname;

const SUFFIX = ".tmpl";

// 앱 템플릿이 반드시 가지는 파일. 이것이 빠진 폴더는 템플릿이 아니다.
export const REQUIRED_TEMPLATE_FILES = [
  "main.ts",
  "lophn.ts",
  "deno.json",
  "deno.lock",
  "AGENTS.md",
  "CLAUDE.md",
  ".gitignore",
] as const;

export function sortTemplateFiles(
  files: readonly TemplateFile[],
): TemplateFile[] {
  return [...files].sort((
    a,
    b,
  ) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// 폴더의 파일을 읽는다. symlink는 건너뛴다.
export async function readTemplateDirectory(
  directory: string,
  options: { stripSuffix?: boolean } = {},
): Promise<Result<TemplateFile[], TemplateFailure>> {
  const files: TemplateFile[] = [];
  async function visit(dir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(`${dir}/${entry.name}`, path);
      else if (entry.isFile()) {
        const name = options.stripSuffix && path.endsWith(SUFFIX)
          ? path.slice(0, -SUFFIX.length)
          : path;
        files.push({
          path: name,
          bytes: await readFile(`${dir}/${entry.name}`),
        });
      }
    }
  }
  try {
    await visit(directory, "");
  } catch {
    return err({
      code: "not_found",
      message: `template directory is unreadable: ${directory}`,
    });
  }
  const sorted = sortTemplateFiles(files);
  for (const required of REQUIRED_TEMPLATE_FILES) {
    if (!sorted.some((file) => file.path === required)) {
      return err({
        code: "invalid_input",
        message: `template has no ${required}`,
      });
    }
  }
  return ok(sorted);
}

// 내장 템플릿. 저장소 원본에서 접미를 떼어 읽는다.
export function builtinTemplate(
  directory: string = BUILTIN_TEMPLATE_DIRECTORY,
): Promise<Result<TemplateFile[], TemplateFailure>> {
  return readTemplateDirectory(directory, { stripSuffix: true });
}
