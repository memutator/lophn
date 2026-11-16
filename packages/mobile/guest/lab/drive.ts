// The lab's drive scenario: runs lophn-drive's API against the drive fixture (guest/fixtures/src/screens/drive) and
// says what came back, with times. Development only; read with logcat (`LAB` lines) and the lab's log.
import { requireOptionalNativeModule } from "expo";
import { File, Paths } from "expo-file-system";
import { Keyboard } from "react-native";
import type { Result } from "../../../base/result.ts";
import type { DriveAct, DriveSnapshotOutput } from "../../../protocol/phone/drive.ts";
import { act, screenshot, snapshot, waitText } from "../../modules/lophn-drive/index.ts";

type Log = (line: string) => void;

const said = <T>(r: Result<T>) =>
  r.ok ? "ok" : `${r.error.code}${r.error.details?.reason ? ` ${String(r.error.details.reason)}` : ""}`;

async function timed<T>(log: Log, label: string, run: () => Promise<Result<T>>, show?: (value: T) => string) {
  const t0 = Date.now();
  const r = await run();
  log(`${label}: ${said(r)} ${Date.now() - t0}ms${r.ok && show ? ` ${show(r.value)}` : ""}`);
  return r;
}

const nodeOf = (s: DriveSnapshotOutput, role: string, name: string) =>
  s.nodes.find((n) => n.role === role && n.name === name)?.node ?? 0;

// Every node with its screen bounds (the raw answer carries them beside the contract's value), for `uiautomator dump`.
export async function dumpNodes(view: string, log: Log) {
  const raw = await requireOptionalNativeModule<{ snapshot(view: string): Promise<string> }>("LophnDrive")?.snapshot(view);
  const a = JSON.parse(raw ?? "{}") as { value?: DriveSnapshotOutput; bounds?: number[][] };
  for (const [i, n] of (a.value?.nodes ?? []).entries()) {
    console.log(`LAB node ${n.node} d${n.depth} ${n.role} ${JSON.stringify(n.name)} [${a.bounds?.[i]?.join(",")}] ${n.flags.join(",")}${n.value !== undefined ? ` value=${JSON.stringify(n.value)}` : ""}`);
  }
  log(`dump ${a.value?.nodes.length ?? 0} nodes ${a.value?.width_dp}x${a.value?.height_dp}dp`);
}

// Both formats, timed, kept in the app's files (drive-shot.jpg, .png) to compare with `adb exec-out screencap`.
export async function shoot(view: string, log: Log) {
  for (const format of ["jpeg", "png"] as const) {
    const shot = await timed(log, `screenshot ${format}`, () => screenshot(view, format), (v) => `${v.width}x${v.height} ${Math.round((v.data_base64.length * 3) / 4 / 1024)}KB`);
    if (shot.ok) {
      const file = new File(Paths.document, `drive-shot.${format === "jpeg" ? "jpg" : "png"}`);
      if (file.exists) file.delete();
      file.write(shot.value.data_base64, { encoding: "base64" });
    }
  }
}

export async function runDrive(view: string, log: Log, unmount: () => Promise<void>) {
  // `ready` comes before the screen's first render.
  await timed(log, "wait first render", () => waitText(view, "presses=", 5000), (v) => `found=${v.found}`);
  let s = (await timed(log, "snapshot", () => snapshot(view), (v) => `${v.nodes.length} nodes id ${v.snapshot}`)) as Result<DriveSnapshotOutput>;
  if (!s.ok) return;
  let last = s.value;
  const fresh = async () => {
    const r = await snapshot(view);
    if (r.ok) last = r.value;
    return last;
  };
  const doAct = (label: string, a: DriveAct, id = last.snapshot) => timed(log, label, () => act(view, id, a));
  const see = (text: string) => timed(log, `wait ${text}`, () => waitText(view, text, 2000), (v) => `found=${v.found}`);

  await doAct("click Save", { type: "click", node: nodeOf(last, "button", "Save") });
  await see("presses=1");
  await doAct("click Star", { type: "click", node: nodeOf(last, "button", "Star") });
  await see("stars=1");
  log(`Name field: ${nodeOf(last, "textbox", "Name") ? "textbox \"Name\"" : "no textbox named Name"}`);
  await doAct("type Name", { type: "type", node: nodeOf(last, "textbox", "Name"), text: "hello" });
  await see("name=hello");
  await doAct("type Name again", { type: "type", node: nodeOf(last, "textbox", "Name"), text: "!" });
  await see("name=hello!");
  await doAct("fill Name", { type: "fill", node: nodeOf(last, "textbox", "Name"), text: "world" });
  await see("name=world");
  await doAct("press Enter", { type: "press", key: "Enter", node: nodeOf(last, "textbox", "Name") });
  await see("submit=world");
  await doAct("type Password", { type: "type", node: nodeOf(last, "textbox", "Password"), text: "hunter2" });
  await see("pwlen=7");
  await new Promise((resolve) => setTimeout(resolve, 600));
  log(`keyboard shown 600 ms after type (no Enter): ${Keyboard.isVisible()}`);
  const withPw = await fresh();
  const pwNode = withPw.nodes.find((n) => n.role === "textbox" && n.name === "Password");
  log(`secure value ${JSON.stringify(pwNode?.value)}; snapshot has the password: ${JSON.stringify(withPw).includes("hunter2")}`);
  await doAct("click Notifications", { type: "click", node: nodeOf(last, "switch", "Notifications") });
  await see("switch=on");
  await doAct("click Week", { type: "click", node: nodeOf(last, "button", "Week") });
  await see("tab=1");
  await doAct("click Agree", { type: "click", node: nodeOf(last, "button", "Agree") });
  await see("ck=true");
  await doAct("type into Save", { type: "type", node: nodeOf(last, "button", "Save"), text: "x" });

  const row59 = last.nodes.find((n) => n.name === "Row 59");
  log(`Row 59 flags [${row59?.flags.join(",")}]`);
  await doAct("scroll to Row 59", { type: "scroll", node: row59?.node ?? 0 });
  await doAct("click Row 59", { type: "click", node: row59?.node ?? 0 });
  await see("row=59");
  await doAct("scroll dy -5000", { type: "scroll", dy: -5000 });
  await fresh();
  const row40 = last.nodes.find((n) => n.name === "Row 40");
  await doAct("click Row 40 (offscreen)", { type: "click", node: row40?.node ?? 0 });
  await see("row=40");
  await doAct("click Row 40 again", { type: "click", node: row40?.node ?? 0 });
  await see("row=40");
  await doAct("scroll dy 300", { type: "scroll", dy: 300 });

  await shoot(view, log);
  await see("row=40");
  await timed(log, "wait nope 500", () => waitText(view, "nope", 500), (v) => `found=${v.found}`);

  await fresh();
  const old = last;
  await doAct("click Replace", { type: "click", node: nodeOf(old, "button", "Replace") });
  await see("gen=1");
  await doAct("click old Row 0 v0", { type: "click", node: nodeOf(old, "button", "Row 0 v0") }, old.snapshot);
  await doAct("click Row 5 of an old snapshot", { type: "click", node: nodeOf(old, "button", "Row 5") }, "0");
  await fresh();
  await doAct("click Row 5, same table", { type: "click", node: nodeOf(last, "button", "Row 5") });
  await see("row=5");
  await doAct("click Send away", { type: "click", node: nodeOf(last, "button", "Send away") });
  await see("away=true");
  await doAct("click Away", { type: "click", node: nodeOf(last, "button", "Away") });

  await fresh();
  const busy = nodeOf(last, "button", "Busy 8s");
  const save = nodeOf(last, "button", "Save");
  await doAct("click Busy 8s", { type: "click", node: busy });
  s = await timed(log, "busy snapshot", () => snapshot(view), (v) => `${v.nodes.length} nodes`);
  await timed(log, "busy screenshot", () => screenshot(view, "jpeg"), (v) => `${v.width}x${v.height}`);
  if (s.ok) await doAct("busy click Save", { type: "click", node: nodeOf(s.value, "button", "Save") || save }, s.value.snapshot);
  await timed(log, "wait presses=2 (Save pressed during the loop)", () => waitText(view, "presses=2", 12_000), (v) => `found=${v.found}`);

  await fresh();
  await doAct("click Crash", { type: "click", node: nodeOf(last, "button", "Crash") });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await timed(log, "snapshot after crash", () => snapshot(view), (v) => `${v.nodes.length} nodes`);
  await unmount();
  await timed(log, "snapshot after unmount", () => snapshot(view));
  await timed(log, "act after unmount", () => act(view, last.snapshot, { type: "click", node: 1 }));
  await timed(log, "screenshot after unmount", () => screenshot(view, "jpeg"));
  await timed(log, "wait after unmount", () => waitText(view, "x", 300));
  log("drive done");
}

// For 60 s: a 1.5 s wait for text that is not there, then every other request at once, to see the answers after
// HOME or with the screen off. The wait comes first because JS timers stop in the background and native ones do not.
export async function watchDrive(view: string, log: Log) {
  const end = Date.now() + 60_000;
  for (let i = 0; Date.now() < end; i++) {
    const w = await waitText(view, "not on the screen", 1500);
    const s = await snapshot(view);
    const id = s.ok ? s.value.snapshot : "0";
    const parts = [
      `wait ${said(w)}`,
      `snapshot ${said(s)}`,
      `act ${said(await act(view, id, { type: "scroll", dy: 10 }))}`,
      `screenshot ${said(await screenshot(view, "jpeg"))}`,
    ];
    log(`watch ${i} ${new Date().toISOString().slice(11, 19)} ${parts.join(" | ")}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
