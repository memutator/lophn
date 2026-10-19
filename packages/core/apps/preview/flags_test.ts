import { assertEquals } from "@std/assert";
import { previewFlagsViolation } from "./flags.ts";
import type { PreviewLaunch } from "./model.ts";

const nonce = "n1";
const root = "/home/u/.lophn";
const dataPath = `${root}/apps/app_1/preview/${nonce}`;
const live = `${root}/apps/app_1/data`;

const launch = (args: string[]) =>
  ({
    app: "app_1",
    nonce,
    dataPath,
    flags: { args, limits: [] },
  }) as unknown as PreviewLaunch;

// contract: preview는 자기 일회용 폴더 안에만 쓰고 운영 data를 읽지 못하며 net을 열지 못한다(AI가 만든 코드의 sandbox 경계).
// 현실적 회귀: 검사가 DB file 경로를 폴더 자체와 비교해 실제 bundle의 preview가 늘 거절됐다.
// 왜 지금 못 잡나: 이 규칙을 flag 표로 보는 test가 없고 손 확인에서 처음 드러났다.
Deno.test("preview flags는 일회용 폴더 안의 쓰기만 받고 그 밖 쓰기와 운영 data 읽기와 net은 거절한다", () => {
  const db = `${dataPath}/app.sqlite`;
  const rows: [string, string[], boolean][] = [
    ["DB file과 socket", [
      `--allow-write=${db},${db}-wal,${db}-shm,${dataPath}/s.sock`,
    ], true],
    ["폴더 자체", [`--allow-write=${dataPath}`], true],
    ["운영 data 쓰기", [`--allow-write=${live}/app.sqlite`], false],
    ["폴더 밖 쓰기 섞임", [`--allow-write=${db},${root}/x`], false],
    ["이름만 같은 옆 폴더", [`--allow-write=${dataPath}x/app.sqlite`], false],
    ["..로 나감", [`--allow-write=${dataPath}/../data/app.sqlite`], false],
    ["운영 data 읽기", [`--allow-read=${live}`], false],
    ["운영 data 위 폴더 읽기", [`--allow-read=${root}/apps`], false],
    ["bundle 읽기", [`--allow-read=${root}/apps/app_1/bundle`], true],
    ["net", ["--allow-net=example.com"], false],
  ];
  for (const [name, args, ok] of rows) {
    assertEquals(
      previewFlagsViolation(launch(args)) === undefined,
      ok,
      name,
    );
  }
});
