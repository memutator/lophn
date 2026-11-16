// The computer store with the phone's real parts: secure store, WebSocket, expo-crypto, and the sample computer in dev.
import {
  type Computer,
  type Computers,
  type CoreCall,
  type CoreReply,
  createComputers,
  createConnection,
  dialWebSocket,
  openFirst,
  sampleFor,
} from "../../../remote-client/mod.ts";
import { drive } from "../apps/drive/mod.ts";
import { answerRequest, phoneCapabilities } from "../link/answer.ts";
import { expoLocationPort } from "../link/native.ts";
import { pair } from "../pairing/pair.ts";
import {
  deviceKey,
  loadComputers,
  loadPhoneName,
  random,
  saveComputers,
  savePhoneName,
} from "../pairing/store.ts";
import type { KeyPair } from "../remote.ts";
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
      name: await loadPhoneName(),
    }),
    save: saveComputers,
    saveName: async (name) => {
      await savePhoneName(name);
      return loadPhoneName();
    },
    open: (computer, key, { name, onRevoked, onPeer }) => {
      const wait = (ms: number, fn: () => void) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      };
      const ctx = { location: expoLocationPort, drive: drive.port(computer.key) };
      return linkOf(
        createConnection({
          endpoint: { ...computer, addresses: withDev(computer.addresses) },
          key,
          dial: dialWebSocket,
          random,
          name,
          capabilities: phoneCapabilities(),
          now: Date.now,
          wait,
          onRevoked,
          onPeer,
          answer: (frame, isActive) => answerRequest(frame, { ctx, isActive, wait }),
        }),
      );
    },
    async pair(qr, key, name) {
      const result = await pair(
        { ...qr, addresses: withDev(qr.addresses) },
        { key, dial: dialWebSocket, name },
      );
      // Store the QR's own addresses; the dev address is added again at connect time.
      return result.ok
        ? { ok: true, computer: { ...result.computer, addresses: qr.addresses } }
        : result;
    },
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
 * Attaches to one computer, makes one call and closes, for what runs without the computer store (a widget refresh while the
 * app is dead). Gives up after `timeoutMs` for the whole of it.
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
        }),
      )
      .then((opened) => {
        if (!opened || !("channel" in opened)) {
          return finish(unavailable("not connected"));
        }
        channel = opened.channel;
        if (done) return channel.close();
        opened.channel.onClose(() => finish(unavailable("connection closed")));
        opened.channel.onFrame((frame) => {
          if (frame.type !== "result" || frame.id !== "once") return;
          finish(
            frame.ok
              ? { ok: true, value: frame.value }
              : { ok: false, error: frame.error },
          );
        });
        const sent = opened.channel.send({
          type: "call",
          id: "once",
          resource: call.resource,
          method: call.method,
          body: call.body,
        });
        if (!sent.ok) finish({ ok: false, error: sent.error });
      });
  });
}
