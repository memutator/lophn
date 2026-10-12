// Chromium OS sandbox 검사.
// 파일 검사(root 소유·4755)와 실제 실행 검사(renderer process가 sandbox 안에 있는가)를 나눈다.
// sandbox를 끈 실행(`--no-sandbox`)은 어떤 검사에서도 통과가 아니다.

export type SandboxFileStat = { uid: number; gid: number; mode: number };

export type SandboxCheck = { ok: true } | { ok: false; reasons: string[] };

// 설치된 chrome-sandbox 파일: root 소유(uid 0)이고 권한은 정확히 4755다.
export function checkSandboxFile(stat: SandboxFileStat): SandboxCheck {
  const reasons: string[] = [];
  if (stat.uid !== 0) reasons.push("chrome-sandbox 소유자가 root가 아니다");
  if ((stat.mode & 0o7777) !== 0o4755) {
    reasons.push("chrome-sandbox 권한이 4755가 아니다");
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

// /proc/<pid>에서 읽은 process 관측. 비교에 쓰는 값만 담는다.
export type ProcessObservation = {
  pid: number;
  cmdline: readonly string[];
  // /proc/<pid>/status의 "Seccomp:", "NoNewPrivs:" 값.
  seccomp: string | undefined;
  noNewPrivs: string | undefined;
  // /proc/<pid>/ns/net, ns/pid가 가리키는 이름(예 `net:[4026531840]`).
  netNamespace: string | undefined;
  pidNamespace: string | undefined;
};

export type ProcReader = {
  read(pid: number): ProcessObservation | undefined;
  children(pid: number): readonly number[];
};

// 설치된 Electron의 실제 sandbox 활성 검사다. browser process 아래 모든 renderer가 sandbox 증거를
// 모두 가져야 통과한다: seccomp filter(2), no_new_privs, 별도 net·pid namespace. renderer가 하나도
// 없으면 확인하지 못한 것이라 통과가 아니다.
export function checkRunningSandbox(
  browserPid: number,
  proc: ProcReader,
): SandboxCheck {
  const browser = proc.read(browserPid);
  if (browser === undefined) {
    return { ok: false, reasons: ["browser process를 읽을 수 없다"] };
  }
  const reasons: string[] = [];
  const all = descendants(browserPid, proc);
  const observed = all.map((pid) => proc.read(pid)).filter((
    item,
  ): item is ProcessObservation => item !== undefined);
  const renderers = observed.filter((item) =>
    hasFlag(item.cmdline, "--type=renderer")
  );
  if (renderers.length === 0) {
    reasons.push("renderer process를 찾지 못해 sandbox를 확인하지 못했다");
  }
  for (const item of [browser, ...observed]) {
    if (hasFlag(item.cmdline, "--no-sandbox")) {
      reasons.push(`pid ${item.pid}가 --no-sandbox로 실행됐다`);
    }
  }
  for (const item of renderers) {
    if (item.seccomp !== "2") {
      reasons.push(`renderer ${item.pid}에 seccomp filter가 없다`);
    }
    if (item.noNewPrivs !== "1") {
      reasons.push(`renderer ${item.pid}에 no_new_privs가 없다`);
    }
    if (
      item.netNamespace === undefined ||
      item.netNamespace === browser.netNamespace
    ) {
      reasons.push(
        `renderer ${item.pid}가 browser와 같은 net namespace에 있다`,
      );
    }
    if (
      item.pidNamespace === undefined ||
      item.pidNamespace === browser.pidNamespace
    ) {
      reasons.push(
        `renderer ${item.pid}가 browser와 같은 pid namespace에 있다`,
      );
    }
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

// Chromium은 자식 process의 argv를 하나의 문자열로 다시 쓰기도 해서 공백으로도 나눠 본다.
function hasFlag(cmdline: readonly string[], flag: string): boolean {
  return cmdline.some((part) => part.split(" ").includes(flag));
}

function descendants(root: number, proc: ProcReader): number[] {
  const found: number[] = [];
  const pending = [root];
  const seen = new Set<number>([root]);
  while (pending.length > 0) {
    const next = pending.pop()!;
    for (const child of proc.children(next)) {
      if (seen.has(child)) continue;
      seen.add(child);
      found.push(child);
      pending.push(child);
    }
  }
  return found;
}

// 실제 /proc을 읽는 reader. 읽을 수 없는 process는 undefined다.
export function linuxProcReader(
  fs: {
    readTextFile(path: string): string;
    readLink(path: string): string;
  },
  procRoot = "/proc",
): ProcReader {
  const text = (path: string): string | undefined => {
    try {
      return fs.readTextFile(path);
    } catch {
      return undefined;
    }
  };
  const link = (path: string): string | undefined => {
    try {
      return fs.readLink(path);
    } catch {
      return undefined;
    }
  };
  return {
    read(pid) {
      const cmd = text(`${procRoot}/${pid}/cmdline`);
      const status = text(`${procRoot}/${pid}/status`);
      if (cmd === undefined || status === undefined) return undefined;
      const field = (name: string) =>
        status.split("\n").find((line) => line.startsWith(`${name}:`))
          ?.slice(name.length + 1).trim();
      return {
        pid,
        cmdline: cmd.split("\0").filter((part) => part !== ""),
        seccomp: field("Seccomp"),
        noNewPrivs: field("NoNewPrivs"),
        netNamespace: link(`${procRoot}/${pid}/ns/net`),
        pidNamespace: link(`${procRoot}/${pid}/ns/pid`),
      };
    },
    children(pid) {
      const raw = text(`${procRoot}/${pid}/task/${pid}/children`);
      if (raw === undefined) return [];
      return raw.split(/\s+/).filter((part) => part !== "").map(Number);
    },
  };
}
