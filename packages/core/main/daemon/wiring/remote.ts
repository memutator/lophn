// 기기(폰, 다른 컴퓨터)가 붙는 remote 연결과 내 기기 명단의 조립. 설정 `remote.enabled`가 켜지면 `remote.port`에 listener를 열고,
// `remote.relay`가 있으면 relay에도 건다. 둘은 따로 돈다(port를 못 열어도 relay는 돈다). 꺼지면 둘 다 닫는다.
// 기기 표(devices)와 명단 표의 command·read는 writer·reader Worker가 이 file을 팀 등록 file로 import해 얻는다.
// 표를 만드는 ledger step은 낸 step 목록의 끝에 붙어야 해서(schema-steps.lock.json) 이 wiring의 schemaStepsAfterTeams에 둔다.
// 명단의 main thread 사본(remote/roster.ts)을 여기서 들고, 기기의 kind(`ctx.deviceKind`)를 그 view로 채운다. 터미널 입력
// 허락(`ctx.terminalInputGrant`)은 명단에 없고 이 컴퓨터가 허락한 기기의 표(remote/grants.ts)가 든다. 명단을 고치는 `roster/*` route는 여기서 서명한 뒤 machine 자격 `roster/store`로 쓴다.
// core가 폰에 묻는 길(`ctx.phoneLink`)도 여기서 낸다. link는 build에서 만들고 host가 늦게 생겨도 같은 것을 쓴다.
// remote가 켜진 동안 명단의 다른 컴퓨터마다 link(remote/links.ts)를 들고, 이 컴퓨터가 초대장으로 드는 `roster/join`과 이 기계의
// 화면이 다른 기계를 부르는 `machines/*`를 그 link로 낸다. 같은 link로 상대가 든 옮기는 file을 받아 폴더의 받는 자리에 넘긴다
// (remote/carry.ts. remote가 켜진 동안만 돈다).
// remote key 둘(host key, 서명 key)에는 만든 기계의 id가 찍힌다. 기동마다 지금 id와 대조해 다른 기계에서 복사된 key거나 하나만
// 읽히면 명단을 버리고 둘 다 지운다. 명단에서 이 컴퓨터가 빠진 것을 알아도 같은 길로 버리고 새 key로 다시 선다.
import { readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import process from "node:process";
import type { z } from "zod";
import {
  canonicalize,
  createIdSource,
  cryptoRandom,
  type ErrorCode,
  err,
  ok,
  type Result,
} from "../../../../base/mod.ts";
import {
  devicesClearPush,
  devicesConnected,
  devicesList,
  devicesPushTargets,
  machinesAppTools,
  machinesCall,
  machinesList,
  machinesWatch,
  type RemoteDevice,
  type RosterEntryBody,
  type RosterView,
  remoteKeyText,
  remoteRelayStatus,
  rosterForgetAll,
  rosterInvite,
  rosterJoin,
  rosterLeave,
  rosterList,
  rosterPending,
  rosterRemove,
  rosterRename,
  rosterSetTerminalInput,
  rosterStatements,
  rosterStore,
} from "../../../../protocol/remote/mod.ts";
import {
  confirmationRefSchema,
  type Id,
} from "../../../../protocol/base/mod.ts";
import {
  machineGone,
  machineRemoved,
  machineSigningKey,
  signManifest,
} from "../../../../protocol/remote/carry.ts";
import {
  rosterGrants,
  rosterGrantSet,
  rosterGrantsSeed,
} from "../../../../protocol/remote/grants.ts";
import {
  type Assignment,
  assignmentGet,
} from "../../../../protocol/approvals/mod.ts";
import { agentRead } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import { jobEventTriggers } from "../../../../protocol/jobs/mod.ts";
import type { Workspace } from "../../../../protocol/lophn-agent/workspaces.ts";
import { resolveMachine } from "../../../../protocol/machine/requester.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  type Dial,
  join,
  parseInviteText,
} from "../../../../remote-client/mod.ts";
import { PERMISSIONS_PHONE_KIND_STEPS } from "../../../apps/permissions/schema.ts";
import { rewindUnknownSchemaSteps } from "../../../apps/rewind/mod.ts";
import { foldSyncLogDevice } from "../../../apps/sync/device-fold.ts";
import {
  SYNC_LOG_DESTINATION_STEPS,
  SYNC_LOG_MACHINE_STEPS,
  SYNC_LOG_SCHEMA_STEPS,
} from "../../../apps/sync/schema.ts";
import { type PushDevice } from "../../../attention/mod.ts";
import { createExpoPushSender } from "../../../attention/push/mod.ts";
import {
  devicesSetting,
  remoteAddressesSetting,
  remoteEnabledSetting,
  remotePortSetting,
  remotePushSetting,
  remoteRelaySetting,
} from "../../../config/shell-settings.ts";
import { callPolicySetting } from "../../../config/setting-declarations.ts";
import {
  DEFAULT_CALL_POLICY,
  isPrivate,
} from "../../../../protocol/lophn-agent/call-policy.ts";
import { receivedAppEvent } from "../../../apps/events/mod.ts";
import { hidingSessions } from "../../../events/mod.ts";
import { EVENT_PUBLICATIONS_MACHINE_STEPS } from "../../../apps/events/schema.ts";
import { invocationsRemoteCallerSchemaSteps } from "../../../apps/invocations/mod.ts";
import {
  FOLDER_AWAY_NOTIFIED_STEPS,
  FOLDER_CARRY_MARKS_STEPS,
  FOLDER_CODE_COMMIT_STEPS,
  FOLDER_DESTINATION_STEPS,
  FOLDER_EVENTS_SEEN_STEPS,
  FOLDER_SCHEMA_STEPS,
} from "../../../folder/schema.ts";
import { OUTBOUND_CALLS_SCHEMA_STEPS } from "../../../apps/calls/outbound-schema.ts";
import { providerMultiCredentialsSchemaSteps } from "../../../lophn-agent/providers/mod.ts";
import { guiMemberSchemaSteps } from "../../../lophn-agent/session/mod.ts";
import {
  memberRunsOnSchemaSteps,
  remoteSenderMessagesSchemaSteps,
} from "../../../lophn-agent/session/remote-sender-schema.ts";
import {
  mailSchemaSteps,
  remoteSenderCallsSchemaSteps,
} from "../../../router/mod.ts";
import { jobMachineSchemaSteps } from "../../../jobs/machine-schema.ts";
import { readMachineId } from "../../../machine/mod.ts";
import {
  PROJECTS_FORMER_IDENTITY_STEPS,
  PROJECTS_IDENTITY_STEPS,
  PROJECTS_SEPARATED_STEPS,
} from "../../../projects/registry/mod.ts";
import { devicePrincipal } from "../../../remote/call.ts";
import { type CarryLinks, createCarryLinks } from "../../../remote/carry.ts";
import {
  createVaultSync,
  type VaultSync,
} from "../../../secrets/vault-sync.ts";
import { browserShareSetting } from "../../../config/shell-settings.ts";
import { browserVaultExchange } from "../../../../protocol/secrets/browser-vault.ts";
import { publishStateChanged } from "../../../../protocol/events/changes.ts";
import {
  changesSubscriptions,
  createRemoteSubscriptions,
  sharesAppEvent,
} from "../../../remote/subscriptions.ts";
import {
  createGrants,
  GRANTS_COMMANDS,
  GRANTS_SCHEMA_STEPS,
  type Grants,
  grantsRead,
} from "../../../remote/grants.ts";
import {
  addSigningKey,
  createDeviceCredentials,
  createLinks,
  createMachineAppTools,
  createMachineRoutes,
  createPhoneLink,
  createRemoteCall,
  createRemoteHost,
  createRoster,
  DEVICES_COMMANDS,
  DEVICES_KIND_STEPS,
  DEVICES_SCHEMA_STEPS,
  DEVICES_TOPIC,
  type DevicesChange,
  describeRemoteListenerError,
  devicesListRead,
  devicesPushTargetsRead,
  dialNodeWebSocket,
  type Links,
  loadRemoteKeys,
  openRemoteListener,
  type PhoneLink,
  type RemoteDevices,
  type RemoteHost,
  type RemoteKeys,
  type RemoteListener,
  ROSTER_SCHEMA_STEPS,
  type Roster,
  type RosterChange,
  remoteKeysState,
  removeRemoteKeys,
  rosterStatementsRead,
  rosterStoreCommand,
  screensFolded,
  screensPaired,
  screensRenamed,
  screensRevoked,
  stampHostKeyMachine,
} from "../../../remote/mod.ts";
import {
  openRelayWebSocket,
  type RelayClient,
  startRelayClient,
} from "../../../remote/relay-client.ts";
import { systemTimers } from "../../../runs/mod.ts";
import { RouteRegistry } from "../../../server/mod.ts";
import {
  type ReaderRegistration,
  withAfterCommit,
} from "../../../storage/ledger/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import { createAdmission } from "../../../supervision/responsiveness/mod.ts";
import type { WiringContext, WiringFactory } from "./context.ts";

// 기기 행의 마지막 연결을 적고 읽고 push token을 읽고 거두고, 명단을 읽고 쓰고 버리는 core 안 machine 자격이다.
// 기동 때 ledger에 기록한다.
const REMOTE_PRINCIPAL = "machine:remote";
const REMOTE_CONTEXT: AuthenticatedContext = {
  principal: REMOTE_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      devicesConnected.name,
      devicesList.name,
      devicesClearPush.name,
      devicesPushTargets.name,
      rosterStatements.name,
      rosterStore.name,
      rosterForgetAll.name,
      rosterGrants.name,
      rosterGrantSet.name,
      rosterGrantsSeed.name,
      assignmentGet.name,
      agentRead.name,
      jobEventTriggers.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: REMOTE_PRINCIPAL,
};

type Screen = z.infer<typeof devicesSetting.type>[number];

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

const READS = [
  devicesListRead,
  devicesPushTargetsRead,
  rosterStatementsRead,
  grantsRead,
];
// 명단 저장은 접힌 기기 id로 앱 sync log도 고친다(같은 write).
export const REMOTE_COMMANDS = [
  ...DEVICES_COMMANDS,
  ...GRANTS_COMMANDS,
  rosterStoreCommand(foldSyncLogDevice),
];

export function createCoreRegistration() {
  return {
    commands: REMOTE_COMMANDS,
    reads: READS,
    memoryRoutes: [
      remoteRelayStatus,
      rosterList,
      rosterInvite,
      rosterRemove,
      rosterSetTerminalInput,
      rosterRename,
      rosterLeave,
      rosterJoin,
      machinesList,
      machinesCall,
      machinesWatch,
      machinesAppTools,
    ],
  };
}

export function createReaderRegistration(): ReaderRegistration {
  return { reads: READS, ports: new Map() };
}

// 이 기계의 network interface 주소. loopback과 link-local(fe80::, 폰이 scope 없이 붙지 못한다)은 뺀다.
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((each) => !each.internal && !each.address.startsWith("fe80:"))
    .map((each) => each.address)
    .slice(0, 16);
}

// QR과 hello에 싣는 주소 후보: 사람이 적은 주소(`remote.addresses`)가 먼저, 그 뒤에 interface 주소. hello가 붙을 때마다
// 다시 실어 pairing 뒤에 생긴 주소(새 network, Tailscale)도 붙는 쪽이 안다.
function directAddresses(ctx: WiringContext): string[] {
  const written = ctx.settings.get(remoteAddressesSetting) ?? [];
  return [...new Set([...written, ...lanAddresses()])].slice(0, 16);
}

// 명단의 컴퓨터 항목이 싣는 OS.
function computerOs(): RosterEntryBody["os"] {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

// 이 판 전에 만든 host key에 이 기계의 id를 찍는다. key 값은 그대로라 이미 pairing한 폰이 그대로 붙는다.
// ensureMachine이 data step보다 먼저 돌아 machine.json이 있다.
export const hostKeyMachineStep: DataStep = {
  id: "remote.host-key.machine",
  async run(root) {
    const machine = await readMachineId(root);
    if (!machine.ok) return machine;
    try {
      await stampHostKeyMachine(`${root}/remote`, machine.value);
    } catch {
      return err({
        code: "unavailable",
        message: "the machine id could not be written to the remote host key",
      });
    }
    return ok(undefined);
  },
};

// 명단 전에 만든 host key에 짝 서명 key를 더한다. 없으면 기동이 host key 하나만 읽혀 둘 다 지우고, 이미 pairing한 폰이 다시
// 들어와야 한다. host key에 찍는 step 뒤에 돈다.
export const signingKeyStep: DataStep = {
  id: "remote.signing-key",
  async run(root) {
    try {
      await addSigningKey(`${root}/remote`, cryptoRandom);
    } catch {
      return err({
        code: "unavailable",
        message: "the remote signing key could not be written",
      });
    }
    return ok(undefined);
  },
};

// shell main이 다른 컴퓨터에 따로 붙던 기기 key와 기계 목록(`shell/viewer/key.json`, `machines.json`)을 지운다. 이제 core가 명단으로
// 붙고, 컴퓨터끼리는 초대로 한 번 다시 잇는다. 시작 기계(`start`·`last`와 `last`인 기계의 보이는 이름)는 `viewer/start.json`으로
// 옮기고 창 자리(`viewer/windows.json`)는 그대로 둔다(둘 다 `shell.viewer.drop`이 이어서 지운다). 표지가 이 기계와 다른 file(복사된 data root)은 옮기지 않고 지운다.
export const viewerRosterStep: DataStep = {
  id: "shell.viewer.roster",
  async run(root) {
    const dir = `${root}/shell/viewer`;
    const machine = await readMachineId(root);
    if (!machine.ok) return machine;
    let saved:
      | {
          machine?: unknown;
          start?: unknown;
          last?: unknown;
          computers?: {
            machine?: unknown;
            name?: unknown;
            announced?: unknown;
          }[];
        }
      | undefined;
    try {
      saved = JSON.parse(await readFile(`${dir}/machines.json`, "utf8"));
    } catch {
      saved = undefined;
    }
    try {
      if (saved?.machine === machine.value && saved.start !== undefined) {
        const last = typeof saved.last === "string" ? saved.last : null;
        const computer = Array.isArray(saved.computers)
          ? saved.computers.find((each) => each?.machine === last)
          : undefined;
        const name = computer?.name ?? computer?.announced;
        const start = {
          machine: machine.value,
          start: saved.start,
          last,
          last_name: typeof name === "string" ? name : null,
        };
        await writeFile(
          `${dir}/start.json.tmp`,
          `${JSON.stringify(start, null, 2)}\n`,
          { mode: 0o600 },
        );
        await rename(`${dir}/start.json.tmp`, `${dir}/start.json`);
      }
      for (const file of ["key.json", "machines.json"]) {
        await unlink(`${dir}/${file}`).catch((thrown: unknown) => {
          if ((thrown as NodeJS.ErrnoException).code !== "ENOENT") throw thrown;
        });
      }
    } catch {
      return err({
        code: "unavailable",
        message: "the old desktop viewer files could not be moved",
      });
    }
    return ok(undefined);
  },
};

// 한 창이 모든 기계를 보이므로 기계마다의 창과 시작 기계(`shell/viewer/start.json`, `windows.json`)를 다시 읽는 code가 없다. 두
// file을 지우고 폴더가 비면 폴더도 지운다. 다른 file이 있으면 둔다. 없으면 아무것도 하지 않는다.
export const viewerDropStep: DataStep = {
  id: "shell.viewer.drop",
  async run(root) {
    const dir = `${root}/shell/viewer`;
    const ignore = (codes: string[]) => (thrown: unknown) => {
      if (!codes.includes((thrown as NodeJS.ErrnoException).code ?? "")) {
        throw thrown;
      }
    };
    try {
      for (const file of ["start.json", "windows.json"]) {
        await unlink(`${dir}/${file}`).catch(ignore(["ENOENT"]));
      }
      await rmdir(dir).catch(ignore(["ENOENT", "ENOTEMPTY", "EEXIST"]));
    } catch {
      return err({
        code: "unavailable",
        message: "the old desktop window files could not be removed",
      });
    }
    return ok(undefined);
  },
};

const DEVICE_PRINCIPAL = "device:";

// `roster/join`이 초대한 컴퓨터에 붙어 답을 기다리는 한도. WebSocket 열기(10초)와 host의 handshake 한도(10초)를 더한 것이다.
// 넘으면 못 닿은 것과 같이 저장하고 pending으로 끝난다: 초대 서명 statement는 link나 폰이 나중에 나른다.
const JOIN_DEADLINE_MS = 20_000;

// `dial`은 다른 컴퓨터에 붙는 길이다(link와 roster/join). `openListener`는 port bind 길이다. test는 가짜를 넘긴다.
export function remoteWiring(
  dial: Dial = dialNodeWebSocket,
  openListener: typeof openRemoteListener = openRemoteListener,
): ReturnType<WiringFactory> {
  let listener: RemoteListener | undefined;
  // remote가 켜진 상태에서 listener를 열지 못한 까닭(예: EADDRINUSE). 꺼지거나 다시 열리면 비운다.
  let listenerFailure: string | undefined;
  let relay: RelayClient | undefined;
  let host: RemoteHost | undefined;
  // 이 컴퓨터의 key 둘. remote를 켤 때 만들고, 있으면 기동 때 읽는다. 명단을 버릴 때 지운다.
  let keys: RemoteKeys | undefined;
  // 다른 컴퓨터가 이 컴퓨터를 빼 명단과 key를 버린 때. 화면이 알리려고 `roster/list`에 싣는다. 다시 들면 지운다.
  let removedAt: string | null = null;
  let unsubscribe: (() => void) | undefined;
  // push를 보낼 기기의 메모리 사본(`devices/push_targets`). `StateChanged{remote_devices}`가 오면 다시 읽는다.
  let pushDevices: readonly PushDevice[] = [];
  let refreshing = Promise.resolve();
  // host key의 공개 key 글(push 글의 `data.host`). key를 풀기 전과 remote가 꺼진 동안은 보낼 곳이 없는 것으로 친다.
  let hostText: string | undefined;
  let sender: ReturnType<typeof createExpoPushSender> | undefined;
  // 켜고 끄기와 명단 버리기는 하나씩 한다. 설정이 빨리 여러 번 바뀌어도 마지막 값으로 맞는다.
  let reconciling = Promise.resolve();
  // remote 연결만의 한도다. 기기는 principal마다 따로 서고 사람 token(loopback API)의 자리를 쓰지 않는다.
  const admission = createAdmission();
  // 붙은 기기 연결을 안다. remote가 꺼져 있으면 붙은 연결이 없어 `call`은 `unavailable`(phone_unreachable)이다.
  let phoneLink: PhoneLink;
  let roster: Roster;
  // 이 컴퓨터가 터미널 입력을 허락한 기기(key)의 메모리 사본. 입력마다 동기로 묻는다.
  let grants: Grants;
  // 명단의 다른 컴퓨터마다 하나인 link. remote가 켜진 동안만 붙는다.
  let links: Links;
  let carry: CarryLinks;
  let vaultSync: VaultSync;
  let subscriptions: ReturnType<typeof createRemoteSubscriptions>;

  function logError(ctx: WiringContext, event: string, thrown: unknown) {
    ctx.telemetry.logger.error({
      component: "remote",
      event,
      fields: {
        message: thrown instanceof Error ? thrown.message : String(thrown),
      },
    });
  }

  function command(
    ctx: WiringContext,
    name: string,
    input: unknown,
  ): Promise<Result<unknown>> {
    return ctx.writer
      .command(REMOTE_CONTEXT, {
        command: name,
        input,
        compare: {},
        idempotency_key: crypto.randomUUID(),
        prepared: [],
      })
      .then((done) => (done.ok ? ok(done.value.result) : done));
  }

  async function read(
    ctx: WiringContext,
    route: { resource: string; method: string },
  ): Promise<Result<unknown>> {
    return ctx.runtime.reads.get(key(route))!(REMOTE_CONTEXT, {});
  }

  // 설정 `shell.devices`를 고친다. preview 기기 고르기와 `--device`가 이름으로 본다. 기기의 항목은 `device`로 찾는다.
  // 고친 목록이 지금과 같으면 쓰지 않는다: id 접기는 명단을 저장할 때마다 다시 온다.
  function editScreens(ctx: WiringContext, edit: (list: Screen[]) => Screen[]) {
    const list = ctx.settings.get(devicesSetting) ?? [];
    const next = edit(list);
    if (canonicalize(next) === canonicalize(list)) return;
    const written = ctx.settingsUpdate([
      { key: devicesSetting.key, action: "set", value: next },
    ]);
    if (!written.ok || written.value.rejected.length > 0) {
      logError(ctx, "devices_setting_not_saved", "shell.devices");
    }
  }

  async function listDevices(
    ctx: WiringContext,
  ): Promise<Result<RemoteDevice[]>> {
    const listed = await read(ctx, devicesList);
    return listed.ok
      ? ok((listed.value as { devices: RemoteDevice[] }).devices)
      : listed;
  }

  // QR·초대장과 명단의 자기 주소. listener가 열려 있으면 그 port다.
  function ownReach(ctx: WiringContext) {
    return {
      addresses: directAddresses(ctx),
      port: listener?.port ?? ctx.settings.get(remotePortSetting) ?? 7432,
      relay: relay?.url ?? null,
    };
  }

  function devicesOf(ctx: WiringContext): RemoteDevices {
    return {
      connected(input) {
        const device = roster
          .view()
          .devices.find((each) => each.body.id === input.id);
        // 컴퓨터는 이 컴퓨터의 기기 행이 없다(기준, push, 화면은 폰만의 것이다).
        if (device?.body.kind !== "phone") return;
        void (async () => {
          const done = await command(ctx, devicesConnected.name, input);
          if (!done.ok) {
            // hello에 화면이 없는 폰(dev 도구)은 행을 만들 수 없다. 행이 없는 것은 그 폰의 일이라 오류로 남기지 않는다.
            if (!(input.phone === undefined && done.error.code === "not_found"))
              logError(ctx, "connected_not_saved", done.error.message);
            return;
          }
          // 폰에서 이름을 바꿨다(알린 이름이 마지막으로 받은 것과 다르다).
          if ((done.value as { renamed: boolean }).renamed) {
            const renamed = await roster.rename(input.id, input.name);
            if (!renamed.ok)
              logError(ctx, "rename_not_signed", renamed.error.message);
          }
        })();
      },
    };
  }

  function refreshPushDevices(ctx: WiringContext) {
    refreshing = refreshing.then(async () => {
      const targets = await read(ctx, devicesPushTargets);
      if (!targets.ok)
        return logError(ctx, "push_targets_failed", targets.error.message);
      pushDevices = (targets.value as { devices: PushDevice[] }).devices;
    });
  }

  // 명단에서 이 컴퓨터가 빠졌다(이 컴퓨터를 root로 본 view의 효력 있는 빼기가 자기 key나 서명 key를 든다).
  function selfRemoved(view: RosterView): boolean {
    if (keys === undefined) return false;
    const hostKey = remoteKeyText(keys.host.publicKey);
    const signingKey = remoteKeyText(keys.signing.publicKey);
    return view.removed.some(
      (each) =>
        each.body.key === hostKey || each.body.signing_key === signingKey,
    );
  }

  // 명단과 key를 버린다: 복사된 data root, key 하나만 읽힘, 명단에서 이 컴퓨터가 빠짐. key를 먼저 지우고 명단을 버리므로 중간에
  // 죽으면 다음 기동이 "key 없이 남은 명단"으로 보고 다시 버린다. 붙은 연결을 닫고, remote가 켜져 있으면 다음 reconcile이 새
  // key와 새 자기 항목(새 id)으로 다시 선다.
  async function forgetRoster(
    ctx: WiringContext,
    event: string,
    message: string,
    fields: Record<string, unknown>,
  ): Promise<Result<void>> {
    try {
      await removeRemoteKeys(`${ctx.root.path}/remote`);
    } catch (thrown) {
      logError(ctx, "remote_keys_not_removed", thrown);
      return err({
        code: "unavailable",
        message: "the remote keys could not be removed",
      });
    }
    keys = undefined;
    hostText = undefined;
    links.sync(undefined);
    host?.shutdown();
    host = undefined;
    await listener?.close();
    listener = undefined;
    listenerFailure = undefined;
    relay?.close();
    relay = undefined;
    const forgot = await command(ctx, rosterForgetAll.name, {});
    if (!forgot.ok) return forgot;
    grants.clear();
    await roster.useKeys(undefined);
    const loaded = await roster.load();
    if (!loaded.ok) return loaded;
    if (event === "removed_from_roster") removedAt = ctx.clock.now();
    ctx.telemetry.logger.warn({
      component: "remote",
      event,
      message,
      fields: { ...fields, devices: (forgot.value as { count: number }).count },
    });
    return ok(undefined);
  }

  // 자기 항목을 두고(기계 이름도 맞춘다) 옛 기기 표의 phone 행 가운데 아직 서명하지 않은 것에 서명한다.
  async function identify(
    ctx: WiringContext,
    reach?: ReturnType<typeof ownReach>,
  ): Promise<Result<void>> {
    const stored = await read(ctx, rosterStatements);
    if (!stored.ok) return stored;
    const self = await roster.ensureSelf({
      machine: ctx.machine.id,
      name: () => ctx.machine.status().name,
      os: computerOs(),
      ...(reach === undefined ? {} : { reach }),
      adopt: (stored.value as z.infer<typeof rosterStatements.output>).adopt,
    });
    return self.ok ? ok(undefined) : self;
  }

  // 기계 이름이 자기 항목의 이름과 다르면(machine/rename) 바로 새 rev로 서명한다. 저장이 명단을 link에 밀고 StateChanged를 낸다.
  // 이름은 ensureSelf가 차례가 왔을 때 읽으므로, 다른 컴퓨터가 바꾼 이름을 기계 이름으로 옮기는 중이면 그 뒤의 이름이다.
  function resignSelf(ctx: WiringContext) {
    if (keys === undefined) return;
    const id = roster.self()?.id;
    const body = roster
      .view()
      .devices.find((each) => each.body.id === id)?.body;
    if (body === undefined || body.name === ctx.machine.status().name) return;
    void roster
      .ensureSelf({
        machine: ctx.machine.id,
        name: () => ctx.machine.status().name,
        os: computerOs(),
      })
      .then((self) => {
        if (!self.ok) logError(ctx, "roster_not_signed", self.error.message);
      });
  }

  // 명단이 바뀌어 저장된 뒤. 빠진 기기가 붙어 있으면 그 빼기가 든 명단을 먼저 민 뒤 자격을 거두고 연결을 닫는다.
  // 다른 컴퓨터가 이 컴퓨터의 이름을 바꿨으면(roster/rename) 기계 이름으로 받는다. 명단의 이름과 기계 이름이 한 값으로 남고
  // 다음 기동의 ensureSelf가 되돌리지 않는다. 명단은 이것이 끝날 때까지 다음 고치기를 하지 않는다.
  async function applyChange(ctx: WiringContext, change: RosterChange) {
    if (selfRemoved(change.after)) {
      reconciling = reconciling
        .then(() =>
          forgetRoster(
            ctx,
            "removed_from_roster",
            "this computer was removed from the device roster; its roster and keys were dropped and new keys will be made",
            {},
          ),
        )
        .then((done) => {
          if (!done.ok) logError(ctx, "roster_not_forgotten", done.error);
          return reconcile(ctx);
        });
      return;
    }
    const self = roster.self();
    const named = change.after.devices.find((each) => each.body.id === self?.id)
      ?.body.name;
    if (named !== undefined && named !== ctx.machine.status().name) {
      const renamed = await ctx.machine.rename(named);
      if (!renamed.ok)
        logError(ctx, "machine_not_renamed", renamed.error.message);
    }
    // 초대장의 허락은 초대한 컴퓨터만 자기 표에 적는다. 정해진 빼기로 빠진 기기의 허락은 거둔다(다시 들면 새 key다).
    for (const { key, terminal_input } of change.invited) {
      await setGrant(ctx, key, terminal_input);
    }
    for (const { settled, body } of change.after.removed) {
      if (settled && grants.has(body.key)) await setGrant(ctx, body.key, false);
    }
    host?.pushRoster(change.snapshot);
    carry.rosterChanged();
    links.sync(hostText === undefined ? undefined : keys?.host);
    links.pushRoster(change.snapshot);
    const kept = new Set(change.after.devices.map((each) => each.body.id));
    host?.revoked(
      change.before.devices
        .map((each) => each.body.id)
        .filter((id) => !kept.has(id)),
    );
    for (const device of change.after.devices) {
      const before = change.before.devices.find(
        (each) => each.body.id === device.body.id,
      );
      if (before !== undefined && before.body.name !== device.body.name) {
        editScreens(ctx, (list) =>
          screensRenamed(list, device.body.id, device.body.name),
        );
      }
    }
  }

  // 옛 판은 허락을 명단 항목에 서명해 들었다. 이 판의 첫 기동에서 켜져 있던 것을 이 컴퓨터의 표로 한 번 옮긴다(옮기기 전용: 옛
  // 칸을 읽는 곳은 여기와 `roster/statements`의 `adopt`뿐이다). 이 기동 바로 전까지 이 컴퓨터에 치던 기기가 끊기지 않게 한다.
  // 이긴 항목은 서명을 확인한 view에서만 정해져 SQL step으로는 옮기지 못한다. 컴퓨터 항목은 기본이 켬이었으므로 다른
  // 컴퓨터의 허락도 옮겨진다. 엇갈려 빠진 기기와 꺼진 값은 옮기지 않는다. 표지는 명단이 비어 있어도 쓴다.
  async function seedGrants(ctx: WiringContext): Promise<Result<void>> {
    const stored = await read(ctx, rosterStatements);
    if (!stored.ok) return stored;
    const self = roster.self()?.id;
    const entries = roster
      .view()
      .devices.filter(
        (each) => each.body.id !== self && each.body.terminal_input === true,
      )
      .map((each) => each.body.key);
    const adopted = (
      stored.value as z.infer<typeof rosterStatements.output>
    ).adopt
      .filter((each) => each.terminal_input)
      .map((each) => each.key);
    return grants.seed([...new Set([...entries, ...adopted])]);
  }

  async function setGrant(ctx: WiringContext, key: string, on: boolean) {
    const done = await grants.set(key, on);
    if (!done.ok) logError(ctx, "grant_not_saved", done.error.message);
  }

  async function reconcile(ctx: WiringContext): Promise<void> {
    const enabled = ctx.settings.get(remoteEnabledSetting) === true;
    const port = enabled ? ctx.settings.get(remotePortSetting) : undefined;
    const relayUrl = enabled
      ? ctx.settings.get(remoteRelaySetting) || undefined
      : undefined;
    // 꺼질 때는 붙은 연결에 closed(shutdown)을 보내고 닫는다.
    if (!enabled) host?.shutdown();
    if (listener !== undefined && listener.port !== port) {
      await listener.close();
      listener = undefined;
      listenerFailure = undefined;
    }
    if (relay !== undefined && relay.url !== relayUrl) {
      relay.close();
      relay = undefined;
    }
    if (!enabled) {
      // 끈 뒤에는 push도 멈춘다. bindPush의 기기 목록이 hostText로 갈린다. 다시 켜면 key를 풀어 다시 선다.
      listenerFailure = undefined;
      hostText = undefined;
      carry.stop();
      vaultSync.stop();
      links.sync(undefined);
      return;
    }
    if (keys === undefined) {
      try {
        keys = await loadRemoteKeys(
          `${ctx.root.path}/remote`,
          ctx.random,
          ctx.machine.id,
        );
      } catch (thrown) {
        listenerFailure = `remote keys could not be loaded: ${thrown instanceof Error ? thrown.message : String(thrown)}`;
        logError(ctx, "listener_failed", thrown);
        return;
      }
      await roster.useKeys(keys);
    }
    // listener·relay를 열기 전에 자기 항목과 옮긴 폰 행에 서명한다. 이미 pairing한 폰이 첫 연결에서 명단에 있다.
    const identified = await identify(ctx);
    if (!identified.ok) {
      logError(ctx, "roster_not_signed", identified.error.message);
      return;
    }
    const staticKey = keys.host;
    hostText = remoteKeyText(staticKey.publicKey);
    const privateApp = (app: string) =>
      isPrivate(ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY, {
        kind: "app",
        id: app,
      });
    host ??= createRemoteHost({
      staticKey,
      machine: () => ({
        id: ctx.machine.id,
        name: ctx.machine.status().name,
        addresses: directAddresses(ctx),
      }),
      random: ctx.random,
      timers: systemTimers,
      // 폰과 다른 컴퓨터가 구독하는 Bus다. GUI 탭의 팀원 session은 그 탭이 자리라 그 event를 내지 않는다.
      bus: hidingSessions(
        ctx.bus,
        (session) => ctx.peek.harnessMembers?.isMember(session) ?? false,
      ),
      roster: {
        find: (each) => roster.find(each),
        join: (each, statements) => roster.join(each, statements),
        receive: (snapshot) => roster.receive(snapshot),
      },
      devices: devicesOf(ctx),
      credentials: createDeviceCredentials({
        registry: ctx.registry,
        record: (context) => ctx.runtime.record(context),
      }),
      call: createRemoteCall({
        registry: ctx.registry,
        routes: new RouteRegistry(ctx.allRoutes),
        clock: ctx.clock,
        writer: ctx.writer,
        reads: ctx.runtime.reads,
        memory: ctx.runtime.memory.handlers,
        fileStreams: ctx.fileStreams,
        uploads: ctx.uploads,
        bus: ctx.bus,
        admission,
        onThrown: (thrown) => logError(ctx, "handler_threw", thrown),
        granted: (principal) => ctx.terminalInputGrant(principal),
        kind: (principal) => ctx.deviceKind(principal),
        privateApp,
        async confirm(request) {
          const issued = await ctx.runtime.confirmation({
            action: "issue",
            request,
          });
          if (!issued.ok) return issued;
          const ref = confirmationRefSchema.safeParse(
            (issued.value as { confirmation?: unknown }).confirmation,
          );
          return ref.success
            ? ok(ref.data)
            : err({ code: "internal", message: "confirmation was not issued" });
        },
      }),
      admission,
      kind: (principal) => ctx.deviceKind(principal),
      // 다른 컴퓨터에 내주는 앱 event는 이 기계의 call 정책에서 private이 아닌 앱이 낸 것뿐이다.
      appEventShared: (event) => sharesAppEvent(event, privateApp),
      deviceGone: (device) =>
        ctx.attention.forgetReporter(devicePrincipal(device)),
      views: ctx.appViews,
      phoneLink,
      logger: ctx.telemetry.logger,
    });
    const accept = host.accept;
    if (relayUrl !== undefined && relay === undefined) {
      relay = startRelayClient({
        url: relayUrl,
        staticKey,
        open: openRelayWebSocket,
        timers: systemTimers,
        accept: (socket) => void accept(socket),
      });
    }
    if (port === undefined) {
      listenerFailure = undefined;
    } else if (listener === undefined) {
      try {
        listener = await openListener({
          port,
          accept: (socket) => void accept(socket),
        });
        listenerFailure = undefined;
      } catch (thrown) {
        listenerFailure = describeRemoteListenerError(port, thrown);
        logError(ctx, "listener_failed", thrown);
      }
    }
    // 명단의 자기 주소를 지금 listener·relay로 맞춘다. 다른 컴퓨터와 폰이 명단으로 이 컴퓨터에 닿는다.
    const reached = await identify(ctx, ownReach(ctx));
    if (!reached.ok) logError(ctx, "roster_not_signed", reached.error.message);
    carry.start();
    vaultSync.start();
    links.sync(keys.host);
    refreshSubscriptions(ctx);
  }

  // 구독을 다시 계산해 건다(job과 앱 선언, 명단이 바뀐 뒤와 core가 설 때).
  function refreshSubscriptions(ctx: WiringContext) {
    void subscriptions
      .refresh()
      .catch((thrown) => logError(ctx, "subscriptions_not_applied", thrown));
  }

  // `roster/*` route가 자기 항목이 없을 때(remote를 켠 적이 없다) 내는 답.
  const off = () =>
    err({
      code: "unavailable" as const,
      message: "remote has not been turned on",
    });

  function idOf(done: Result<void>, id: string) {
    return done.ok ? ok({ id }) : done;
  }

  return {
    name: "remote",
    schemaStepsAfterTeams: [
      ...DEVICES_SCHEMA_STEPS,
      ...SYNC_LOG_SCHEMA_STEPS,
      ...PERMISSIONS_PHONE_KIND_STEPS,
      ...DEVICES_KIND_STEPS,
      ...jobMachineSchemaSteps,
      ...PROJECTS_IDENTITY_STEPS,
      ...SYNC_LOG_MACHINE_STEPS,
      ...FOLDER_SCHEMA_STEPS,
      ...FOLDER_AWAY_NOTIFIED_STEPS,
      ...rewindUnknownSchemaSteps,
      ...ROSTER_SCHEMA_STEPS,
      ...FOLDER_EVENTS_SEEN_STEPS,
      ...EVENT_PUBLICATIONS_MACHINE_STEPS,
      ...FOLDER_CARRY_MARKS_STEPS,
      ...PROJECTS_FORMER_IDENTITY_STEPS,
      ...invocationsRemoteCallerSchemaSteps,
      ...GRANTS_SCHEMA_STEPS,
      ...FOLDER_CODE_COMMIT_STEPS,
      ...OUTBOUND_CALLS_SCHEMA_STEPS,
      ...providerMultiCredentialsSchemaSteps,
      ...PROJECTS_SEPARATED_STEPS,
      ...guiMemberSchemaSteps,
      ...remoteSenderCallsSchemaSteps,
      ...remoteSenderMessagesSchemaSteps,
      ...mailSchemaSteps,
      ...memberRunsOnSchemaSteps,
      ...SYNC_LOG_DESTINATION_STEPS,
      ...FOLDER_DESTINATION_STEPS,
    ],
    dataSteps: [
      hostKeyMachineStep,
      signingKeyStep,
      viewerRosterStep,
      viewerDropStep,
    ],
    operations: () => [
      { name: devicesConnected.name, actors: ["machine"], kind: "command" },
      { name: devicesClearPush.name, actors: ["machine"], kind: "command" },
      { name: devicesPushTargets.name, actors: ["machine"], kind: "read" },
      { name: rosterStatements.name, actors: ["machine"], kind: "read" },
      { name: rosterStore.name, actors: ["machine"], kind: "command" },
      { name: rosterForgetAll.name, actors: ["machine"], kind: "command" },
      { name: rosterGrants.name, actors: ["machine"], kind: "read" },
      { name: rosterGrantSet.name, actors: ["machine"], kind: "command" },
      { name: rosterGrantsSeed.name, actors: ["machine"], kind: "command" },
    ],
    records: () => [REMOTE_CONTEXT],
    async build(ctx) {
      sender = createExpoPushSender({
        fetch: (url, init) => fetch(url, init),
        url: () => ctx.settings.get(remotePushSetting) ?? "",
        clock: ctx.clock,
        timers: systemTimers,
        onDeadToken(token) {
          const dead = pushDevices.find((each) => each.token === token);
          if (dead === undefined) return;
          void command(ctx, devicesClearPush.name, {
            id: dead.id,
            token,
          }).then((done) => {
            if (!done.ok)
              logError(ctx, "push_token_not_cleared", done.error.message);
          });
        },
      });
      ctx.attention.bindPush({
        devices: () => (hostText === undefined ? [] : pushDevices),
        send: (message) => sender!.send(message),
        host: () => hostText ?? "",
      });
      roster = createRoster({
        clock: ctx.clock,
        random: ctx.random,
        ids: createIdSource({ clock: ctx.clock, random: ctx.random }),
        load: async () => {
          const stored = await read(ctx, rosterStatements);
          return stored.ok
            ? ok(stored.value as z.infer<typeof rosterStatements.output>)
            : stored;
        },
        store: async (input) => {
          const done = await command(ctx, rosterStore.name, input);
          return done.ok ? ok(undefined) : done;
        },
        changed: (change) => applyChange(ctx, change),
      });
      grants = createGrants({
        load: async () => {
          const stored = await read(ctx, rosterGrants);
          return stored.ok
            ? ok(stored.value as z.infer<typeof rosterGrants.output>)
            : stored;
        },
        set: async (grantKey, on) => {
          const done = await command(ctx, rosterGrantSet.name, {
            key: grantKey,
            on,
          });
          return done.ok ? ok(undefined) : done;
        },
        // build는 쓰기 앞 처리기를 접은 `ctx.writer`가 생기기 전이라 날 writer로 쓴다(commit 뒤 할 일이 없는 command다).
        seed: async (seedKeys) => {
          const done = await ctx.runtime.writer.command(REMOTE_CONTEXT, {
            command: rosterGrantsSeed.name,
            input: { keys: seedKeys },
            compare: {},
            idempotency_key: crypto.randomUUID(),
            prepared: [],
          });
          return done.ok ? ok(undefined) : done;
        },
      });
      // API가 열리기 전에 읽는다. kind는 이 view로, 터미널 입력 허락은 이 컴퓨터의 표로 답한다. 복사된 data root인지는 start가 본다.
      const loaded = await roster.load();
      if (!loaded.ok) return loaded;
      const dir = `${ctx.root.path}/remote`;
      if ((await remoteKeysState(dir, ctx.machine.id)) === "ok") {
        keys = await loadRemoteKeys(dir, ctx.random, ctx.machine.id);
        await roster.useKeys(keys);
      }
      const granted = await grants.load();
      if (!granted.ok) return granted;
      if (!grants.seeded()) {
        const seeded = await seedGrants(ctx);
        if (!seeded.ok) return seeded;
      }
      const deviceOf = (principal: string) =>
        principal.startsWith(DEVICE_PRINCIPAL)
          ? roster
              .view()
              .devices.find(
                (each) =>
                  each.body.id === principal.slice(DEVICE_PRINCIPAL.length),
              )?.body
          : undefined;
      // 터미널 입력 허락은 입력마다 동기로 묻는다. 이 컴퓨터에서 허락한 기기인가이고 명단 항목의 값은 읽지 않는다. 허락을 고친
      // route가 답하기 전에 메모리 사본이 바뀌므로 다음 입력부터 따른다.
      ctx.provide("terminalInputGrant", (principal) =>
        grants.has(deviceOf(principal)?.key),
      );
      // 그 기계의 컴퓨터가 이 컴퓨터에서 허락한 기기인가. 명단에 그 기계의 컴퓨터가 하나뿐일 때만 센다(`computerSigningKey`와 같은 규칙).
      ctx.provide("computerGranted", (machine) => {
        const signing = machineSigningKey(roster.view(), machine);
        const found = roster
          .view()
          .devices.find((each) => each.body.signing_key === signing);
        return signing !== null && grants.has(found?.body.key);
      });
      ctx.provide(
        "deviceKind",
        (principal) => deviceOf(principal)?.kind ?? null,
      );
      // 폴더·link·폰으로 옮기는 file(carry). 명단 file은 remote가 켜져 있고 자기 항목이 있을 때만 싣고 주소는 싣지 않는다.
      ctx.provide("rosterCarry", {
        statements: () =>
          ctx.settings.get(remoteEnabledSetting) === true &&
          roster.self() !== undefined
            ? roster.snapshot().statements
            : null,
        async receive(statements) {
          const done = await roster.receive({
            statements: [...statements],
            reach: [],
          });
          return done.ok ? ok(undefined) : done;
        },
      });
      ctx.provide("manifestSign", (body) =>
        keys === undefined ? null : signManifest(body, keys.signing.secretKey),
      );
      ctx.provide("computerSigningKey", (machine) =>
        machineSigningKey(roster.view(), machine),
      );
      ctx.provide("computerRemoved", (machine) =>
        machineRemoved(roster.view(), machine),
      );
      ctx.provide("computerGone", (machine) =>
        machineGone(roster.view(), roster.self()?.id, machine),
      );
      phoneLink = createPhoneLink({ timers: systemTimers, random: ctx.random });
      const wait = (ms: number, fn: () => void) => {
        const timer = setTimeout(fn, ms).unref();
        return () => clearTimeout(timer);
      };
      carry = createCarryLinks({
        call: (machine, resource, method, body) =>
          links.call({ machine, resource, method, body }),
        peers: () =>
          links
            .list()
            .filter((each) => each.status === "connected")
            .map((each) => each.machine),
        replica: () => ctx.peek.folderReplica,
        clock: ctx.clock,
        wait,
        logger: ctx.telemetry.logger,
      });
      // browser profile과 저장 login(값 포함)은 link로만 맞춘다(폴더, 폰, relay가 읽는 곳에 쓰지 않는다).
      vaultSync = createVaultSync({
        merge: ctx.mergeBrowserVault,
        exchange: (machine) =>
          links.call({
            machine,
            resource: browserVaultExchange.resource,
            method: browserVaultExchange.method,
            body: {},
          }),
        peers: () =>
          links
            .list()
            .filter((each) => each.status === "connected")
            .map((each) => each.machine),
        inRoster: (machine) =>
          roster
            .view()
            .devices.some(
              (each) =>
                each.body.kind === "computer" && each.body.machine === machine,
            ),
        sharing: () => ctx.settings.get(browserShareSetting) ?? true,
        changed: () =>
          publishStateChanged(ctx.bus, ctx.clock.now(), [
            { name: "browser_profiles", id: null },
            { name: "logins", id: null },
          ]),
        clock: ctx.clock,
        wait,
        logger: ctx.telemetry.logger,
      });
      links = createLinks({
        roster,
        name: () => ctx.machine.status().name,
        dial,
        random: ctx.random,
        clock: ctx.clock,
        wait,
        publish: (event) => ctx.bus.publish(event),
        logger: ctx.telemetry.logger,
        onPeerReady: (machine) => {
          carry.ready(machine);
          vaultSync.ready(machine);
        },
        onPeerCarry: (machine) => carry.peerChanged(machine),
        onPeerVault: (machine) => vaultSync.peerChanged(machine),
        // 그 컴퓨터가 보낸 앱 event는 core의 구독자(job, 앱 선언)에게 이 기계의 event로 낸다.
        onPeerEvent(machine, event) {
          const received = receivedAppEvent(event);
          if (received !== null)
            void ctx.eventDelivery.receive(machine, received);
        },
      });
      subscriptions = createRemoteSubscriptions({
        async jobs() {
          const read = await ctx.runtime.reads.get(key(jobEventTriggers))!(
            REMOTE_CONTEXT,
            {},
          );
          if (!read.ok) return read;
          const { triggers } = read.value as z.infer<
            typeof jobEventTriggers.output
          >;
          return ok(
            triggers.flatMap((one) =>
              one.machine === null
                ? []
                : [
                    {
                      machine: one.machine as Id<"mch">,
                      workspace: one.workspace,
                    },
                  ],
            ),
          );
        },
        apps: () => ctx.peek.appMachineSubscriptions?.() ?? [],
        computers: () => links.computers(),
        resolve: (ref) => resolveMachine(ref, links.computers()),
        isPrivate: (workspace) =>
          isPrivate(
            ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY,
            workspace,
          ),
        watch: (subscriber, machine, conditions) =>
          links.watch(subscriber, machine, conditions),
        warn: (event, fields) =>
          ctx.telemetry.logger.warn({
            component: "remote",
            event,
            fields,
          }),
      });
      ctx.provide("machineLinks", {
        computers: () => links.computers(),
        list: () => links.list(),
        resolve: (ref) => resolveMachine(ref, links.computers()),
        call: (device, call, by) => links.callDevice(device, { ...call, by }),
      });
      ctx.provide("phoneLink", {
        call: phoneLink.call,
        async primary() {
          const devices = await listDevices(ctx);
          return devices.ok
            ? ok(devices.value.find((each) => each.primary)?.id ?? null)
            : devices;
        },
      });
      const relayStatus = () =>
        ok({
          url: ctx.settings.get(remoteRelaySetting) || null,
          state: relay?.state() ?? ("off" as const),
        });
      const list = async () => {
        // 기계 이름이 바뀌었으면(machine/rename) 자기 항목을 다시 서명한다. 이름을 고친 화면이 다시 읽는 곳이 여기다.
        if (keys !== undefined) {
          const self = await roster.ensureSelf({
            machine: ctx.machine.id,
            name: () => ctx.machine.status().name,
            os: computerOs(),
          });
          if (!self.ok) logError(ctx, "roster_not_signed", self.error.message);
        }
        const rows = await listDevices(ctx);
        if (!rows.ok) return rows;
        const last = new Map(
          rows.value.map((row) => [row.id as string, row.last_connected_at]),
        );
        const self = roster.self()?.id;
        const view = roster.view();
        const row = (body: RosterEntryBody) => ({
          id: body.id,
          key: body.key,
          kind: body.kind,
          name: body.name,
          os: body.os,
          machine: body.machine,
          terminal_input: grants.has(body.key),
          // 컴퓨터는 기기 행이 없다. 이 컴퓨터의 link가 마지막으로 붙었거나 끊긴 때다.
          last_connected_at: last.get(body.id) ?? links.seen(body.id),
        });
        return ok({
          this: self ?? null,
          removed_at: removedAt,
          devices: [
            ...view.devices.map(({ body }) => ({
              ...row(body),
              this: body.id === self,
              pending: rosterPending(view, body.key),
              disputed: false,
            })),
            // 정해지지 않은 빼기로 빠진 기기. 사람이 여기서 key로 다시 빼면 풀린다. 칸은 지금 믿는 서명자의 항목에서 온다.
            ...view.removed.flatMap(({ settled, entry }) =>
              settled || entry === null
                ? []
                : [
                    {
                      ...row(entry),
                      this: false,
                      pending: false,
                      disputed: true,
                    },
                  ],
            ),
          ],
        });
      };
      const invite = (_who: unknown, input: unknown) => {
        if (
          keys === undefined ||
          (listener === undefined && relay === undefined)
        )
          return err({
            code: "unavailable" as const,
            message: listenerFailure ?? "remote is off",
          });
        return roster.invite({
          ...(input as z.infer<typeof rosterInvite.input>),
          reach: ownReach(ctx),
        });
      };
      const remove = async (_who: unknown, input: unknown) => {
        const { id, key } = input as z.infer<typeof rosterRemove.input>;
        const target = key === undefined ? { id: id as string } : { key };
        const done = await roster.remove(target);
        return done.ok ? ok({ id: done.value }) : done;
      };
      // 이 컴퓨터의 표만 고친다. 명단에 statement를 내지 않으므로 다른 컴퓨터에는 닿지 않는다.
      const setTerminalInput = async (_who: unknown, input: unknown) => {
        const { id, on } = input as z.infer<
          typeof rosterSetTerminalInput.input
        >;
        const self = roster.self();
        if (self === undefined) return off();
        const found = roster.view().devices.find((each) => each.body.id === id);
        if (found === undefined) {
          return err({
            code: "not_found" as const,
            message: "device not found in the roster",
          });
        }
        if (id === self.id) {
          return err({
            code: "invalid_input" as const,
            message: "this computer does not type into itself",
          });
        }
        return idOf(await grants.set(found.body.key, on), id);
      };
      const rename = async (_who: unknown, input: unknown) => {
        const { id, name } = input as z.infer<typeof rosterRename.input>;
        if (roster.self() === undefined) return off();
        // 이 컴퓨터의 이름은 기계 이름을 따른다. 여기서 바꾸면 다음에 기계 이름으로 되돌아간다.
        if (id === roster.self()?.id) {
          return err({
            code: "invalid_input" as const,
            message: "rename this computer with machine/rename",
          });
        }
        return idOf(await roster.rename(id, name), id);
      };
      const leave = async (who: AuthenticatedContext) => {
        if (!who.principal.startsWith(DEVICE_PRINCIPAL)) {
          return err({
            code: "forbidden" as const,
            message: "only a device in the roster leaves it",
          });
        }
        // 컴퓨터는 사람이 다른 컴퓨터에서 빼기로만 나간다. 연결된 컴퓨터의 화면이 넘긴 call로 자기를 빼지 못하게 한다.
        if (deviceOf(who.principal)?.kind === "computer") {
          return err({
            code: "forbidden" as const,
            message: "a computer leaves the roster only when it is removed",
          });
        }
        const id = who.principal.slice(DEVICE_PRINCIPAL.length);
        const done = await roster.remove({ id });
        return done.ok ? ok({ id: done.value }) : done;
      };
      // 이 컴퓨터가 다른 컴퓨터의 초대장으로 든다. 확인하고, 초대한 컴퓨터에 붙어 본 뒤 저장한다. 거절하면 아무것도 저장하지
      // 않는다(믿지도 않을 issuer와 죽은 초대 서명 statement를 남기지 않게). 못 닿으면 저장하고 초대 서명 statement를 든 채
      // pending이다: issuer link가 다시 붙을 때의 `join`이나 폰이 그것을 issuer를 믿는 컴퓨터에 나른다.
      const joinRoster = async (_who: unknown, input: unknown) => {
        const { text: inviteText, terminal_input: allowIssuer = true } =
          input as z.infer<typeof rosterJoin.input>;
        const text = parseInviteText(inviteText);
        if (text === undefined) {
          return err({
            code: "invalid_input" as const,
            message: "the text is not a lophn invite",
          });
        }
        if (
          keys === undefined ||
          hostText === undefined ||
          (listener === undefined &&
            relay === undefined &&
            listenerFailure !== undefined)
        ) {
          return err({
            code: "unavailable" as const,
            message: listenerFailure ?? "remote is off",
          });
        }
        const hostKey = keys.host;
        const prepared = await roster.prepareJoin(text);
        if (!prepared.ok) return prepared;
        const { body, issuer } = prepared.value;
        let timer: NodeJS.Timeout | undefined;
        const deadline = new Promise<Awaited<ReturnType<typeof join>>>(
          (resolve) => {
            timer = setTimeout(
              () => resolve({ ok: false, failure: { kind: "unreachable" } }),
              JOIN_DEADLINE_MS,
            ).unref();
          },
        );
        const attempt = join(text, {
          key: hostKey,
          dial,
          random: ctx.random,
          name: ctx.machine.status().name,
          capabilities: [],
          entry: {
            id: body.id,
            kind: body.kind,
            key: body.key,
            signing_key: body.signing_key,
            machine: body.machine,
            name: body.name,
            os: body.os,
            rev: body.rev,
          },
          self: ctx.machine.id,
        });
        const joined = await Promise.race([attempt, deadline]);
        clearTimeout(timer);
        if (!joined.ok && joined.failure.kind === "refused") {
          const { code, reason, removal } = joined.failure;
          // 빠진 key라는 답은 이 컴퓨터의 root로 확인한다: 믿는 컴퓨터가 서명한 것만 받고, 맞으면 명단과 key를 버린다(applyChange).
          if (
            removal !== undefined &&
            "by" in removal &&
            roster.view().devices.some((d) => d.body.id === removal.by)
          ) {
            await roster.receive({ statements: [removal], reach: [] });
          }
          return err({
            code: code as ErrorCode,
            message: `the inviting computer refused this computer${reason === undefined ? "" : `: ${reason}`}`,
            ...(reason === undefined ? {} : { details: { reason } }),
          });
        }
        // 판이 어긋난 것은 기다려도 끝나지 않는다. 저장하지 않고 어느 쪽 lophn을 올릴지 알린다.
        if (!joined.ok && joined.failure.kind === "update") {
          return err({
            code: "conflict" as const,
            message: `the remote protocol versions do not meet; update lophn on ${joined.failure.update === "client" ? "this computer" : "the inviting computer"}`,
            details: { update: joined.failure.update },
          });
        }
        const stored = await roster.storeJoin(prepared.value);
        if (!stored.ok) return stored;
        // 합류하는 컴퓨터 앞의 사람이 켠 스위치다: 초대한 컴퓨터가 이 컴퓨터의 터미널에 칠 수 있다. 못 닿아 pending이어도 쓴다.
        if (allowIssuer) await setGrant(ctx, issuer.key, true);
        removedAt = null;
        if (joined.ok) {
          const merged = await roster.receive(joined.joined.roster);
          if (!merged.ok) return merged;
        }
        return ok({
          device: body.id,
          machine: issuer.machine,
          pending: rosterPending(roster.view(), body.key),
        });
      };
      const machines = createMachineRoutes({
        links,
        resolve: (ref) => resolveMachine(ref, links.computers()),
        capability: (value) => ctx.peek.shellCapabilities?.has(value) ?? false,
        onEnd: (listener) => ctx.peek.shellCapabilities?.onEnd(listener),
      });
      const appToolsOf = createMachineAppTools({
        links,
        computers: () => links.computers(),
        policy: () =>
          ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY,
        async assignment(agent) {
          const read = await ctx.runtime.reads.get(key(assignmentGet))!(
            REMOTE_CONTEXT,
            { agent },
          );
          return read.ok
            ? ok((read.value as { assignment: Assignment }).assignment.entries)
            : read;
        },
        async agent(agent) {
          const read = await ctx.runtime.reads.get(key(agentRead))!(
            REMOTE_CONTEXT,
            { agent },
          );
          if (!read.ok) return null;
          const { effective, definition } = read.value as {
            effective: { name: { value: string } };
            definition: { workspace?: Workspace } | null;
          };
          return {
            name: effective.name.value,
            workspace: definition?.workspace ?? null,
          };
        },
      });
      return ok({
        memory: [
          [key(remoteRelayStatus), relayStatus],
          [key(rosterList), list],
          [key(rosterInvite), invite],
          [key(rosterRemove), remove],
          [key(rosterSetTerminalInput), setTerminalInput],
          [key(rosterRename), rename],
          [key(rosterLeave), leave],
          [key(rosterJoin), joinRoster],
          [key(machinesList), () => ok({ machines: links.list() })],
          [
            key(machinesCall),
            (who: unknown, input: unknown) =>
              machines.call(who, input as z.infer<typeof machinesCall.input>),
          ],
          [
            key(machinesWatch),
            (who: unknown, input: unknown) =>
              machines.watch(who, input as z.infer<typeof machinesWatch.input>),
          ],
          [
            key(machinesAppTools),
            (_who: unknown, input: unknown) =>
              appToolsOf(input as z.infer<typeof machinesAppTools.input>),
          ],
        ],
        writer: (inner) =>
          withAfterCommit(
            inner,
            (actions) => {
              for (const action of actions) {
                if (action.topic !== DEVICES_TOPIC) continue;
                const change = action.data as DevicesChange;
                if (change.type === "registered") {
                  // 명단의 이름이다. 폰이 알린 이름은 명단에 없을 때만 쓴다.
                  const name =
                    roster
                      .view()
                      .devices.find((each) => each.body.id === change.id)?.body
                      .name ?? change.name;
                  editScreens(ctx, (list) =>
                    screensPaired(list, change.id, { name, ...change.phone }),
                  );
                } else if (change.type === "revoked") {
                  editScreens(ctx, (list) => screensRevoked(list, change.id));
                } else {
                  editScreens(ctx, (list) =>
                    screensFolded(list, change.from, change.to),
                  );
                }
              }
            },
            ctx.telemetry.logger,
          ),
      });
    },
    async start(ctx) {
      // listener와 relay를 열고 push 대상을 읽기 전에 본다. writer가 다 접힌 뒤라 forget_all의 revoked가 빼기와 같은 길로 간다.
      const dir = `${ctx.root.path}/remote`;
      const state = await remoteKeysState(dir, ctx.machine.id);
      if (
        state === "drop" ||
        (state === "none" && roster.snapshot().statements.length > 0)
      ) {
        const forgot = await forgetRoster(
          ctx,
          "host_key_from_other_machine",
          "the remote keys were made on another machine or only one of them is readable; the device roster was dropped and new keys will be made",
          { to: ctx.machine.id },
        );
        if (!forgot.ok) return forgot;
      } else if (keys !== undefined) {
        if (selfRemoved(roster.view())) {
          const forgot = await forgetRoster(
            ctx,
            "removed_from_roster",
            "this computer was removed from the device roster; its roster and keys were dropped and new keys will be made",
            {},
          );
          if (!forgot.ok) return forgot;
        } else {
          // remote가 꺼져 있어도 key가 있으면 명단을 고칠 수 있다. 그 전에 옮긴 폰 행에 서명해 둔다(저장이 서명하지 않은 행을 지운다).
          const identified = await identify(ctx);
          if (!identified.ok)
            logError(ctx, "roster_not_signed", identified.error.message);
        }
      }
      unsubscribe = ctx.bus.subscribe([{ types: ["StateChanged"] }], {
        send(event) {
          const changes = (
            event.payload as { changes: { name: string; id: string | null }[] }
          ).changes;
          if (
            changes.some(
              (change) =>
                change.name === "settings" &&
                (change.id === null ||
                  change.id === remoteEnabledSetting.key ||
                  change.id === remotePortSetting.key ||
                  change.id === remoteRelaySetting.key),
            )
          ) {
            reconciling = reconciling.then(() => reconcile(ctx));
          }
          if (changes.some((change) => change.name === "remote_devices")) {
            refreshPushDevices(ctx);
            resignSelf(ctx);
          }
          if (changesSubscriptions(changes, callPolicySetting.key)) {
            refreshSubscriptions(ctx);
          }
          if (changes.some((change) => change.name === "carry_files")) {
            carry.changed();
          }
          if (
            changes.some(
              (change) =>
                change.name === "settings" &&
                (change.id === null || change.id === browserShareSetting.key),
            )
          ) {
            vaultSync.sharingChanged();
          }
        },
        close: () => undefined,
      });
      refreshPushDevices(ctx);
      await refreshing;
      reconciling = reconciling.then(() => reconcile(ctx));
      await reconciling;
      return ok(undefined);
    },
    async closeIntake() {
      unsubscribe?.();
      sender?.close();
      await reconciling;
      carry.stop();
      vaultSync.stop();
      links.sync(undefined);
      host?.shutdown();
      await listener?.close();
      listener = undefined;
      listenerFailure = undefined;
      relay?.close();
      relay = undefined;
    },
  };
}
