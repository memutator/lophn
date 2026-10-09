// flow update-lophn 1단계(docs/flows/update-lophn.md). 실제 shell(headless)·core를 임시
// LOPHN_HOME으로 띄운다. 실제 ~/.lophn은 열지 않는다.
// settings에서 이 OS의 설치 패키지를 확인하고 사람이 고른 로컬 metadata로 수동 update를
// 고른다. 자동 다운로드·자동 설치·사용 중 재시작은 없고, 검증하지 않은 배포를 사용 가능한
// 완료로 안내하지 않는다. 2–8단계는 보지 않는다.
import { assert, assertEquals } from "@std/assert";

import { e2eEnabled } from "../harness.ts";
import {
  type FlowShell,
  mustCall,
  openFlowShell,
  removeHome,
} from "../flow-support.ts";

const OFFERED = "0.9.0";
const UNVERIFIED =
  "Updates on your system aren't checked by lophn yet. Check the file before applying it.";

function formatOf(os: string): string {
  if (os === "linux") return "deb";
  if (os === "darwin") return "dmg";
  if (os === "windows") return "exe";
  throw new Error(`이 테스트가 모르는 OS다: ${os}`);
}

async function openUpdate(flow: FlowShell): Promise<void> {
  await flow.until(
    `document.querySelector("[data-screen-body='settings']") !== null`,
    "settings가 서지 않았다",
  );
  await flow.until(
    `[...document.querySelectorAll("[role=tab]")].some((el) => el.textContent.trim() === "Update lophn")`,
    "settings에 Update 탭이 없다",
  );
  await flow.mouseClickText("[role=tab]", "Update lophn");
  await flow.until(
    `document.querySelector("[data-update]") !== null`,
    "update 자리가 열리지 않았다",
  );
}

async function platformStatus(flow: FlowShell): Promise<{
  schema: number;
  ledgerId: string;
}> {
  const status = await mustCall(flow, {
    kind: "read",
    resource: "platform",
    method: "status",
    body: {},
  });
  const schema = status.schema;
  const ledgerId = status.ledger_id;
  assert(typeof schema === "number" && Number.isInteger(schema) && schema > 0);
  assert(typeof ledgerId === "string" && ledgerId !== "");
  assertEquals(status.ready, true);
  return { schema, ledgerId };
}

Deno.test({
  name:
    "platform/install-and-update#R1 platform/install-and-update#R13 flow update-lophn 1: settings에서 이 OS의 설치 패키지를 확인하고 수동 update를 고른다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const os = Deno.build.os;
    const format = formatOf(os);
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-update-" });
    await Deno.chmod(home, 0o700);
    const pack = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-update-pkg-" }),
    );
    const metadata = `${pack}/lophn-update.json`;
    let opened: FlowShell | undefined;
    try {
      const flow = await openFlowShell({
        home,
        start: "settings",
        pickFolder: metadata,
      });
      opened = flow;
      await openUpdate(flow);
      assertEquals(
        (await flow.text("[data-package='none']"))?.trim(),
        "No update file is chosen yet.",
      );
      assertEquals((await flow.text("[data-deployment]"))?.trim(), UNVERIFIED);
      assertEquals(await flow.count("[data-action='choose-package']"), 1);
      assertEquals(await flow.count("[data-action='stop-and-update']"), 0);
      assertEquals(await flow.count("[data-notice='ready']"), 0);
      const beforeChoose = String(await flow.text("[data-update]"));
      assert(
        beforeChoose.includes(
          "You choose when to update. lophn doesn't download or restart by itself.",
        ),
      );
      assert(!beforeChoose.includes("Download"));
      const before = await platformStatus(flow);
      const body = JSON.stringify({
        version: OFFERED,
        os,
        format,
        schema: before.schema,
      });
      await Deno.writeTextFile(metadata, body);
      await flow.click("[data-action='choose-package']");
      await flow.until(
        `document.querySelector("[data-notice='ready']") !== null`,
        "수동 update 안내가 오지 않았다",
      );
      const version = (await flow.text("[data-update-version]"))?.trim() ?? "";
      const prefix =
        `Update file is version ${OFFERED} for ${os}. This version is `;
      assert(version.startsWith(prefix), version);
      const current = version.slice(prefix.length).replace(/\.$/, "");
      assert(current !== "" && current !== OFFERED, version);
      assertEquals(
        (await flow.text("[data-update-schema]"))?.trim(),
        "Your records keep working with this update.",
      );
      assertEquals(
        (await flow.text("[data-update-restart]"))?.trim(),
        "lophn stops cleanly before the update and you start it again.",
      );
      assertEquals((await flow.text("[data-deployment]"))?.trim(), UNVERIFIED);
      const afterChoose = String(await flow.text("[data-update]"));
      assert(!afterChoose.includes("Download"));
      assert(!afterChoose.includes("verified"));
      assertEquals(await flow.count("[data-stop]"), 0);
      assertEquals(await Deno.readTextFile(metadata), body);
      const after = await platformStatus(flow);
      assertEquals(after.ledgerId, before.ledgerId);
      assertEquals(after.schema, before.schema);
      assert((await Deno.stat(`${home}/lophn.db`)).isFile);
    } finally {
      await opened?.close();
      await removeHome(home);
      await Deno.remove(pack, { recursive: true });
    }
  },
});
