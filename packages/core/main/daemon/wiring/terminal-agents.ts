// terminal agents: 터미널 안 coding agent의 상태를 core가 원본으로 갖는다. per-run 폴더(`core-<pid>`)에 hook socket과 `$BROWSER`
// bridge socket·shim, 시작 층 file을 두고, 터미널을 열 때마다(`ctx.terminals.useEnv`) 그 터미널의 key를 env로 준다. tracker·GUI
// handle·coding session·저장한 session은 `ctx.terminalAgents`(module의 service)가 들고, 여기는 socket·file·CLI·host queue와
// 이어 `terminals/saved_sessions|rename_saved`, `coding_agents/*`, `coding_sessions/*`, coding session의 `acp/tool_body|image_*` route를 낸다.
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { err, ok, type Result } from "../../../../base/mod.ts";
import { isGuiHarness } from "../../../../protocol/acp/gui-session.ts";
import {
  acpImageRead,
  acpImageUpload,
  acpToolBodyRead,
} from "../../../../protocol/acp/routes.ts";
import { SHARED_APPS_SETTING_KEY } from "../../../../protocol/approvals/share-request.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  codingAgentsHookStatus,
  codingAgentsInstallHooks,
  codingAgentsList,
  codingAgentsRefresh,
  codingAgentsUninstallHooks,
} from "../../../../protocol/coding-agent/coding-agents.ts";
import {
  HARNESS_ADAPTER_OF_RUNTIME,
  HARNESS_ADAPTERS,
} from "../../../../protocol/coding-agent/harness-adapter.ts";
import type { HarnessId } from "../../../../protocol/coding-agent/harnesses.ts";
import {
  codingSessionsCliSessions,
  codingSessionsForget,
  codingSessionsList,
  codingSessionsOpen,
  codingSessionsRewindPreview,
  codingSessionsSwitch,
  codingSessionsSwitchPlan,
} from "../../../../protocol/coding-agent/relay.ts";
import {
  TERMINAL_GUI_EVENT,
  TERMINAL_HOOK_ENV,
  TERMINAL_HOOK_LINE_MAX_BYTES,
  terminalHookLineSchema,
} from "../../../../protocol/coding-agent/terminal-hook.ts";
import {
  HOME_TERMINAL_PROJECT,
  type TerminalProject,
  terminalsRenameSaved,
  terminalsSavedSessions,
} from "../../../../protocol/coding-agent/terminals.ts";
import type { BusEvent } from "../../../../protocol/events/bus.ts";
import { agentCallSendable } from "../../../../protocol/lophn-agent/calls.ts";
import { teamRead } from "../../../../protocol/lophn-agent/team.ts";
import type { AgentId } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { Output } from "../../../../protocol/server/mod.ts";
import { codingAgentsSetting, shellSettings } from "../../../config/mod.ts";
import { HARNESS_GUI_ADAPTERS } from "../../../harness-gui/index.ts";
import {
  loadSession,
  workspaceOf,
} from "../../../lophn-agent/session/model.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import { workspaceDepsOf } from "../../../lophn-agent/workspaces/mod.ts";
import { bytesFileStream } from "../../../server/mod.ts";
import type { KnownSecretMatch } from "../../../storage/ledger/mod.ts";
import { RUNTIME_OF_GUI } from "../../../terminal-agents/member.ts";
import {
  type CliRun,
  type CodingOpen,
  childCliRunner,
  createAgentSessionStore,
  createBridge,
  createCodingOpen,
  createCredentialFiles,
  createFileHookOptOut,
  createHarnessSettings,
  createHookIngress,
  createHookInstaller,
  createSkillSync,
  createTerminalAgents,
  LINK_SETTING_KEYS,
  type LinkPrefs,
  listenBridge,
  listenHooks,
  moveSavedSessions,
  prepareRunDir,
  type RunDir,
  readAntigravityTitle,
  type TerminalAgents,
  type TerminalBridge,
  winLauncherFiles,
  writeShim,
} from "../../../terminal-agents/mod.ts";
import {
  SHELL_INIT_ENV,
  writeShellInit,
} from "../../../terminals/host/shell-integration.ts";
import { installedLayout } from "../entry-layout.ts";
import { redactDeep } from "./acp-build.ts";
import { createProductRedactor, type WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// 설치본은 platform/ 폴더, 개발은 저장소 root다.
const PLATFORM_ROOT = fileURLToPath(
  new URL("../../../../../", import.meta.url),
);
// resume으로 연 터미널의 hold를 갱신하는 간격. hold 갱신(10초)보다 넉넉히 짧다.
const BEAT_MS = 3000;
// bridge가 browser 탭이 열리기를 기다리는 시간. shim의 socket 기한(3초)보다 짧아야 declined 답이 그 안에 간다.
const BRIDGE_OPEN_MS = 2000;

const SOURCE = {
  concern: "coding-sessions",
  revision: "1",
  scope: "conversation",
};

// coding session의 대화 안 모든 글을 제품 redactor로 거른다(acp wiring의 `env.redact`와 같은 규칙). 알려진 secret을 아직 다 모르면
// null이다: 빈 글로 바꾸면 갱신의 `type` 같은 칸까지 비어 상태가 깨지므로 아예 내지 않는다.
export function codingRedactor(
  known: () => Pick<KnownSecretMatch, "ready" | "match"> | undefined,
) {
  const text = createProductRedactor({
    get ready() {
      return known()?.ready ?? false;
    },
    match: (value: string) => known()?.match(value),
  });
  return <T>(value: T): T | null => {
    if (!(known()?.ready ?? false)) return null;
    return redactDeep(
      { redact: (one) => text(SOURCE, "text/plain", one) ?? "" },
      value,
    );
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}

const execFileAsync = promisify(execFile);

// Windows 10·11에는 .NET Framework 4가 OS에 들어 있어 그 C# compiler로 launcher를 만든다.
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

// `<run>\browser-<hash>\browser.exe`를 돌려준다. 없으면 build하고, 다른 hash의 옛 launcher는 지운다. exe는 마지막에 rename으로 놓으므로
// exe가 있으면 browser.js도 다 쓰인 것이다.
async function buildWinLauncher(parent: string): Promise<string> {
  const files = winLauncherFiles(process.execPath, (text) =>
    createHash("sha256").update(text).digest("hex"),
  );
  for (const name of readdirSync(parent)) {
    if (/^browser-[0-9a-f]{12}$/.test(name) && name !== files.name) {
      try {
        rmSync(join(parent, name), { recursive: true, force: true });
      } catch {
        // 다른 터미널이 아직 쓰는 중이면 다음 실행이 지운다.
      }
    }
  }
  const dir = join(parent, files.name);
  const exe = join(dir, "browser.exe");
  if (existsSync(exe)) return exe;
  const csc = cscPath();
  if (csc === null) throw new Error(".NET Framework csc.exe was not found");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "browser.js"), files.script);
  writeFileSync(join(dir, "browser.cs"), files.source);
  const built = join(dir, "browser.build.exe");
  await execFileAsync(
    csc,
    [
      "/nologo",
      "/target:exe",
      "/optimize+",
      `/out:${built}`,
      join(dir, "browser.cs"),
    ],
    { windowsHide: true },
  );
  await rename(built, exe);
  return exe;
}

// prepare가 만들어 build가 쓰는 것.
type Setup = {
  ingress: ReturnType<typeof createHookIngress> | null;
  harnesses: ReturnType<typeof createHarnessSettings>;
  installer: ReturnType<typeof createHookInstaller>;
  skillSync: ReturnType<typeof createSkillSync>;
  log: (message: string) => void;
};

export const terminalAgentsWiring: WiringFactory = () => {
  let setup: Setup | undefined;
  let service: TerminalAgents | undefined;
  let run: RunDir | null = null;
  let stopped = false;
  const servers: Promise<{ stop(): Promise<void> } | null>[] = [];
  const offs: (() => void)[] = [];
  let beatTimer: ReturnType<typeof setInterval> | undefined;
  // build가 opener를 만든 뒤 놓는다. GUI 탭 팀원의 탭을 core가 열 때 쓴다.
  let openMember: CodingOpen["member"] | undefined;
  return {
    name: "terminal-agents",
    dataSteps: [
      { id: "terminal-agents.sessions-move", run: moveSavedSessions },
    ],
    // session lifecycle, acp, 터미널 보기, extension host가 build에서 쓰므로 그보다 먼저 낸다. 다른 칸은 부를 때 읽는다.
    prepare(ctx) {
      const log = (message: string) =>
        ctx.telemetry.logger.warn({
          component: "terminal-agents",
          event: "terminal_agents_problem",
          message,
        });
      const prepared = prepareRunDir({
        platform: process.platform,
        dataRoot: ctx.root.path,
        env: process.env,
        tmpdir: tmpdir(),
        uid: process.getuid?.() ?? 0,
        pid: process.pid,
        fs: {
          mkdir: (path, mode) =>
            void mkdirSync(path, { recursive: true, mode }),
          chmod: chmodSync,
          list: (path) => {
            try {
              return readdirSync(path);
            } catch {
              return [];
            }
          },
          remove: (path) => rmSync(path, { recursive: true, force: true }),
        },
        isAlive,
      });
      if (prepared.ok) run = prepared.value;
      else
        log(
          `terminal hooks and browser bridge are off: ${prepared.error.message}`,
        );

      // hook을 들은 터미널이 GUI가 띄운 CLI에도 같은 env를 준다. 서기 전과 꺼진 뒤에는 issue하지 않는다.
      const ingress =
        run === null
          ? null
          : createHookIngress({
              socket: run.hookSocket,
              envName: TERMINAL_HOOK_ENV,
              maxBytes: TERMINAL_HOOK_LINE_MAX_BYTES,
              newKey: () => randomBytes(32).toString("hex"),
              guiEvent: TERMINAL_GUI_EVENT,
              parse(value) {
                const parsed = terminalHookLineSchema.safeParse(value);
                return parsed.success ? parsed.data : null;
              },
              onHook: (hook) => ctx.terminalAgents.hook(hook),
              onGui: (hook) => ctx.terminalAgents.guiRequest(hook),
            });
      const redact = codingRedactor(() => ctx.peek.knownSecrets);
      service = createTerminalAgents({
        terminals: ctx.terminals,
        clock: ctx.clock,
        after(ms, runLater) {
          const timer = setTimeout(runLater, ms);
          return () => clearTimeout(timer);
        },
        publish: (event) => ctx.bus.publish(event),
        attention: () => ctx.attention,
        handlers: () => ctx.harnessGuiTabs(),
        redact,
        platform: process.platform,
        store: createAgentSessionStore({
          dataRoot: ctx.root.path,
          now: () => ctx.clock.nowMs(),
          resumable: (harness) =>
            harness in HARNESS_ADAPTERS &&
            HARNESS_ADAPTERS[harness as HarnessId].session.resume !== null,
        }),
        // GUI 탭이 사람이 붙인 그림을 쓰는 임시 폴더. 터미널을 닫아도 OS가 임시 폴더를 비운다.
        images: {
          root: join(tmpdir(), "lophn-gui"),
          async write(path, data) {
            await mkdir(dirname(path), { recursive: true, mode: 0o700 });
            await writeFile(path, data, { mode: 0o600 });
          },
          read: async (path) =>
            await readFile(path).then(
              (data) => new Uint8Array(data),
              () => null,
            ),
        },
        credentials:
          run === null
            ? null
            : createCredentialFiles({
                root: join(run.dir, "credentials"),
                fs: {
                  mkdir: (path, mode) =>
                    void mkdirSync(path, { recursive: true, mode }),
                  write: (path, text, mode) =>
                    writeFileSync(path, text, { mode }),
                  remove: (path) => rmSync(path, { force: true }),
                },
              }),
        members: () => ctx.peek.harnessMembers ?? null,
        openMemberTab: (input) =>
          openMember?.(input) ??
          Promise.resolve(
            err({ code: "unavailable", message: "core is still starting" }),
          ),
        memberDeny: (harness) => {
          const deny = ledgerSnapshot(
            ctx.ledgerPath,
            (lookup) =>
              workspaceDepsOf(lookup.sql).agents.agent(
                `coding_${harness}` as AgentId,
              )?.deny ?? [],
          );
          return deny.ok ? deny.value : [];
        },
        memberLaunch: (harness) => {
          const config = ledgerSnapshot(
            ctx.ledgerPath,
            (lookup) =>
              workspaceDepsOf(lookup.sql).agents.agent(
                `coding_${harness}` as AgentId,
              )?.harnessConfig,
          );
          return config.ok ? config.value : undefined;
        },
        enforcesDeny: (harness) => HARNESS_GUI_ADAPTERS[harness].enforcesDeny,
        onCatalog: (harness, cwd, result) =>
          void ctx.peek.harnessCatalog?.observe(harness, cwd, result),
        ids: { request: () => randomUUID() },
        hookEnv: (ref) => ingress?.envOf(ref) ?? {},
        identified: (harness, ref) => installer.ensureOnce(harness, ref),
        beat: (sessions) => ctx.harnessHold.heartbeat(sessions as Id<"ses">[]),
        readAntigravityTitle: (conversationId) =>
          readAntigravityTitle(
            join(
              homedir(),
              ".gemini",
              "antigravity-cli",
              "conversation_summaries.db",
            ),
            conversationId,
          ),
        log,
      });
      ctx.provide("terminalAgents", service);

      // `lophn` CLI를 사람의 env로 부른다. 띄운 CLI가 이 core에 닿게 data root를 주고, 이 core의 주소에만 붙게 한다.
      // 주소가 없으면 CLI는 ensure로 붙어, 이 core가 멈추거나 죽은 뒤에도 남아 core를 다시 띄운다.
      const cliPath = ctx.personEnv.cli;
      const cli = (timeout_ms?: number): CliRun | null =>
        cliPath === null
          ? null
          : async (args) =>
              childCliRunner({
                command: cliPath,
                env: {
                  ...(await ctx.personEnv.env()),
                  LOPHN_HOME: ctx.root.path,
                  LOPHN_DAEMON_URL: `http://127.0.0.1:${ctx.server.port}`,
                },
                ...(timeout_ms === undefined ? {} : { timeout_ms }),
              })(args);
      const harnesses = createHarnessSettings(cli());
      ctx.provide("codingDetection", harnesses);
      const skillSync = createSkillSync({ runCli: cli(), log });

      const labelOf = (harness: string) =>
        harness in HARNESS_ADAPTERS
          ? HARNESS_ADAPTERS[harness as HarnessId].label
          : harness;
      const winHookCommand = (path: string): string | undefined => {
        const normalized = path.replaceAll("\\", "/");
        return /^[A-Za-z]:\/[\w./-]+$/.test(normalized) &&
          !normalized.includes("..")
          ? normalized
          : undefined;
      };
      const installer = createHookInstaller({
        runCli: cli(15_000),
        // hook command는 harness 설정 file의 shell 문자열이 된다. POSIX 설치본은 PATH의 `lophn`이고 개발 실행은 launcher 절대 경로다.
        // Windows는 설치본이 사용자 PATH에 없으므로 공백 없는 절대 경로(`C:/…/lophn.cmd`)를 써서 lophn 밖·Git Bash·cmd·PowerShell
        // 모두에서 돌게 한다. 경로에 공백 등이 있으면 `lophn`으로 내려가고 lophn 터미널 안에서는 bin/의 lophn·lophn.cmd가 받는다.
        hookCommand:
          cliPath === null
            ? undefined
            : process.platform === "win32"
              ? winHookCommand(cliPath)
              : installedLayout(PLATFORM_ROOT, existsSync)
                ? undefined
                : cliPath,
        hasHook: (harness) =>
          harness in HARNESS_ADAPTERS &&
          HARNESS_ADAPTERS[harness as HarnessId].hook !== null,
        optOut: createFileHookOptOut(
          join(ctx.root.path, "terminal-agents", "hooks-opt-out.json"),
        ),
        onResult: (result) => {
          ctx.bus.publish({
            type: "HookInstallFinished",
            subject: null,
            at: ctx.clock.now(),
            payload: {
              ...result,
              label: labelOf(result.harness),
            },
          } as BusEvent);
        },
        changed: () => skillSync.request(),
      });
      setup = {
        ingress,
        harnesses,
        installer,
        skillSync,
        log,
      };
    },
    build(ctx) {
      const agents = ctx.terminalAgents;
      const coding = agents.coding;
      const { ingress, harnesses, installer, skillSync, log } = setup!;
      const queue = ctx.hostQueue;

      // hook endpoint는 폴더가 정해지면 바로 선다(bridge의 shim·listen을 기다리지 않는다). listen 전에 연 터미널은 hook 없이 뜬다.
      let hooksLive = false;
      let shellInit: string | null = null;
      let bridge: TerminalBridge | null = null;
      if (run !== null && ingress !== null) {
        const at = run;
        servers.push(
          listenHooks({
            socket: at.hookSocket,
            platform: process.platform,
            maxBytes: TERMINAL_HOOK_LINE_MAX_BYTES,
            handleLine: ingress.handleLine,
            log,
          }).then(
            (started) => {
              hooksLive = !stopped;
              // 사람 터미널의 codex·opencode가 shared server가 아니라 이 탭의 env로 hook을 보내게 하고, `<harness> gui`가 그 탭의
              // hook socket으로 닿게 하는 함수다. 쓰지 못해도 hook은 그대로 쓴다.
              try {
                shellInit = writeShellInit(
                  {
                    mkdir: (path) => void mkdirSync(path, { recursive: true }),
                    write: (path, text) =>
                      writeFileSync(path, text, { mode: 0o600 }),
                  },
                  at.dir,
                  // 터미널 env에는 LOPHN_CLI가 없다. core가 고른 launcher 경로를 함수에 넣는다.
                  ctx.personEnv.cli ?? "lophn",
                  process.platform,
                );
              } catch (cause) {
                log(`shell integration is off: ${String(cause)}`);
              }
              return started;
            },
            (cause) => {
              log(`terminal hooks are off: cannot listen (${String(cause)})`);
              return null;
            },
          ),
        );
        servers.push(startBridge(at));
      }

      // bridge가 연 browser 탭은 사람이 연 것과 같다. shell이 붙어 있지 않으면 OS browser가 연다(shim이 declined를 받는다).
      async function openBrowserTab(
        ref: string,
        url: string,
      ): Promise<boolean> {
        const runtime = ctx.terminals.runtime(ref);
        const project = runtime?.project;
        if (
          !queue.attached() ||
          (project !== HOME_TERMINAL_PROJECT && !project?.startsWith("prj_"))
        ) {
          return false;
        }
        const sent = queue.openAndWait({
          owner: "person",
          workspace:
            project === HOME_TERMINAL_PROJECT
              ? { kind: "home" }
              : { kind: "project", id: project as Id<"prj"> },
          target: { browser: { url } },
          relation: null,
          source: null,
        });
        const timer = setTimeout(() => queue.abandon(sent.id), BRIDGE_OPEN_MS);
        const done = await sent.result;
        clearTimeout(timer);
        return done.ok;
      }

      function linkPrefs(): LinkPrefs {
        const read = (name: string) => {
          const declared = shellSettings.find((one) => one.key === name);
          const value: unknown =
            declared === undefined
              ? undefined
              : ctx.settings.get(declared as never);
          return value === "system_browser" ? "system_browser" : "browser_tab";
        };
        return {
          web_links: read(LINK_SETTING_KEYS.web_links),
          local_links: read(LINK_SETTING_KEYS.local_links),
        };
      }

      async function startBridge(at: RunDir) {
        let shim: string;
        try {
          if (process.platform === "win32") {
            shim = await buildWinLauncher(join(ctx.root.path, "run"));
          } else {
            writeShim(
              {
                write: (path, text, mode) =>
                  writeFileSync(path, text, { mode }),
              },
              { shim: at.shim, script: at.script },
              process.execPath,
            );
            shim = at.shim;
          }
        } catch (cause) {
          log(
            `browser bridge is off: cannot write the shim (${String(cause)})`,
          );
          return null;
        }
        const made = createBridge({
          paths: { socket: at.bridgeSocket, shim },
          // 사용자가 login shell에 둔 BROWSER는 덮지 않는다.
          env: await ctx.personEnv.env(),
          ids: { key: () => randomBytes(32).toString("hex") },
          readPrefs: () => Promise.resolve(linkPrefs()),
          open: openBrowserTab,
        });
        try {
          const started = await listenBridge({
            socket: at.bridgeSocket,
            platform: process.platform,
            handleLine: made.handleLine,
            log,
          });
          if (!stopped) bridge = made;
          return started;
        } catch (cause) {
          log(`browser bridge is off: cannot listen (${String(cause)})`);
          return null;
        }
      }

      offs.push(
        ctx.terminals.useEnv(() => {
          const hooked = hooksLive && ingress !== null ? ingress.issue() : null;
          const bridged = bridge?.issue() ?? null;
          const init = hooked === null ? null : shellInit;
          return {
            env: {
              ...hooked?.env,
              ...bridged?.env,
              ...(init === null ? {} : { [SHELL_INIT_ENV]: init }),
            },
            opened(runtime) {
              if (runtime === null) return;
              if (hooked !== null)
                ingress!.bind(hooked.key, runtime.terminal_ref);
              if (bridged !== null)
                bridge?.bind(bridged.key, runtime.terminal_ref);
            },
          };
        }),
      );

      beatTimer = setInterval(() => agents.holds.beat(), BEAT_MS);
      beatTimer.unref?.();

      // 공유 skill 사본은 core 기동 뒤, 앱 activation 뒤, 설정이 바뀔 때 맞춘다. 사본이 같으면 아무것도 쓰지 않는다.
      offs.push(
        ctx.bus.subscribe([{ types: ["AppViewChanged", "StateChanged"] }], {
          send(event) {
            if (event.type === "AppViewChanged") {
              if (
                (event.payload as { reason?: string }).reason === "activation"
              ) {
                skillSync.request();
              }
              return;
            }
            const changes = (
              event.payload as {
                changes: { name: string; id: string | null }[];
              }
            ).changes;
            if (
              changes.some(
                (change) =>
                  change.name === "settings" &&
                  (change.id === null || change.id === SHARED_APPS_SETTING_KEY),
              )
            ) {
              skillSync.request();
            }
          },
          close: () => undefined,
        }),
      );

      const opener = createCodingOpen({
        guiOn: () => ctx.harnessGuiTabs() !== null,
        async open(project, command) {
          const opened = await ctx.terminals.open({
            project: project as TerminalProject,
            command,
          });
          if (!opened.ok) return opened;
          const terminal = opened.value.terminal_ref;
          queue.openTab({
            owner: "person",
            workspace:
              project === HOME_TERMINAL_PROJECT
                ? { kind: "home" }
                : { kind: "project", id: project as Id<"prj"> },
            target: { terminal: { terminal_ref: terminal } },
            relation: null,
            source: null,
          });
          return ok(terminal);
        },
        session(session) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            loadSession(lookup, session),
          );
          if (!found.ok || found.value === undefined) return undefined;
          const row = found.value;
          const where = workspaceOf(row);
          return {
            // workspace가 없는 session은 Home의 것이다.
            project:
              where === null
                ? HOME_TERMINAL_PROJECT
                : where.kind === "project"
                  ? where.id
                  : null,
            harness:
              row.harness === null
                ? null
                : HARNESS_ADAPTER_OF_RUNTIME[row.harness],
            cli_session: row.harness_session,
          };
        },
        listed: () => coding.list(),
        hold: (session) => ctx.harnessHold.open(session as Id<"ses">),
        held: (terminal, session) =>
          agents.holds.hold(terminal, session, "gui"),
        codingCommand: (harness) =>
          ctx.settings.get(codingAgentsSetting)?.commands?.[harness],
      });
      openMember = (input) => opener.member(input);
      // harness wiring(팀원 queue)은 이 wiring보다 먼저 섰다. 탭이 없는 팀원에게 온 입력도 들어야 탭을 연다.
      agents.members.listen();

      return ok({
        memory: [
          [
            key(terminalsRenameSaved),
            (_who, input) =>
              agents.renameSaved(
                input as Parameters<typeof agents.renameSaved>[0],
              ),
          ],
          [
            key(codingAgentsRefresh),
            async () => ok({ harnesses: await harnesses.refresh() }),
          ],
          [
            key(codingAgentsInstallHooks),
            async (_who, input) =>
              ok({
                hook: await installer.install(
                  (input as { harness: HarnessId }).harness,
                ),
              }),
          ],
          [
            key(codingAgentsUninstallHooks),
            async (_who, input) =>
              ok({
                hook: await installer.uninstall(
                  (input as { harness: HarnessId }).harness,
                ),
              }),
          ],
          [
            key(codingSessionsSwitch),
            (_who, input) =>
              coding.switch(
                input as { session: string; to: "gui" | "tui"; key: string },
              ),
          ],
          [
            key(codingSessionsForget),
            async (who, input) => {
              const body = codingSessionsForget.input.parse(input);
              const members = ctx.peek.harnessMembers;
              if (!isGuiHarness(body.harness) || members === undefined) {
                return err({
                  code: "invalid_input",
                  message: "not a chat coding agent",
                });
              }
              const archived = await members.forget(who, {
                project: body.project,
                harness: RUNTIME_OF_GUI[body.harness],
                cli_session: body.cli_session,
              });
              return archived.ok ? ok({ archived: archived.value }) : archived;
            },
          ],
          [
            key(codingSessionsOpen),
            (_who, input) => {
              const body = input as {
                project: string;
                harness: string;
                resume?: { session: string };
                key: string;
              };
              installer.ensureOnce(body.harness);
              return opener.open(body);
            },
          ],
        ],
        uploads: [
          [
            key(acpImageUpload),
            async (_who, input, body) => {
              const { session, bytes } = input as {
                session: string;
                bytes: number;
              };
              let data: Uint8Array;
              try {
                data = new Uint8Array(
                  await new Response(body.bytes).arrayBuffer(),
                );
              } catch {
                return err({
                  code: "invalid_input",
                  message: "upload body could not be read",
                });
              }
              if (data.byteLength !== bytes) {
                return err({
                  code: "invalid_input",
                  message: "upload input does not match the body",
                });
              }
              return await coding.writeImage(session, data);
            },
          ],
        ],
        fileStreams: [
          [
            key(acpImageRead),
            async (_who, input) => {
              const { session, path } = input as {
                session: string;
                path: string;
              };
              const read = await coding.readImage(session, path);
              return read.ok
                ? ok(bytesFileStream(read.value.bytes, read.value.mime))
                : read;
            },
          ],
        ],
        reads: (reads) => {
          // agent가 읽는 session 상태(부를 수 있는 목록, 팀)에서 GUI 탭 팀원은 그 탭의 모습(상태, 제목)으로 낸다. ledger에는 탭의 승인
          // 기다림이 없다. 묶인 탭이 없는 팀원은 쉬는 것이다(call이 오면 core가 탭을 연다).
          const memberLook = (session: string) => {
            if (ctx.peek.harnessMembers?.isMember(session) !== true) {
              return null;
            }
            return (
              agents.members.live(session) ?? {
                state: "idle" as const,
                title: null,
              }
            );
          };
          const sendable = reads.get(key(agentCallSendable));
          if (sendable !== undefined) {
            reads.set(key(agentCallSendable), async (who, input) => {
              const listed = (await sendable(who, input)) as Result<
                Output<typeof agentCallSendable>
              >;
              if (!listed.ok) return listed;
              return ok({
                ...listed.value,
                sessions: listed.value.sessions.map((one) => {
                  const look = memberLook(one.session);
                  return look === null
                    ? one
                    : {
                        ...one,
                        state: look.state,
                        title: look.title ?? one.title,
                      };
                }),
              });
            });
          }
          const team = reads.get(key(teamRead));
          if (team !== undefined) {
            reads.set(key(teamRead), async (who, input) => {
              const read = (await team(who, input)) as Result<
                Output<typeof teamRead>
              >;
              if (!read.ok) return read;
              type One = NonNullable<Output<typeof teamRead>["parent"]>;
              const patch = (one: One): One => {
                const look = memberLook(one.session);
                return look === null ? one : { ...one, state: look.state };
              };
              return ok({
                ...read.value,
                parent:
                  read.value.parent === null ? null : patch(read.value.parent),
                siblings: read.value.siblings.map(patch),
                children: read.value.children.map(patch),
              });
            });
          }
          reads
            .set(key(terminalsSavedSessions), async (_who, input) =>
              ok(
                await agents.savedSessions(
                  (input as { project: string }).project,
                ),
              ),
            )
            .set(key(codingAgentsList), async () =>
              ok({ harnesses: await harnesses.read() }),
            )
            .set(key(codingAgentsHookStatus), async () =>
              ok({ hooks: await installer.status() }),
            )
            .set(key(codingSessionsList), (_who, input) =>
              ok({
                sessions: coding.list((input as { project?: string }).project),
              }),
            )
            .set(key(codingSessionsSwitchPlan), (_who, input) =>
              coding.switchPlan((input as { session: string }).session),
            )
            .set(key(codingSessionsCliSessions), (_who, input) =>
              coding.cliSessions((input as { session: string }).session),
            )
            .set(key(codingSessionsRewindPreview), (_who, input) => {
              const { session, message } = input as {
                session: string;
                message: string;
              };
              return coding.rewindPreview(session, message);
            })
            .set(key(acpToolBodyRead), (_who, input) =>
              coding.toolBody(
                input as {
                  session: string;
                  tool_call: string;
                  part: "input" | "output";
                },
              ),
            );
        },
      });
    },
    async afterReady() {
      setup?.skillSync.request();
    },
    closeIntake() {
      for (const off of offs.splice(0)) off();
      clearInterval(beatTimer);
      beatTimer = undefined;
    },
    // handle을 닫고 socket과 per-run 폴더를 거둔다.
    async closeWork() {
      stopped = true;
      service?.stop();
      for (const server of servers.splice(0)) {
        await server.then((started) => started?.stop()).catch(() => {});
      }
      if (run !== null) {
        try {
          rmSync(run.dir, { recursive: true, force: true });
        } catch {
          // 지우지 못해도 다음 실행이 정리한다.
        }
      }
    },
  };
};
