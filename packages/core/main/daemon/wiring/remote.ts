// 기기(폰, 다른 기계의 desktop)가 붙는 remote 연결의 조립. 설정 `remote.enabled`가 켜지면 `remote.port`에 listener를 열고, `remote.relay`가 있으면
// relay에도 건다. 둘은 따로 돈다(port를 못 열어도 relay는 돈다). 꺼지면 둘 다 닫는다.
// 기기 표(devices)의 command·read는 writer·reader Worker가 이 file을 팀 등록 file로 import해 얻는다.
// 표를 만드는 ledger step은 낸 step 목록의 끝에 붙어야 해서(schema-steps.lock.json) 이 wiring의 schemaStepsAfterTeams에 둔다.
// 기기마다 터미널 입력 허락(`ctx.terminalInputGrant`)과 기기 kind(`ctx.deviceKind`)도 기기 표를 아는 여기서 채운다.
// core가 폰에 묻는 길(`ctx.phoneLink`)도 여기서 낸다. link는 build에서 만들고 host가 늦게 생겨도 같은 것을 쓴다.
// host key에는 만든 기계의 id가 찍힌다. 기동마다 지금 id와 대조해 다른 기계에서 복사된 key면 기기 등록을 모두 버리고 key를 지운다.
import { rm } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import type { z } from "zod";
import { err, formatAt, ok, type Result } from "../../../../base/mod.ts";
import {
  devicesClearPush,
  devicesConnected,
  devicesForgetAll,
  devicesList,
  devicesPushTargets,
  devicesRegister,
  pairingStart,
  type RemoteDevice,
  remoteKeyText,
  remoteRelayStatus,
} from "../../../../protocol/remote/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { type PushDevice } from "../../../attention/mod.ts";
import { readMachineId } from "../../../machine/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import { createExpoPushSender } from "../../../attention/push/mod.ts";
import {
  devicesSetting,
  remoteEnabledSetting,
  remotePortSetting,
  remotePushSetting,
  remoteRelaySetting,
} from "../../../config/shell-settings.ts";
import {
  createDeviceCredentials,
  createPairingCodes,
  createPhoneLink,
  createRemoteCall,
  createRemoteHost,
  DEVICES_COMMANDS,
  DEVICES_KIND_STEPS,
  DEVICES_SCHEMA_STEPS,
  DEVICES_TOPIC,
  type DevicesChange,
  devicesListRead,
  devicesPushTargetsRead,
  loadHostKey,
  openRemoteListener,
  type PairingCodes,
  type PhoneLink,
  type RemoteDevices,
  type RemoteHost,
  type RemoteListener,
  screensPaired,
  screensRenamed,
  screensRevoked,
} from "../../../remote/mod.ts";
import { devicePrincipal } from "../../../remote/call.ts";
import {
  createDeviceKinds,
  createTerminalInputGrants,
} from "../../../remote/devices.ts";
import {
  readHostKeyMachine,
  stampHostKeyMachine,
} from "../../../remote/host-key.ts";
import {
  openRelayWebSocket,
  type RelayClient,
  startRelayClient,
} from "../../../remote/relay-client.ts";
import { systemTimers } from "../../../runs/mod.ts";
import { jobMachineSchemaSteps } from "../../../jobs/machine-schema.ts";
import { SYNC_LOG_SCHEMA_STEPS } from "../../../apps/sync/schema.ts";
import { SYNC_LOG_MACHINE_STEPS } from "../../../apps/sync/schema.ts";
import { FOLDER_SCHEMA_STEPS } from "../../../folder/schema.ts";
import { PERMISSIONS_PHONE_KIND_STEPS } from "../../../apps/permissions/schema.ts";
import { PROJECTS_IDENTITY_STEPS } from "../../../projects/registry/mod.ts";
import { RouteRegistry } from "../../../server/mod.ts";
import {
  type ReaderRegistration,
  withAfterCommit,
} from "../../../storage/ledger/mod.ts";
import { createAdmission } from "../../../supervision/responsiveness/mod.ts";
import type { WiringContext, WiringFactory } from "./context.ts";

// 기기를 등록하고 마지막 연결을 적고 key로 찾고 push token을 읽고 거두고, 복사된 key의 기기 등록을 버리는 core 안 machine 자격이다.
// 기동 때 ledger에 기록한다.
const REMOTE_PRINCIPAL = "machine:remote";
const REMOTE_CONTEXT: AuthenticatedContext = {
  principal: REMOTE_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      devicesRegister.name,
      devicesConnected.name,
      devicesForgetAll.name,
      devicesList.name,
      devicesClearPush.name,
      devicesPushTargets.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: REMOTE_PRINCIPAL,
};

type Screen = z.infer<typeof devicesSetting.type>[number];

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

export function createCoreRegistration() {
  return {
    commands: DEVICES_COMMANDS,
    reads: [devicesListRead, devicesPushTargetsRead],
    memoryRoutes: [pairingStart, remoteRelayStatus],
  };
}

export function createReaderRegistration(): ReaderRegistration {
  return { reads: [devicesListRead, devicesPushTargetsRead], ports: new Map() };
}

// QR에 싣는 주소 후보. loopback과 link-local(fe80::, 폰이 scope 없이 붙지 못한다)은 뺀다.
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((each) => !each.internal && !each.address.startsWith("fe80:"))
    .map((each) => each.address)
    .slice(0, 16);
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

export const remoteWiring: WiringFactory = () => {
  let listener: RemoteListener | undefined;
  let relay: RelayClient | undefined;
  let host: RemoteHost | undefined;
  let hostKey: ReturnType<typeof loadHostKey> | undefined;
  let unsubscribe: (() => void) | undefined;
  // push를 보낼 기기의 메모리 사본(`devices/push_targets`). `StateChanged{remote_devices}`가 오면 다시 읽는다.
  let pushDevices: readonly PushDevice[] = [];
  let refreshing = Promise.resolve();
  // host key의 공개 key 글(push 글의 `data.host`). key를 풀기 전에는 보낼 곳이 없는 것으로 친다.
  let hostText: string | undefined;
  let sender: ReturnType<typeof createExpoPushSender> | undefined;
  // 켜고 끄기는 하나씩 한다. 설정이 빨리 여러 번 바뀌어도 마지막 값으로 맞는다.
  let reconciling = Promise.resolve();
  let codes: PairingCodes;
  // remote 연결만의 한도다. 기기는 principal마다 따로 서고 사람 token(loopback API)의 자리를 쓰지 않는다.
  const admission = createAdmission();
  // 기기마다 터미널 입력 허락(`ctx.terminalInputGrant`). build에서 표를 읽어 채우고 commit 뒤 바뀜으로 고친다.
  const grants = createTerminalInputGrants();
  // 기기 principal의 kind(`ctx.deviceKind`). 허락과 같이 채우고 고친다.
  const kinds = createDeviceKinds();
  // 붙은 기기 연결을 안다. remote가 꺼져 있으면 붙은 연결이 없어 `call`은 `unavailable`(phone_unreachable)이다.
  let phoneLink: PhoneLink;

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

  // 설정 `shell.devices`를 고친다. preview 기기 고르기와 `--device`가 이름으로 본다. 기기의 항목은 `device`로 찾는다.
  function editScreens(ctx: WiringContext, edit: (list: Screen[]) => Screen[]) {
    const list = ctx.settings.get(devicesSetting) ?? [];
    const written = ctx.settingsUpdate([
      { key: devicesSetting.key, action: "set", value: edit(list) },
    ]);
    if (!written.ok || written.value.rejected.length > 0) {
      logError(ctx, "devices_setting_not_saved", "shell.devices");
    }
  }

  async function listDevices(
    ctx: WiringContext,
  ): Promise<Result<RemoteDevice[]>> {
    const read = await ctx.runtime.reads.get(key(devicesList))!(
      REMOTE_CONTEXT,
      {},
    );
    return read.ok
      ? ok((read.value as { devices: RemoteDevice[] }).devices)
      : read;
  }

  function devicesOf(ctx: WiringContext): RemoteDevices {
    return {
      async find(publicKey) {
        const listed = await listDevices(ctx);
        if (!listed.ok) return listed;
        const found = listed.value.find(
          (each) => each.public_key === publicKey,
        );
        return ok(found ? { id: found.id } : undefined);
      },
      async register(input) {
        const done = await command(ctx, devicesRegister.name, input);
        if (!done.ok) return done;
        const { id } = done.value as { id: string };
        // preview 기기 화면은 phone만이다.
        if (input.kind === "phone") {
          const { name, os, width, height, dpr } = input;
          editScreens(ctx, (list) =>
            screensPaired(list, id, { name, os, width, height, dpr }),
          );
        }
        return ok({ id });
      },
      connected(id, name) {
        void command(ctx, devicesConnected.name, { id, name }).then((done) => {
          if (!done.ok)
            logError(ctx, "connected_not_saved", done.error.message);
        });
      },
    };
  }

  function refreshPushDevices(ctx: WiringContext) {
    refreshing = refreshing.then(async () => {
      const read = await ctx.runtime.reads.get(key(devicesPushTargets))!(
        REMOTE_CONTEXT,
        {},
      );
      if (!read.ok)
        return logError(ctx, "push_targets_failed", read.error.message);
      pushDevices = (read.value as { devices: PushDevice[] }).devices;
    });
  }

  // host key가 다른 기계의 것이면 이 data root는 다른 기계에서 복사됐다. 그 기기 등록과 push token은 그 기계가 pairing한 것이라
  // 모두 버리고 key를 지운다. reconcile이 지금 id를 찍은 새 key를 만든다. 등록을 버린 뒤 key를 지우므로 중간에 죽으면 다음
  // 기동이 같은 판정으로 다시 한다.
  async function forgetClonedDevices(
    ctx: WiringContext,
  ): Promise<Result<void>> {
    const dir = `${ctx.root.path}/remote`;
    const stamped = await readHostKeyMachine(dir);
    if (
      stamped === "missing" ||
      stamped === "unreadable" ||
      stamped === ctx.machine.id
    ) {
      return ok(undefined);
    }
    const forgot = await command(ctx, devicesForgetAll.name, {});
    if (!forgot.ok) return forgot;
    try {
      await rm(`${dir}/host-key.json`, { force: true });
    } catch (thrown) {
      logError(ctx, "host_key_not_removed", thrown);
      return err({
        code: "unavailable",
        message: "the remote host key of another machine could not be removed",
      });
    }
    ctx.telemetry.logger.warn({
      component: "remote",
      event: "host_key_from_other_machine",
      message:
        "the remote host key was made on another machine; its device registrations were dropped and a new key will be made",
      fields: {
        from: stamped,
        to: ctx.machine.id,
        devices: (forgot.value as { count: number }).count,
      },
    });
    return ok(undefined);
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
    }
    if (relay !== undefined && relay.url !== relayUrl) {
      relay.close();
      relay = undefined;
    }
    if (!enabled) return;
    let staticKey: Awaited<ReturnType<typeof loadHostKey>>;
    try {
      hostKey ??= loadHostKey(
        `${ctx.root.path}/remote`,
        ctx.random,
        ctx.machine.id,
      );
      staticKey = await hostKey;
    } catch (thrown) {
      hostKey = undefined;
      logError(ctx, "listener_failed", thrown);
      return;
    }
    hostText = remoteKeyText(staticKey.publicKey);
    host ??= createRemoteHost({
      staticKey,
      machine: () => ({ id: ctx.machine.id, name: ctx.machine.status().name }),
      random: ctx.random,
      timers: systemTimers,
      bus: ctx.bus,
      pairing: codes,
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
      }),
      admission,
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
    if (port !== undefined && listener === undefined) {
      try {
        listener = await openRemoteListener({
          port,
          accept: (socket) => void accept(socket),
        });
      } catch (thrown) {
        logError(ctx, "listener_failed", thrown);
      }
    }
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
    ],
    dataSteps: [hostKeyMachineStep],
    operations: () => [
      { name: devicesRegister.name, actors: ["machine"], kind: "command" },
      { name: devicesConnected.name, actors: ["machine"], kind: "command" },
      { name: devicesForgetAll.name, actors: ["machine"], kind: "command" },
      { name: devicesClearPush.name, actors: ["machine"], kind: "command" },
      { name: devicesPushTargets.name, actors: ["machine"], kind: "read" },
    ],
    records: () => [REMOTE_CONTEXT],
    async build(ctx) {
      codes = createPairingCodes({ clock: ctx.clock, random: ctx.random });
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
      // API가 열리기 전에 읽는다. 그 뒤의 바뀜은 아래 writer가 commit 뒤에 고친다.
      const listed = await listDevices(ctx);
      if (!listed.ok) return listed;
      grants.load(listed.value);
      ctx.provide("terminalInputGrant", grants.granted);
      kinds.load(listed.value);
      ctx.provide("deviceKind", kinds.of);
      phoneLink = createPhoneLink({ timers: systemTimers, random: ctx.random });
      ctx.provide("phoneLink", {
        call: phoneLink.call,
        async primary() {
          const devices = await listDevices(ctx);
          return devices.ok
            ? ok(devices.value.find((each) => each.primary)?.id ?? null)
            : devices;
        },
      });
      const start = async () => {
        if (
          hostKey === undefined ||
          (listener === undefined && relay === undefined)
        ) {
          return err({
            code: "unavailable" as const,
            message: "remote is off",
          });
        }
        const staticKey = await hostKey;
        const code = codes.start();
        return ok({
          addresses: lanAddresses(),
          port: listener?.port ?? ctx.settings.get(remotePortSetting),
          key: remoteKeyText(staticKey.publicKey),
          code: code.code,
          ...(relay ? { relay: relay.url } : {}),
          expires_at: formatAt(code.expiresAt),
        });
      };
      const relayStatus = () =>
        ok({
          url: ctx.settings.get(remoteRelaySetting) || null,
          state: relay?.state() ?? ("off" as const),
        });
      return ok({
        memory: [
          [key(pairingStart), start],
          [key(remoteRelayStatus), relayStatus],
        ],
        writer: (inner) =>
          withAfterCommit(
            inner,
            (actions) => {
              for (const action of actions) {
                if (action.topic !== DEVICES_TOPIC) continue;
                const change = action.data as DevicesChange;
                grants.apply(change);
                kinds.apply(change);
                if (change.type === "revoked") {
                  host?.revoked(change.id);
                  editScreens(ctx, (list) => screensRevoked(list, change.id));
                } else if (change.type === "renamed") {
                  editScreens(ctx, (list) =>
                    screensRenamed(list, change.id, change.name),
                  );
                }
              }
            },
            ctx.telemetry.logger,
          ),
      });
    },
    async start(ctx) {
      // listener와 relay를 열고 push 대상을 읽기 전에 본다. writer가 다 접힌 뒤라 forget_all의 revoked가 끊기와 같은 길로 간다.
      const forgot = await forgetClonedDevices(ctx);
      if (!forgot.ok) return forgot;
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
      host?.shutdown();
      await listener?.close();
      listener = undefined;
      relay?.close();
      relay = undefined;
    },
  };
};
