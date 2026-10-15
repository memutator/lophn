// 고정 UI 의존 screen build. GUI의 React·npm 의존은
// 고정 UI Package가 제공한 exact 목록으로 준비 단계에만 build한다. 운영 프로세스는
// build나 의존 다운로드 없이 그 결과만 사용한다. external source map도 bundle에 넣는다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { relativePathSchema } from "../../../../protocol/projects/mod.ts";

export type UiBuildFailure = {
  code: "invalid_input" | "unavailable";
  reason:
    | "fixed_dependency_missing"
    | "dependency_outside_fixed_list"
    | "build_failed";
};

// 고정 UI 의존 exact 목록. 이 밖의 의존은 build에 넣지 않는다.
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
  // 공용 UI Package가 import하는 지원 소스(apps/sdk 설치 사본). 같은 판으로 고정해 bundle에 담는다.
  "@lophn/design",
  "@lophn/chart",
  "@lophn/wording",
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

// 준비 단계 build 입력이 고정 목록 안에만 있는지 본다. 밖의 의존은 거절이다.
export function dependenciesInsideFixedList(
  dependencies: readonly { name: string; version: string }[],
): boolean {
  return dependencies.every((dependency) =>
    (FIXED_UI_DEPENDENCIES as readonly string[]).includes(dependency.name)
  );
}

type SourceMap = {
  version: number;
  file?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
};

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// 고정 UI 의존으로 screen을 실제 bundle과 external source map으로 만든다.
// esbuild는 준비 단계에서만 돈다. 운영 프로세스는 이 결과를 읽기만 한다.
export async function buildScreens(
  input: UiBuildInput,
): Promise<Result<UiBuildOutput, UiBuildFailure>> {
  if (!dependenciesInsideFixedList(input.dependencies)) {
    return err({
      code: "invalid_input",
      reason: "dependency_outside_fixed_list",
    });
  }
  if (input.screens.length === 0) {
    return err({ code: "invalid_input", reason: "fixed_dependency_missing" });
  }
  for (const screen of input.screens) {
    if (!relativePathSchema.safeParse(screen.path).success) {
      return err({ code: "invalid_input", reason: "build_failed" });
    }
  }
  const files: { path: string; bytes: Uint8Array }[] = [];
  const maps: SourceMap[] = [];
  try {
    for (const screen of input.screens) {
      // esbuild는 ESBUILD_BINARY_PATH를 모듈 로드 때 읽는다. 정적 import면
      // env 권한이 없는 worker(platform/io)도 이 그래프에서 시작이 죽는다.
      const esbuild = await import("esbuild");
      const built = await esbuild.build({
        stdin: {
          contents: decode(screen.bytes),
          sourcefile: screen.path,
          loader: "js",
        },
        bundle: true,
        write: false,
        format: "esm",
        // external source map은 출력 경로가 있어야 한다. write:false라 디스크에는 안 쓴다.
        outfile: screen.path,
        sourcemap: "external",
        sourcesContent: true,
        external: [...FIXED_UI_DEPENDENCIES],
      });
      const js = built.outputFiles.find((file) => file.path.endsWith(".js"));
      const map = built.outputFiles.find((file) => file.path.endsWith(".map"));
      if (!js || !map) {
        return err({ code: "unavailable", reason: "build_failed" });
      }
      files.push({ path: screen.path, bytes: js.contents });
      const parsed = JSON.parse(decode(map.contents)) as SourceMap;
      parsed.sources = parsed.sources.map((source) =>
        source.endsWith(screen.path) ? screen.path : source
      );
      maps.push(parsed);
    }
  } catch {
    return err({ code: "unavailable", reason: "build_failed" });
  }
  const merged: SourceMap = {
    version: 3,
    file: input.screens.map((screen) => screen.path).join(","),
    sources: maps.flatMap((map) => map.sources),
    sourcesContent: maps.flatMap((map) => map.sourcesContent ?? []),
  };
  if (
    merged.sourcesContent?.length !== merged.sources.length ||
    merged.sourcesContent.some((content) =>
      content === null || content === undefined
    )
  ) {
    return err({ code: "unavailable", reason: "build_failed" });
  }
  return ok({
    files,
    sourceMap: {
      path: "app.js.map",
      bytes: new TextEncoder().encode(JSON.stringify(merged)),
    },
  });
}
