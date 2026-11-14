// 폰이 붙는 remote 연결의 조립. 설정 `remote.enabled`가 켜지면 `remote.port`에 listener를 열고 꺼지면 닫는다.
// 기기 표(devices)의 command·read는 writer·reader Worker가 이 file을 팀 등록 file로 import해 얻는다.
// 표를 만드는 ledger step은 낸 step 목록의 끝에 붙어야 해서(schema-steps.lock.json) 이 wiring의 schemaStepsAfterTeams에 둔다.
import { networkInterfaces } from "node:os";
import type { z } from "zod";
import { err, formatAt, ok, type Result } from "../../../../base/mod.ts";
import {
  devicesConnected,
  devicesList,
  devicesRegister,
  pairingStart,
  type RemoteDevice,
  remoteKeyText,
  remoteUiFile,
  remoteUiManifest,
} from "../../../../protocol/remote/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { createFileReads, serveFileUnder } from "../../../apps/screens/mod.ts";
import {
  devicesSetting,
  remoteEnabledSetting,
  remotePortSetting,
} from "../../../config/shell-settings.ts";
import {
  createDeviceCredentials,
  createPairingCodes,
  createRemoteCall,
  createRemoteHost,
  DEVICES_COMMANDS,
  DEVICES_SCHEMA_STEPS,
  DEVICES_TOPIC,
  type DevicesChange,
  devicesListRead,
  loadHostKey,
  openRemoteListener,
  type PairingCodes,
  type RemoteDevices,
  type RemoteHost,
  type RemoteListener,
  loadRemoteUi,
  remoteUiFileStream,
  screensPaired,
  screensRenamed,
  screensRevoked,
} from "../../../remote/mod.ts";
import { systemTimers } from "../../../runs/mod.ts";
import { type FileStreamHandler, RouteRegistry } from "../../../server/mod.ts";
import {
  type ReaderRegistration,
  withAfterCommit,
} from "../../../storage/ledger/mod.ts";
import { createAdmission } from "../../../supervision/responsiveness/mod.ts";
import type { WiringContext, WiringFactory } from "./context.ts";

// 기기를 등록하고 마지막 연결을 적고 key로 찾는 core 안 machine 자격이다. 기동 때 ledger에 기록한다.
const REMOTE_PRINCIPAL = "machine:remote";
const REMOTE_CONTEXT: AuthenticatedContext = {
  principal: REMOTE_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [devicesRegister.name, devicesConnected.name, devicesList.name],
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
    reads: [devicesListRead],
    memoryRoutes: [pairingStart, remoteUiManifest],
    files: [remoteUiFile],
  };
}

// 화면 bundle 폴더 `dir` 아래 file만 내준다. 폴더 밖을 막는 규칙과 content type 표는 앱 화면 file과 같은 것이다.
export function remoteUiFiles(dir: string): FileStreamHandler {
  const reads = createFileReads();
  return remoteUiFileStream((path) => serveFileUnder(reads, dir, path));
}

export function createReaderRegistration(): ReaderRegistration {
  return { reads: [devicesListRead], ports: new Map() };
}

// QR에 싣는 주소 후보. loopback과 link-local(fe80::, 폰이 scope 없이 붙지 못한다)은 뺀다.
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((each) => !each.internal && !each.address.startsWith("fe80:"))
    .map((each) => each.address)
    .slice(0, 16);
}

export const remoteWiring: WiringFactory = () => {
  let listener: RemoteListener | undefined;
  let host: RemoteHost | undefined;
  let hostKey: ReturnType<typeof loadHostKey> | undefined;
  let unsubscribe: (() => void) | undefined;
  // 켜고 끄기는 하나씩 한다. 설정이 빨리 여러 번 바뀌어도 마지막 값으로 맞는다.
  let reconciling = Promise.resolve();
  let codes: PairingCodes;
  // remote 연결만의 한도다. 기기는 principal마다 따로 서고 사람 token(loopback API)의 자리를 쓰지 않는다.
  const admission = createAdmission();

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

  function devicesOf(ctx: WiringContext): RemoteDevices {
    return {
      async find(publicKey) {
        const read = await ctx.runtime.reads.get(key(devicesList))!(
          REMOTE_CONTEXT,
          {},
        );
        if (!read.ok) return read;
        const { devices } = read.value as { devices: RemoteDevice[] };
        const found = devices.find((each) => each.public_key === publicKey);
        return ok(found ? { id: found.id } : undefined);
      },
      async register(input) {
        const done = await command(ctx, devicesRegister.name, input);
        if (!done.ok) return done;
        const { public_key: _key, ...screen } = input;
        const { id } = done.value as { id: string };
        editScreens(ctx, (list) => screensPaired(list, id, screen));
        return ok({ id });
      },
      connected(id) {
        void command(ctx, devicesConnected.name, { id }).then((done) => {
          if (!done.ok)
            logError(ctx, "connected_not_saved", done.error.message);
        });
      },
    };
  }

  async function reconcile(ctx: WiringContext): Promise<void> {
    const want = ctx.settings.get(remoteEnabledSetting)
      ? ctx.settings.get(remotePortSetting)
      : undefined;
    if (listener !== undefined && listener.port === want) return;
    if (listener !== undefined) {
      host?.shutdown();
      await listener.close();
      listener = undefined;
    }
    if (want === undefined) return;
    try {
      hostKey ??= loadHostKey(`${ctx.root.path}/remote`, ctx.random);
      const staticKey = await hostKey;
      host ??= createRemoteHost({
        staticKey,
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
        logger: ctx.telemetry.logger,
      });
      const accept = host.accept;
      listener = await openRemoteListener({
        port: want,
        accept: (socket) => void accept(socket),
      });
    } catch (thrown) {
      hostKey = undefined;
      logError(ctx, "listener_failed", thrown);
    }
  }

  return {
    name: "remote",
    schemaStepsAfterTeams: DEVICES_SCHEMA_STEPS,
    operations: () => [
      { name: devicesRegister.name, actors: ["machine"], kind: "command" },
      { name: devicesConnected.name, actors: ["machine"], kind: "command" },
    ],
    records: () => [REMOTE_CONTEXT],
    async build(ctx) {
      codes = createPairingCodes({ clock: ctx.clock, random: ctx.random });
      const ui = await loadRemoteUi();
      const noUi = err({
        code: "unavailable" as const,
        message: "remote ui bundle is not built",
      });
      const start = async () => {
        if (listener === undefined || hostKey === undefined) {
          return err({
            code: "unavailable" as const,
            message: "remote is off",
          });
        }
        const staticKey = await hostKey;
        const code = codes.start();
        return ok({
          addresses: lanAddresses(),
          port: listener.port,
          key: remoteKeyText(staticKey.publicKey),
          code: code.code,
          expires_at: formatAt(code.expiresAt),
        });
      };
      return ok({
        memory: [
          [key(pairingStart), start],
          [key(remoteUiManifest), () => (ui ? ok(ui.manifest) : noUi)],
        ],
        fileStreams: [
          [key(remoteUiFile), ui ? remoteUiFiles(ui.dir) : async () => noUi],
        ],
        writer: (inner) =>
          withAfterCommit(
            inner,
            (actions) => {
              for (const action of actions) {
                if (action.topic !== DEVICES_TOPIC) continue;
                const change = action.data as DevicesChange;
                if (change.type === "revoked") {
                  host?.revoked(change.id);
                  editScreens(ctx, (list) => screensRevoked(list, change.id));
                } else {
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
                  change.id === remotePortSetting.key),
            )
          ) {
            reconciling = reconciling.then(() => reconcile(ctx));
          }
        },
        close: () => undefined,
      });
      reconciling = reconciling.then(() => reconcile(ctx));
      await reconciling;
      return ok(undefined);
    },
    async closeIntake() {
      unsubscribe?.();
      await reconciling;
      host?.shutdown();
      await listener?.close();
      listener = undefined;
    },
  };
};
