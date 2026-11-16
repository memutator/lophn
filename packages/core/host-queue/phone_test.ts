import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import { PHONE_TAB_TEXT } from "../../protocol/phone/drive.ts";
import { createPhoneDriver, type PreviewView } from "./phone.ts";
import type { PhoneTab } from "./queue.ts";

const APP = "app_00000000000000000000000001";

// 옛 ref나 다른 view의 ref가 폰에 가면 폰이 새 화면의 엉뚱한 칸을 누를 수 있다(node 번호는 view·snapshot마다 다시 매긴다).
test("마지막 snapshot이 아닌 ref와 다른 view의 ref는 폰에 묻지 않고 conflict다", async () => {
  let views: PreviewView[] = [
    { owner: "device:dev_1", view: "view-0001", screen: "home", used: 1 },
  ];
  const calls: { kind: string; input: unknown }[] = [];
  let snapshots = 0;
  const driver = createPhoneDriver({
    previewViews: () => views,
    call: (request) => {
      calls.push({ kind: request.kind, input: request.input });
      if (request.kind !== "drive.snapshot") return Promise.resolve(ok({}));
      snapshots += 1;
      return Promise.resolve(
        ok({
          snapshot: `s${snapshots}`,
          width_dp: 400,
          height_dp: 800,
          nodes: [{ node: 5, depth: 0, role: "button", name: "Go", flags: [] }],
        }),
      );
    },
    redact: (text) => text,
  });
  const tab: PhoneTab = { app: APP, screen: null, counter: 0, last: null };
  const conflict = (reply: unknown) => {
    const failed = reply as {
      ok: boolean;
      error: { code: string; message: string };
    };
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, "conflict");
    assert.equal(failed.error.message, PHONE_TAB_TEXT.staleRef);
  };

  // snapshot 전에는 ref가 없다.
  conflict(await driver.act(tab, "a", { type: "click", ref: "e1" }));
  assert.ok((await driver.snapshot(tab, "a")).ok);
  assert.ok((await driver.snapshot(tab, "a")).ok);
  // 첫 snapshot의 e1은 낡았다. 둘째의 e2만 된다.
  conflict(await driver.act(tab, "a", { type: "click", ref: "e1" }));
  assert.ok((await driver.act(tab, "a", { type: "click", ref: "e2" })).ok);
  assert.deepEqual(calls.at(-1)?.input, {
    view: "view-0001",
    by: "a",
    snapshot: "s2",
    act: { type: "click", node: 5 },
  });
  const asked = calls.length;
  // 사람이 preview를 닫고 다시 열어 view가 바뀌었다(다른 기기도 같다). 옛 view의 ref는 새 view에 가지 않는다.
  views = [
    { owner: "device:dev_1", view: "view-0002", screen: "home", used: 2 },
  ];
  conflict(await driver.act(tab, "a", { type: "click", ref: "e2" }));
  conflict(await driver.act(tab, "a", { type: "scroll", dy: 100 }));
  views = [
    { owner: "device:dev_2", view: "view-0001", screen: "home", used: 3 },
  ];
  conflict(await driver.act(tab, "a", { type: "click", ref: "e2" }));
  assert.equal(calls.length, asked);
});
