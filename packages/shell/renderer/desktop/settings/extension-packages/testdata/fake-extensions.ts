// Settings › Extensions 화면의 가짜 통로. main IPC(`lophnExtensions`)를 메모리로 대신한다. 켜기·끄기는 설정 쓰기라
// 여기 없고, 켜짐 여부는 fake settings의 `extensions.<id>.enabled` 선언이 정한다.
import type {
  ExtensionsApi,
  ExtensionView,
} from "../../../../../ipc/extensions.ts";
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

export function fakeExtensions(
  views: readonly ExtensionView[] = SAMPLE_EXTENSIONS,
) {
  const calls: unknown[][] = [];
  let rows = [...views];
  const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
  const api: ExtensionsApi = {
    list: () => ok(rows),
    install(id) {
      calls.push(["install", id]);
      rows = rows.map((row) =>
        row.id === id ? { ...row, installed: true } : row,
      );
      return ok(null);
    },
    remove(id) {
      calls.push(["remove", id]);
      rows = rows.map((row) =>
        row.id === id ? { ...row, installed: false, status: "off" } : row,
      );
      return ok(null);
    },
    run: () => ok(null),
  };
  // 목록의 id마다 `extensions.<id>.enabled` 선언이 있어야 화면이 켜짐을 읽는다.
  const settings = views.map((view) =>
    declared(
      enabledKey(view.id),
      { type: "boolean" },
      { default: false, chosen: view.status === "on" },
    ),
  );
  return { api, calls, settings };
}
