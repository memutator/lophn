// 템플릿 선택 순서: 사람이 명시한 `LOPHN_APP_TEMPLATE` → 설치 `templates/app` → 내장 검증
// 템플릿. 명시한 override는 사람의 선택이라 hash를 묻지 않지만 템플릿 모양이 아니면 조용히 다른 후보로
// 넘어가지 않고 실패한다. 설치 사본과 내장 템플릿은 고정 hash와 byte가 같아야 쓴다. 설치 사본이 다르면
// 쓰지 않고 이유를 남긴 채 내장 템플릿으로 간다. 내장 템플릿이 고정 hash와 다르면 실패다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  builtinTemplate,
  readTemplateDirectory,
  type TemplateFailure,
  type TemplateFile,
  templateHash,
} from "./files.ts";
import { TEMPLATE_HASH } from "./pin.ts";

export type TemplateSource = "override" | "installed" | "builtin";

export type ResolvedTemplate = {
  source: TemplateSource;
  files: TemplateFile[];
  hash: string;
  // override와 설치 사본의 폴더. 내장 템플릿은 저장소 원본이라 null이다.
  location: string | null;
  // 설치 사본이 있었지만 쓰지 않은 이유. 앱 만들기가 알려 준다.
  skipped: { source: "installed"; reason: string } | null;
};

export type ResolveTemplateInput = {
  env: { get(name: string): string | undefined };
  // lophn data root. 설치 템플릿은 `<home>/templates/app`이다.
  home: string;
  // 고정 hash. 기본은 이 판의 내장 템플릿 hash다.
  pinnedHash?: string;
  // 내장 템플릿 폴더. 시험이 바꾼다.
  builtinDirectory?: string;
};

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveTemplate(
  input: ResolveTemplateInput,
): Promise<Result<ResolvedTemplate, TemplateFailure>> {
  const pinned = input.pinnedHash ?? TEMPLATE_HASH;
  const override = input.env.get("LOPHN_APP_TEMPLATE")?.trim();
  if (override) {
    const read = await readTemplateDirectory(override);
    if (!read.ok) return read;
    return ok({
      source: "override",
      files: read.value,
      hash: await templateHash(read.value),
      location: override,
      skipped: null,
    });
  }

  let skipped: ResolvedTemplate["skipped"] = null;
  const installed = `${input.home}/templates/app`;
  if (await exists(installed)) {
    const read = await readTemplateDirectory(installed);
    if (!read.ok) {
      skipped = { source: "installed", reason: read.error.message };
    } else {
      const hash = await templateHash(read.value);
      if (hash === pinned) {
        return ok({
          source: "installed",
          files: read.value,
          hash,
          location: installed,
          skipped: null,
        });
      }
      skipped = {
        source: "installed",
        reason: "installed template does not match the pinned hash",
      };
    }
  }

  const builtin = await builtinTemplate(input.builtinDirectory);
  if (!builtin.ok) return builtin;
  const hash = await templateHash(builtin.value);
  if (hash !== pinned) {
    return err({
      code: "unavailable",
      message: "built-in template does not match its pinned hash",
    });
  }
  return ok({
    source: "builtin",
    files: builtin.value,
    hash,
    location: null,
    skipped,
  });
}
