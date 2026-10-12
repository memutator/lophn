import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  checkRunningSandbox,
  checkSandboxFile,
  linuxProcReader,
  type ProcessObservation,
  type ProcReader,
} from "./sandbox-check.ts";

Deno.test("platform/install-and-update#R3: sandbox 파일은 root 소유 4755만 통과한다", () => {
  assertEquals(checkSandboxFile({ uid: 0, gid: 0, mode: 0o104755 }), {
    ok: true,
  });
  const wrongOwner = checkSandboxFile({ uid: 1000, gid: 1000, mode: 0o104755 });
  assertFalse(wrongOwner.ok);
  const notSetuid = checkSandboxFile({ uid: 0, gid: 0, mode: 0o100755 });
  assertFalse(notSetuid.ok);
  const wide = checkSandboxFile({ uid: 0, gid: 0, mode: 0o104777 });
  assertFalse(wide.ok);
});

function observation(
  pid: number,
  over: Partial<ProcessObservation> = {},
): ProcessObservation {
  return {
    pid,
    cmdline: ["/opt/lophn/lophn-desktop"],
    seccomp: "0",
    noNewPrivs: "0",
    netNamespace: "net:[1]",
    pidNamespace: "pid:[1]",
    ...over,
  };
}

function tree(
  renderer: Partial<ProcessObservation> | undefined,
  extraCmd: string[] = [],
): ProcReader {
  const all = new Map<number, ProcessObservation>([
    [
      10,
      observation(10, { cmdline: ["/opt/lophn/lophn-desktop", ...extraCmd] }),
    ],
    [
      11,
      observation(11, {
        cmdline: ["/opt/lophn/lophn-desktop", "--type=zygote"],
      }),
    ],
  ]);
  if (renderer !== undefined) {
    all.set(
      12,
      observation(12, {
        cmdline: ["/opt/lophn/lophn-desktop", "--type=renderer"],
        seccomp: "2",
        noNewPrivs: "1",
        netNamespace: "net:[2]",
        pidNamespace: "pid:[2]",
        ...renderer,
      }),
    );
  }
  const children = new Map<number, number[]>([
    [10, [11]],
    [11, renderer === undefined ? [] : [12]],
  ]);
  return {
    read: (pid) => all.get(pid),
    children: (pid) => children.get(pid) ?? [],
  };
}

Deno.test("platform/security#R4: renderer가 seccomp·no_new_privs·별도 namespace 안이면 sandbox 활성이다", () => {
  assertEquals(checkRunningSandbox(10, tree({})), { ok: true });
});

Deno.test("platform/security#R4: sandbox를 끈 실행은 통과가 아니다", () => {
  const off = checkRunningSandbox(10, tree({}, ["--no-sandbox"]));
  assertFalse(off.ok);
  assert(
    !off.ok && off.reasons.some((reason) => reason.includes("--no-sandbox")),
  );
  const bare = checkRunningSandbox(
    10,
    tree({
      seccomp: "0",
      noNewPrivs: "0",
      netNamespace: "net:[1]",
      pidNamespace: "pid:[1]",
    }),
  );
  assertFalse(bare.ok);
  assert(!bare.ok && bare.reasons.length >= 4);
});

Deno.test("platform/security#R4: argv가 한 문자열로 다시 쓰인 process도 renderer·--no-sandbox로 읽는다", () => {
  const proc = tree({
    cmdline: ["/opt/lophn/lophn-desktop --type=renderer --no-sandbox"],
  });
  const checked = checkRunningSandbox(10, proc);
  assertFalse(checked.ok);
  assert(
    !checked.ok &&
      checked.reasons.some((reason) => reason.includes("--no-sandbox")),
  );
});

Deno.test("platform/security#R4: renderer를 못 찾거나 browser를 못 읽으면 확인하지 못한 것이다", () => {
  assertFalse(checkRunningSandbox(10, tree(undefined)).ok);
  assertFalse(checkRunningSandbox(99, tree({})).ok);
});

Deno.test("platform/install-and-update#R3: /proc reader는 status·cmdline·namespace·자식을 읽는다", () => {
  const files = new Map<string, string>([
    ["/proc/7/cmdline", "lophn-desktop\0--type=renderer\0"],
    ["/proc/7/status", "Name:\tx\nSeccomp:\t2\nNoNewPrivs:\t1\n"],
    ["/proc/7/task/7/children", "8 9 "],
  ]);
  const links = new Map<string, string>([
    ["/proc/7/ns/net", "net:[5]"],
    ["/proc/7/ns/pid", "pid:[6]"],
  ]);
  const reader = linuxProcReader({
    readTextFile(path) {
      const text = files.get(path);
      if (text === undefined) throw new Error("missing");
      return text;
    },
    readLink(path) {
      const link = links.get(path);
      if (link === undefined) throw new Error("missing");
      return link;
    },
  });
  assertEquals(reader.read(7), {
    pid: 7,
    cmdline: ["lophn-desktop", "--type=renderer"],
    seccomp: "2",
    noNewPrivs: "1",
    netNamespace: "net:[5]",
    pidNamespace: "pid:[6]",
  });
  assertEquals(reader.children(7), [8, 9]);
  assertEquals(reader.read(1), undefined);
  assertEquals(reader.children(1), []);
});
