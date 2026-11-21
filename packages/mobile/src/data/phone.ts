// The computer store with the phone's real parts: secure store, the roster file, WebSocket, expo-crypto, and the sample
// computer in dev.
import {
  type Computer,
  type Computers,
  type CoreCall,
  type CoreReply,
  createComputers,
  createConnection,
  dialWebSocket,
  openFirst,
  ownStatements,
  sampleFor,
} from "../../../remote-client/mod.ts";
import { drive } from "../apps/drive/mod.ts";
import { answerRequest, phoneCapabilities } from "../link/answer.ts";
import { noScanner } from "../link/capabilities.ts";
import { phonePorts } from "../link/native.ts";
import { join, phoneScreen } from "../pairing/pair.ts";
import {
  deviceKey,
  forgetDeviceKey,
  loadComputers,
  loadPhoneName,
  loadRoster,
  random,
  saveComputers,
  savePhoneName,
  saveRoster,
} from "../pairing/store.ts";
import { type KeyPair, remoteKeyText } from "../remote.ts";
import { type ComputerData, linkOf } from "./link.ts";
import { createSampleComputer } from "./sample.ts";

// Dev only: the emulator reaches the host at 10.0.2.2, not at the LAN address the QR carries. Raced with the QR's addresses.
const DEV_ADDRESS = __DEV__
  ? process.env.EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS
  : undefined;
const withDev = (addresses: string[]) =>
  DEV_ADDRESS ? [...addresses, DEV_ADDRESS] : addresses;

export function createPhoneComputers(): Computers<ComputerData> {
  return createComputers<ComputerData>({
    load: async () => ({
      key: await deviceKey(),
      computers: await loadComputers(),
      roster: loadRoster(),
      name: await loadPhoneName(),
    }),
    save: async ({ computers, roster }) => {
      saveRoster(roster);
      await saveComputers(computers);
    },
    saveName: async (name) => {
      await savePhoneName(name);
      return loadPhoneName();
    },
    forgetKey: forgetDeviceKey,
    now: Date.now,
    open: (computer, key, { name, join: statements, onRevoked, onPeer, onRoster }) => {
      const wait = (ms: number, fn: () => void) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      };
      // A backend never asks for the scanner (screen only), so the link has none.
      const ctx = {
        ...phonePorts,
        scanner: noScanner,
        drive: drive.port(computer.key),
      };
      return linkOf(
        createConnection({
          endpoint: { ...computer, addresses: withDev(computer.addresses) },
          key,
          dial: dialWebSocket,
          random,
          name,
          capabilities: phoneCapabilities(),
          phone: phoneScreen(),
          now: Date.now,
          wait,
          onRevoked,
          onPeer,
          join: statements,
          onRoster,
          answer: (frame, isActive) => answerRequest(frame, { ctx, isActive, wait }),
        }),
      );
    },
    // The store saves the invite's own addresses; the dev address is added again at connect time.
    join: (invite, key, name, self) =>
      join(
        { ...invite, reach: { ...invite.reach, addresses: withDev(invite.reach.addresses) } },
        { key, dial: dialWebSocket, name, self },
      ),
    sample: sampleFor(
      { dev: __DEV__, flag: process.env.EXPO_PUBLIC_LOPHN_SAMPLE },
      createSampleComputer,
    ),
  });
}

const unavailable = (message: string): CoreReply => ({
  ok: false,
  error: { code: "unavailable", message },
});

/**
 * Attaches to one computer, joins, makes one call and closes, for what runs without the computer store (a widget refresh
 * while the app is dead). Gives up after `timeoutMs` for the whole of it.
 */
export function callOnce(
  computer: Computer,
  phone: KeyPair,
  call: CoreCall,
  timeoutMs: number,
): Promise<CoreReply> {
  return new Promise((resolve) => {
    let done = false;
    let channel: { close(): void } | undefined;
    const finish = (reply: CoreReply) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      channel?.close();
      resolve(reply);
    };
    const timer = setTimeout(() => finish(unavailable("timed out")), timeoutMs);
    const endpoint = {
      ...computer,
      addresses: [...new Set(withDev(computer.addresses))],
    };
    void loadPhoneName()
      .then((name) =>
        openFirst(endpoint, {
          key: phone,
          dial: dialWebSocket,
          random,
          name,
          capabilities: phoneCapabilities(),
          phone: phoneScreen(),
        }),
      )
      .then((opened) => {
        if (!opened || !("channel" in opened)) {
          return finish(unavailable("not connected"));
        }
        const open = opened.channel;
        channel = open;
        if (done) return open.close();
        open.onClose(() => finish(unavailable("connection closed")));
        const sendCall = () => {
          const sent = open.send({
            type: "call",
            id: "once",
            resource: call.resource,
            method: call.method,
            body: call.body,
          });
          if (!sent.ok) finish({ ok: false, error: sent.error });
        };
        open.onFrame((frame) => {
          if (frame.type !== "result") return;
          if (frame.id === "join") {
            if (frame.ok) sendCall();
            else finish({ ok: false, error: frame.error });
          } else if (frame.id === "once") {
            finish(
              frame.ok
                ? { ok: true, value: frame.value }
                : { ok: false, error: frame.error },
            );
          }
        });
        // Every channel opens with `join`, here with what the phone holds about itself.
        open.send({
          type: "join",
          id: "join",
          statements: ownStatements(
            loadRoster().statements,
            remoteKeyText(phone.publicKey),
          ),
        });
      });
  });
}
