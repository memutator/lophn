import { getRandomValues } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import type { Endpoint } from "../connection/connection.ts";
import {
  generateKeyPair,
  type KeyPair,
  remoteKeyBytes,
  remoteKeyText,
} from "../remote.ts";

// Hermes has no global crypto, so packages/base's cryptoRandom does not work here.
export const random = { fill: (bytes: Uint8Array) => getRandomValues(bytes) };

// A paired computer. `key` (the core's public key) is its identity: pairing the same computer again replaces the entry.
export type Computer = Endpoint & { device: string; revoked: boolean };

const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const DEVICE_KEY = "device-key";
const COMPUTERS = "computers";

// One key pair for this phone, made on first use. Every computer knows the phone by its public key.
export async function deviceKey(): Promise<KeyPair> {
  const saved = await SecureStore.getItemAsync(DEVICE_KEY, options);
  const secret = saved ? remoteKeyBytes(saved) : undefined;
  if (secret) return generateKeyPair({ fill: (out) => out.set(secret) });
  const pair = generateKeyPair(random);
  await SecureStore.setItemAsync(
    DEVICE_KEY,
    remoteKeyText(pair.secretKey),
    options,
  );
  return pair;
}

export async function loadComputers(): Promise<Computer[]> {
  const saved = await SecureStore.getItemAsync(COMPUTERS, options);
  return saved ? (JSON.parse(saved) as Computer[]) : [];
}

export function saveComputers(computers: Computer[]): Promise<void> {
  return SecureStore.setItemAsync(
    COMPUTERS,
    JSON.stringify(computers),
    options,
  );
}
