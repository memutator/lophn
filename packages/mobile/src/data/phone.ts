// The computer store with the phone's real parts: secure store, WebSocket, expo-crypto, and the sample computer in dev.
import {
  type CoreCall,
  type CoreReply,
  createConnection,
  openFirst,
} from "../connection/connection.ts";
import { dialSocket } from "../connection/socket.ts";
import { expoLocationPort } from "../link/native.ts";
import { pair } from "../pairing/pair.ts";
import {
  deviceKey,
  loadComputers,
  random,
  saveComputers,
} from "../pairing/store.ts";
import type { Computer } from "../pairing/store.ts";
import type { KeyPair } from "../remote.ts";
import { type Computers, createComputers, sampleFor } from "./computers.ts";
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
      phone: await deviceKey(),
      computers: await loadComputers(),
    }),
    save: saveComputers,
    open: (computer, phone, onRevoked) =>
      linkOf(
        createConnection({
          endpoint: { ...computer, addresses: withDev(computer.addresses) },
          phone,
          dial: dialSocket,
          random,
          now: Date.now,
          wait: (ms, fn) => {
            const timer = setTimeout(fn, ms);
            return () => clearTimeout(timer);
          },
          onRevoked,
          phoneCtx: { location: expoLocationPort },
        }),
      ),
    async pair(qr, phone) {
      const result = await pair(
        { ...qr, addresses: withDev(qr.addresses) },
        { phone, dial: dialSocket },
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
    void openFirst(endpoint, { phone, dial: dialSocket, random }).then(
      (opened) => {
        if (!opened) return finish(unavailable("not connected"));
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
      },
    );
  });
}
