// check 시험이 함께 쓰는 fixture 입력. 제품 코드는 import하지 않는다.
import { inlineFiles, loadAppData, loadFixture } from "../extract/testing.ts";
import type { ProjectFiles } from "../extract/types.ts";
import { sampleEnv } from "../validate/sample.ts";
import type { CheckInput } from "./types.ts";

const testdata = new URL("../testdata/", import.meta.url);

export const FIXTURE_EXPECTED_VIOLATIONS = 7;

// fixture 계약 JSON(예 둘은 eval-project 파일에 맞는다).
// deno-lint-ignore no-explicit-any
export function fixtureRaw(): any {
  return JSON.parse(
    Deno.readTextFileSync(new URL("eval-project.contract.json", testdata)),
  );
}

export function fixtureExpected(): unknown[] {
  const read = (name: string) =>
    JSON.parse(
      Deno.readTextFileSync(new URL(`expected/${name}.json`, testdata)),
    );
  return [
    ...read("eval-project.extract-violations"),
    ...read("eval-project.rule-violations"),
  ];
}

// 계약 JSON을 edit으로 바꾸고 fixture 파일 위에서 검사할 입력을 만든다.
export function inputOf(
  // deno-lint-ignore no-explicit-any
  edit: (raw: any) => void = () => {},
  files: ProjectFiles = loadFixture("eval-project"),
): CheckInput {
  const raw = fixtureRaw();
  edit(raw);
  return {
    bundle: raw,
    files,
    appData: loadAppData("eval-project"),
    env: sampleEnv(),
    user_saved_views: [],
  };
}

// fixture 파일에 파일을 더한 snapshot.
export function filesWith(extra: Record<string, string>): ProjectFiles {
  const base = loadFixture("eval-project");
  const all: Record<string, string> = {};
  for (const path of base.paths()) all[path] = base.read(path) ?? "";
  return inlineFiles({ ...all, ...extra });
}
