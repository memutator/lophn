// The computer store with the phone's real parts: secure store, WebSocket, expo-crypto, and the sample computer in dev.
import { createConnection } from "../connection/connection.ts";
import { dialSocket } from "../connection/socket.ts";
import { pair } from "../pairing/pair.ts";
import {
  deviceKey,
  loadComputers,
  random,
  saveComputers,
} from "../pairing/store.ts";
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
