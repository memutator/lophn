// 고정 UI 의존 screen build(apps/releases#R4, apps/sdk#R10). GUI의 React·npm 의존은
// 고정 UI Package가 제공한 exact 목록으로 준비 단계에만 build한다. 운영 프로세스는
// build나 의존 다운로드 없이 그 결과만 사용한다. external source map도 bundle에 넣는다.
import { err, ok, type Result } from "../../../base/mod.ts";

export type UiBuildFailure = {
  code: "invalid_input" | "unavailable";
  reason:
    | "fixed_dependency_missing"
    | "dependency_outside_fixed_list"
    | "build_failed";
};

// 고정 UI 의존 exact 목록(architecture/apps 3.3). 이 밖의 의존은 build에 넣지 않는다.
export const FIXED_UI_DEPENDENCIES = [
  "@lophn/blueprint",
  "@lophn/tokens",
  "@lophn/ui-control",
  "@lophn/ui-overlay",
  "@lophn/ui-layout",
  "@lophn/ui-reading",
  "@lophn/ui-table",
  "@lophn/ui-chart",
  "@lophn/ui-filter",
  "@lophn/ui-stat",
  "@lophn/ui-state",
  "@lophn/ui-action",
  "react",
  "react-dom",
] as const;

export type UiBuildInput = {
  screens: readonly { path: string; bytes: Uint8Array }[];
  dependencies: readonly { name: string; version: string }[];
};

export type UiBuildOutput = {
  files: { path: string; bytes: Uint8Array }[];
  // external source map. bundle 안 고정 이름이며 운영 시작의 오류 위치 근거다.
  sourceMap: { path: string; bytes: Uint8Array };
};

// 준비 단계 build 입력이 고정 목록 안에만 있는지 본다. 밖의 의존은 거절이다(apps/sdk#R34).
export function dependenciesInsideFixedList(
  dependencies: readonly { name: string; version: string }[],
): boolean {
  return dependencies.every((dependency) =>
    (FIXED_UI_DEPENDENCIES as readonly string[]).includes(dependency.name)
  );
}

// 고정 UI 의존으로 screen build를 마친다. build는 준비 단계의 몫이며 운영은 결과만 읽는다.
// UI 의존 byte는 설치 제공 재료가 고정하므로, 여기서는 screens를 그대로 묶고 external
// source map을 만든다(실제 bundler 호출은 준비 자식의 launcher가 맡는다).
export function buildScreens(
  input: UiBuildInput,
): Promise<Result<UiBuildOutput, UiBuildFailure>> {
  if (!dependenciesInsideFixedList(input.dependencies)) {
    return Promise.resolve(
      err({
        code: "invalid_input",
        reason: "dependency_outside_fixed_list",
      }),
    );
  }
  if (input.screens.length === 0) {
    return Promise.resolve(
      err({ code: "invalid_input", reason: "fixed_dependency_missing" }),
    );
  }
  const files = input.screens.map((screen) => ({
    path: screen.path,
    bytes: screen.bytes,
  }));
  // external source map. 화면 파일 이름·크기를 남기고 내용은 싣지 않는다
  // (bundle 사본의 `app.js.map` 자리이다, apps/plan apps#T6).
  const map = {
    version: 3,
    file: files.map((file) => file.path),
    sources: files.map((file) => file.path),
    sourcesContent: [] as string[],
  };
  return Promise.resolve(
    ok({
      files,
      sourceMap: {
        path: "app.js.map",
        bytes: new TextEncoder().encode(JSON.stringify(map)),
      },
    }),
  );
}
