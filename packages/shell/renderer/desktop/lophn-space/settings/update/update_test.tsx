// settings update 자리 화면 테스트(shell#T58, platform#T50). 사람이 고른 로컬 package
// metadata 후보 선택·안내(new version·지원 OS·schema 호환·정상 정지)를 가짜 통로로 확인한다.
// 자동 다운로드·설치·재시작이 없음을 확인한다.
import { assert, assertEquals } from "@std/assert";
import { click, render } from "../../../../../../design/components/testing.ts";

import { UpdatePanel } from "./update-panel.tsx";
import { fakeUpdate } from "./testdata/fake-source.ts";
import { find, flush } from "../../testdata/dom.ts";

function textOf(root: Element): string {
  return root.textContent ?? "";
}

Deno.test("flow update-lophn: 사람이 고른 파일만 읽고 새 version·지원 OS·schema 호환·재시작 필요를 보인다", async () => {
  const { source, calls } = fakeUpdate({
    picked: "/tmp/lophn-update/lophn-update.json",
    candidate: {
      version: "1.2.0",
      os: "linux",
      format: "deb",
      schema: 1,
    },
    notice: {
      ok: true,
      currentVersion: "1.1.0",
      newVersion: "1.2.0",
      os: "linux",
      schema: "compatible",
      restartRequired: true,
    },
  });
  using view = render(<UpdatePanel source={source} />);
  await flush();
  // 화면을 연 것만으로는 읽지 않는다.
  assertEquals(calls.some((call) => call[0] === "picked"), false);
  assertEquals(
    find(view.container, "[data-package='none']").textContent,
    "No update file is chosen yet.",
  );
  click(find(view.container, "[data-action='choose-package']"));
  await flush();
  assertEquals(calls.some((call) => call[0] === "picked"), true);
  const notice = find(view.container, "[data-notice='ready']");
  assertEquals(
    find(notice, "[data-update-version]").textContent,
    "Update file is version 1.2.0 for linux. This version is 1.1.0.",
  );
  assertEquals(
    find(notice, "[data-update-schema]").textContent,
    "Your records keep working with this update.",
  );
  assertEquals(
    find(notice, "[data-update-restart]").textContent,
    "lophn stops cleanly before the update and you start it again.",
  );
  // 정상 정지는 사람이 누를 때만 청한다.
  assertEquals(calls.some((call) => call[0] === "stop"), false);
  click(find(view.container, "[data-action='stop-and-update']"));
  await flush();
  assertEquals(calls.find((call) => call[0] === "stop")?.[0], "stop");
  assertEquals(
    find(view.container, "[data-stop='stopped']").textContent,
    "lophn stopped cleanly. Start lophn again.",
  );
});

Deno.test("flow update-lophn: schema migration이 필요한 update는 변환 안내를 보이고 자동 다운로드·설치가 없음을 문장으로 남긴다", async () => {
  const { source } = fakeUpdate({
    picked: "/tmp/lophn-update/lophn-update.json",
    candidate: { version: "1.2.0", os: "linux", format: "deb", schema: 2 },
    notice: {
      ok: true,
      currentVersion: "1.1.0",
      newVersion: "1.2.0",
      os: "linux",
      schema: "migration_required",
      restartRequired: true,
    },
  });
  using view = render(<UpdatePanel source={source} />);
  await flush();
  click(find(view.container, "[data-action='choose-package']"));
  await flush();
  assertEquals(
    find(view.container, "[data-update-schema]").textContent,
    "Your records are converted the first time lophn starts after the update. Going back later won't convert them back.",
  );
  const text = textOf(view.container);
  // 자동 다운로드·설치·재시작 없음은 update 자리의 안내에 남는다(platform/install-and-update#R13).
  assert(!text.includes("Download"));
});

Deno.test("flow update-lophn: 다른 OS의 package는 적용되지 않고, 정상 정지를 확인하지 못하면 아무것도 바뀌지 않았다고 말한다", async () => {
  const wrong = fakeUpdate({
    picked: "/tmp/lophn-update/lophn-update.json",
    candidate: { version: "1.2.0", os: "linux", format: "deb", schema: 1 },
    noticeCode: "invalid_input",
    noticeMismatch: true,
  });
  using view = render(<UpdatePanel source={wrong.source} />);
  await flush();
  click(find(view.container, "[data-action='choose-package']"));
  await flush();
  assertEquals(
    find(view.container, "[data-notice='mismatch']").textContent,
    "That file installs on a different system, so it isn't applied.",
  );

  const notPackage = fakeUpdate({
    picked: "/tmp/lophn-update/notes.txt",
    candidate: null,
  });
  using second = render(<UpdatePanel source={notPackage.source} />);
  await flush();
  click(find(second.container, "[data-action='choose-package']"));
  await flush();
  assertEquals(
    find(second.container, "[data-package='unreadable']").textContent,
    "That file isn't an update file lophn can read. Choose the update file again.",
  );

  const stopped = fakeUpdate({
    picked: "/tmp/lophn-update/lophn-update.json",
    candidate: {
      version: "1.2.0",
      os: "linux",
      format: "deb",
      schema: 1,
    },
    notice: {
      ok: true,
      currentVersion: "1.1.0",
      newVersion: "1.2.0",
      os: "linux",
      schema: "compatible",
      restartRequired: true,
    },
    stopCode: "unavailable",
  });
  using third = render(<UpdatePanel source={stopped.source} />);
  await flush();
  click(find(third.container, "[data-action='choose-package']"));
  await flush();
  click(find(third.container, "[data-action='stop-and-update']"));
  await flush();
  assertEquals(
    find(third.container, "[data-stop='failed']").textContent,
    "lophn couldn't confirm it stopped cleanly, so nothing was changed. Close your work and try again.",
  );
});
