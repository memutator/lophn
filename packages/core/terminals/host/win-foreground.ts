// Windows PTY의 foreground coding agent를 shell pid 아래 process tree에서 찾는다.
// OS에 내장된 .NET Framework 4 `csc.exe`로 작은 C# helper를 한 번 build해 tmpdir에 두고, stdin/stdout 한 줄씩
// 주고받는다. helper는 CreateToolhelp32Snapshot으로 전체 process를 훑고(<1ms), 새로 나타난 자손 pid만 WMI로
// CommandLine을 한 번 읽어 cache한다. helper를 못 build하거나 실패하면 조용히 비워 두고 host를 멈추지 않는다.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

import { harnessOfProcess } from "../../../protocol/coding-agent/mod.ts";
import { selectWinForeground, type WinDescendant } from "./foreground.ts";

const execFileAsync = promisify(execFile);

const QUERY_TIMEOUT_MS = 1_500;

export type WinForegroundReader = {
  query(shellPids: readonly number[]): Promise<Map<number, string[] | null>>;
  stop(): void;
};

// Windows 10·11에 기본으로 든 .NET Framework 4 C# compiler다.
function cscPath(): string | null {
  const windir = process.env.WINDIR ?? process.env.SystemRoot ?? "C:\\Windows";
  for (const framework of ["Framework64", "Framework"]) {
    const path = join(
      windir,
      "Microsoft.NET",
      framework,
      "v4.0.30319",
      "csc.exe",
    );
    if (existsSync(path)) return path;
  }
  return null;
}

const HELPER_SOURCE = `using System;
using System.Collections.Generic;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;

static class LophnWinForeground {
  const uint TH32CS_SNAPPROCESS = 0x00000002;
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const int MAX_DEPTH = 8;
  const int MAX_DESCENDANTS = 64;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct PROCESSENTRY32W {
    public uint dwSize;
    public uint cntUsage;
    public uint th32ProcessID;
    public IntPtr th32DefaultHeapID;
    public uint th32ModuleID;
    public uint cntThreads;
    public uint th32ParentProcessID;
    public int pcPriClassBase;
    public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
    public string szExeFile;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool Process32FirstW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool Process32NextW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetProcessTimes(IntPtr hProcess, out long creation, out long exit, out long kernel, out long user);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr hObject);

  sealed class Proc {
    public uint Pid;
    public uint Ppid;
    public string Name;
  }

  sealed class CachedCmd {
    public long Created;
    public string CommandLine;
  }

  static readonly Dictionary<uint, CachedCmd> CmdCache = new Dictionary<uint, CachedCmd>();

  static long CreationTimeOf(uint pid) {
    IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (handle == IntPtr.Zero) return 0;
    try {
      long ct, ex, kt, ut;
      return GetProcessTimes(handle, out ct, out ex, out kt, out ut) ? ct : 0;
    } finally {
      CloseHandle(handle);
    }
  }

  static string QueryCommandLine(uint pid) {
    try {
      using (var searcher = new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE ProcessId = " + pid)) {
        foreach (ManagementObject obj in searcher.Get()) {
          object val = obj["CommandLine"];
          if (val != null) return val.ToString();
        }
      }
    } catch {
      // 권한이 없거나 그 사이 끝난 process다.
    }
    return null;
  }

  static string CommandLineOf(uint pid, long created) {
    CachedCmd cached;
    if (CmdCache.TryGetValue(pid, out cached) && cached.Created == created) {
      return cached.CommandLine;
    }
    string cmd = QueryCommandLine(pid);
    CmdCache[pid] = new CachedCmd { Created = created, CommandLine = cmd };
    return cmd;
  }

  static void AppendJsonString(StringBuilder sb, string text) {
    if (text == null) {
      sb.Append("null");
      return;
    }
    sb.Append('"');
    foreach (char c in text) {
      switch (c) {
        case '"': sb.Append("\\\\\\""); break;
        case '\\\\': sb.Append("\\\\\\\\"); break;
        case '\\b': sb.Append("\\\\b"); break;
        case '\\f': sb.Append("\\\\f"); break;
        case '\\n': sb.Append("\\\\n"); break;
        case '\\r': sb.Append("\\\\r"); break;
        case '\\t': sb.Append("\\\\t"); break;
        default:
          if (c < 0x20) sb.AppendFormat("\\\\u{0:x4}", (int)c);
          else sb.Append(c);
          break;
      }
    }
    sb.Append('"');
  }

  static void Snapshot(out Dictionary<uint, List<Proc>> byParent, out HashSet<uint> alive) {
    byParent = new Dictionary<uint, List<Proc>>();
    alive = new HashSet<uint>();
    IntPtr snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == IntPtr.Zero || snap.ToInt64() == -1) return;
    try {
      var entry = new PROCESSENTRY32W();
      entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32W));
      if (!Process32FirstW(snap, ref entry)) return;
      do {
        alive.Add(entry.th32ProcessID);
        List<Proc> list;
        if (!byParent.TryGetValue(entry.th32ParentProcessID, out list)) {
          list = new List<Proc>();
          byParent[entry.th32ParentProcessID] = list;
        }
        list.Add(new Proc {
          Pid = entry.th32ProcessID,
          Ppid = entry.th32ParentProcessID,
          Name = entry.szExeFile ?? ""
        });
      } while (Process32NextW(snap, ref entry));
    } finally {
      CloseHandle(snap);
    }
  }

  static void PruneCache(HashSet<uint> alive) {
    if (CmdCache.Count == 0) return;
    var gone = new List<uint>();
    foreach (uint pid in CmdCache.Keys) {
      if (!alive.Contains(pid)) gone.Add(pid);
    }
    foreach (uint pid in gone) CmdCache.Remove(pid);
  }

  static int Main() {
    Console.InputEncoding = new UTF8Encoding(false);
    Console.OutputEncoding = new UTF8Encoding(false);
    string line;
    while ((line = Console.ReadLine()) != null) {
      var pids = new List<uint>();
      foreach (string part in line.Split(',')) {
        uint pid;
        if (uint.TryParse(part.Trim(), out pid) && pid > 0) pids.Add(pid);
      }
      Dictionary<uint, List<Proc>> byParent;
      HashSet<uint> alive;
      Snapshot(out byParent, out alive);
      PruneCache(alive);

      var sb = new StringBuilder();
      sb.Append('{');
      bool firstRoot = true;
      foreach (uint root in pids) {
        if (!firstRoot) sb.Append(',');
        firstRoot = false;
        sb.Append('"');
        sb.Append(root);
        sb.Append("\\":[");
        if (alive.Contains(root)) {
          long rootCreated = CreationTimeOf(root);
          var seen = new HashSet<uint> { root };
          var queue = new Queue<KeyValuePair<uint, int>>();
          queue.Enqueue(new KeyValuePair<uint, int>(root, 0));
          int emitted = 0;
          bool firstItem = true;
          while (queue.Count > 0 && emitted < MAX_DESCENDANTS) {
            var cur = queue.Dequeue();
            if (cur.Value >= MAX_DEPTH) continue;
            List<Proc> children;
            if (!byParent.TryGetValue(cur.Key, out children)) continue;
            foreach (Proc child in children) {
              if (!seen.Add(child.Pid)) continue;
              long created = CreationTimeOf(child.Pid);
              // 재사용된 pid가 부모보다 먼저 생긴 옛 process면 자식이 아니다.
              if (rootCreated > 0 && created > 0 && created < rootCreated) continue;
              string cmd = CommandLineOf(child.Pid, created);
              if (!firstItem) sb.Append(',');
              firstItem = false;
              sb.Append("{\\"p\\":");
              sb.Append(child.Pid);
              sb.Append(",\\"pp\\":");
              sb.Append(child.Ppid);
              sb.Append(",\\"n\\":");
              AppendJsonString(sb, child.Name);
              sb.Append(",\\"c\\":");
              AppendJsonString(sb, cmd);
              sb.Append('}');
              emitted++;
              if (emitted >= MAX_DESCENDANTS) break;
              queue.Enqueue(new KeyValuePair<uint, int>(child.Pid, cur.Value + 1));
            }
          }
        }
        sb.Append(']');
      }
      sb.Append('}');
      Console.WriteLine(sb.ToString());
      Console.Out.Flush();
    }
    return 0;
  }
}
`;

async function ensureHelperExe(): Promise<string | null> {
  const hash = createHash("sha256")
    .update(HELPER_SOURCE)
    .digest("hex")
    .slice(0, 12);
  const dir = join(tmpdir(), "lophn-win-fg", `fg-${hash}`);
  const exe = join(dir, "fg.exe");
  if (existsSync(exe)) return exe;
  const csc = cscPath();
  if (csc === null) return null;
  mkdirSync(dir, { recursive: true });
  const src = join(dir, `fg.${process.pid}.cs`);
  const built = join(dir, `fg.${process.pid}.build.exe`);
  // UTF-8 BOM을 붙여 csc.exe가 ANSI 코드페이지로 오인하지 않게 한다.
  writeFileSync(src, `\uFEFF${HELPER_SOURCE}`);
  try {
    await execFileAsync(
      csc,
      [
        "/nologo",
        "/target:exe",
        "/optimize+",
        "/reference:System.Management.dll",
        `/out:${built}`,
        src,
      ],
      { windowsHide: true },
    );
    try {
      await rename(built, exe);
    } catch {
      if (!existsSync(exe)) return null;
      await rm(built, { force: true });
    }
    return exe;
  } catch {
    await rm(built, { force: true }).catch(() => {});
    return null;
  } finally {
    await rm(src, { force: true }).catch(() => {});
  }
}

type RawDescendant = {
  p: number;
  pp: number;
  n: string;
  c: string | null;
};

export function createWinForegroundReader(): WinForegroundReader {
  let exePromise: Promise<string | null> | undefined;
  let child: ChildProcess | null = null;
  let pending: ((line: string | null) => void) | null = null;
  let disabled = false;
  let stopped = false;

  function killChild(): void {
    const running = child;
    child = null;
    if (pending !== null) {
      const resolve = pending;
      pending = null;
      resolve(null);
    }
    if (running !== null) {
      try {
        running.stdin?.end();
      } catch {
        // 이미 닫혔다.
      }
      try {
        running.kill();
      } catch {
        // 이미 끝났다.
      }
    }
  }

  async function ensureChild(): Promise<ChildProcess | null> {
    if (stopped || disabled) return null;
    if (child !== null && child.exitCode === null && !child.killed) {
      return child;
    }
    exePromise ??= ensureHelperExe();
    const exe = await exePromise;
    if (exe === null || stopped) {
      disabled = true;
      return null;
    }
    const spawned = spawn(exe, [], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const rl = createInterface({ input: spawned.stdout! });
    rl.on("line", (line) => {
      if (pending !== null) {
        const resolve = pending;
        pending = null;
        resolve(line);
      }
    });
    spawned.on("error", () => {
      if (child === spawned) killChild();
    });
    spawned.on("exit", () => {
      rl.close();
      if (child === spawned) {
        child = null;
        if (pending !== null) {
          const resolve = pending;
          pending = null;
          resolve(null);
        }
      }
    });
    child = spawned;
    return spawned;
  }

  const isHarness = (argv: readonly string[]) =>
    harnessOfProcess(argv) !== null;

  return {
    async query(shellPids) {
      const result = new Map<number, string[] | null>();
      if (shellPids.length === 0 || stopped || disabled) return result;
      const proc = await ensureChild();
      if (proc === null || proc.stdin === null) return result;
      const line = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          if (pending === finish) {
            pending = null;
            killChild();
            resolve(null);
          }
        }, QUERY_TIMEOUT_MS);
        const finish = (value: string | null) => {
          clearTimeout(timer);
          resolve(value);
        };
        pending = finish;
        try {
          proc.stdin!.write(`${shellPids.join(",")}\n`);
        } catch {
          pending = null;
          clearTimeout(timer);
          killChild();
          resolve(null);
        }
      });
      if (line === null) return result;
      let parsed: Record<string, RawDescendant[]>;
      try {
        parsed = JSON.parse(line) as Record<string, RawDescendant[]>;
      } catch {
        return result;
      }
      for (const pid of shellPids) {
        const rows = parsed[String(pid)];
        if (!Array.isArray(rows)) continue;
        const descendants: WinDescendant[] = rows.map((row) => ({
          pid: row.p,
          ppid: row.pp,
          name: row.n,
          commandLine: row.c,
        }));
        result.set(pid, selectWinForeground(descendants, isHarness));
      }
      return result;
    },
    stop() {
      stopped = true;
      killChild();
    },
  };
}
