// kinds 파일 글을 검사해 쓸 kind를 정한다. 순수 함수다.
import { parse as parseYaml } from "yaml";
import {
  checkKindsStructure,
  type Kind,
  type KindsFile,
  type KindsFileError,
  kindsFileSchema,
} from "../../../../protocol/projects/mod.ts";
import { kindMatcher } from "../extract/glob.ts";
import { sha256Text } from "../index/hash.ts";

export type AppliedKinds = { hash: string; kinds: Kind[] };

export type KindsApplication = {
  state: "none" | "valid" | "invalid";
  using: "current" | "previous" | "none";
  kinds: Kind[] | null;
  errors: KindsFileError[];
  // 쓰고 있는 kinds 파일 글의 hash
  hash: string | null;
};

const oneLine = (text: string) => text.replace(/[\r\n]+/g, " ").slice(0, 300);

// yaml 문법과 schema만 본다. 실패하면 오류 message(값 원문 없이 zod issue 경로만).
export function parseKindsText(
  text: string,
): { ok: true; file: KindsFile } | { ok: false; message: string } {
  let value: unknown;
  try {
    value = parseYaml(text, { schema: "core" });
  } catch {
    return { ok: false, message: "kinds file is not valid YAML" };
  }
  const parsed = kindsFileSchema.safeParse(value);
  if (parsed.success) return { ok: true, file: parsed.data };
  const paths = [
    ...new Set(
      parsed.error.issues.map((issue) => issue.path.join(".") || "(root)"),
    ),
  ].slice(0, 5);
  return {
    ok: false,
    message: oneLine(
      `kinds file does not match the schema at ${paths.join(", ")}`,
    ),
  };
}

// files는 겹침 판정이 필요할 때만 부른다(실제 파일 목록을 읽는 값이 비싸다).
// 저장해 둔 맞던 kinds 파일 글에서 kind를 꺼낸다.
export function kindsOfText(text: string): Kind[] | null {
  const parsed = parseKindsText(text);
  return parsed.ok ? parsed.file.kinds : null;
}

export function applyKindsFile(input: {
  text: string | null;
  previous: AppliedKinds | null;
  files: (kinds: Kind[]) => readonly string[];
}): KindsApplication {
  const { text, previous } = input;
  if (text === null) {
    return {
      state: "none",
      using: "none",
      kinds: null,
      errors: [],
      hash: null,
    };
  }
  const hash = sha256Text(text);
  const parsed = parseKindsText(text);
  let errors: KindsFileError[];
  if (!parsed.ok) {
    errors = [{
      rule: "kinds_syntax",
      kind: null,
      field: null,
      message: parsed.message,
    }];
  } else {
    errors = checkKindsStructure(parsed.file);
    // 문서가 나중에 겹치는 것은 문서 위반(overlap)이다. kinds 파일 오류는 파일이 바뀔 때만 낸다.
    if (errors.length === 0 && hash !== previous?.hash) {
      errors = overlapErrors(parsed.file.kinds, input.files(parsed.file.kinds));
    }
  }
  if (!parsed.ok || errors.length > 0) {
    return {
      state: "invalid",
      using: previous ? "previous" : "none",
      kinds: previous?.kinds ?? null,
      errors,
      hash: previous?.hash ?? null,
    };
  }
  return {
    state: "valid",
    using: "current",
    kinds: parsed.file.kinds,
    errors: [],
    hash,
  };
}

// 겹치는 kind 쌍마다 파일 하나를 보기로 든다.
function overlapErrors(
  kinds: Kind[],
  files: readonly string[],
): KindsFileError[] {
  const matching = kindMatcher(kinds);
  const seen = new Set<string>();
  const errors: KindsFileError[] = [];
  for (const path of files) {
    const [first, second] = matching(path);
    if (first === undefined || second === undefined) continue;
    const pair = `${first.name}\u0000${second.name}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    errors.push({
      rule: "glob_overlap",
      kind: first.name,
      field: null,
      message: oneLine(
        `file ${path} matches both kind ${first.name} and kind ${second.name}`,
      ),
    });
  }
  return errors;
}
