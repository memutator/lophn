// Settings › Extensions 화면의 가짜 route 답. `extensions/*`를 가짜 core의 답으로 메모리에 둔다. 켜기·끄기는 설정 쓰기라
// 여기 없고, 켜짐 여부는 fake settings의 `extensions.<id>.enabled` 선언이 정한다.
import {
  type ExtensionView,
  extensionsInstall,
  extensionsList,
  extensionsRemove,
  extensionsRun,
} from "../../../../../../protocol/extensions/routes.ts";
import { fakeAnswer } from "../../../connection/events/fake-source.ts";
import type { FakeCore } from "../../testdata/fake-core.ts";
import { declared } from "../../testdata/fake-settings.ts";
import { enabledKey } from "../model.ts";

/** 화면 확인용 목록: 켜짐, 설치했지만 꺼짐, 설치 안 됨이 하나씩이다. */
export const SAMPLE_EXTENSIONS: readonly ExtensionView[] = [
  {
    id: "harness-gui",
    name: "Harness GUI",
    description:
      "Shows a terminal tab running Claude Code, Codex, OpenCode or omp as a lophn chat screen with `<harness> gui`.",
    status: "on",
    installed: true,
  },
  {
    id: "harness",
    name: "Harness agents",
    description:
      "Runs Claude Code, Codex and OpenCode as lophn agents with their headless commands.",
    status: "off",
    installed: true,
  },
  {
    id: "demo",
    name: "Demo",
    description: "Adds a sample command to the palette.",
    status: "off",
    installed: false,
  },
];

/** 답을 가짜 core에 더한다. 돌려준 settings는 목록의 id마다 `extensions.<id>.enabled` 선언이다. */
export function fakeExtensions(
  core: FakeCore,
  views: readonly ExtensionView[] = SAMPLE_EXTENSIONS,
) {
  let rows = [...views];
  core.answers.push(
    fakeAnswer(extensionsList, () => ({ extensions: rows })),
    fakeAnswer(extensionsInstall, ({ id }) => {
      rows = rows.map((row) =>
        row.id === id ? { ...row, installed: true } : row,
      );
      return {};
    }),
    fakeAnswer(extensionsRemove, ({ id }) => {
      rows = rows.map((row) =>
        row.id === id ? { ...row, installed: false, status: "off" } : row,
      );
      return {};
    }),
    fakeAnswer(extensionsRun, {}),
  );
  // 목록의 id마다 `extensions.<id>.enabled` 선언이 있어야 화면이 켜짐을 읽는다.
  return views.map((view) =>
    declared(
      enabledKey(view.id),
      { type: "boolean" },
      { default: false, chosen: view.status === "on" },
    ),
  );
}
