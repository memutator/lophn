import { getRandomValues } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { Endpoint } from "../connection/connection.ts";
import {
  generateKeyPair,
  type KeyPair,
  remoteKeyBytes,
  remoteKeyText,
} from "../remote.ts";

// Hermes has no global crypto, so packages/base's cryptoRandom does not work here.
export const random = { fill: (bytes: Uint8Array) => getRandomValues(bytes) };

// A paired computer. `key` (the core's public key) is its identity on the wire; `machine` (the computer's `mch_` id) is
// what a computer is: pairing again with the same machine, on any key, replaces the entry.
// `name` is the alias the person gave it on this phone and only the person changes it; `announced` is the name the
// computer itself sent in its last hello. Shown: name ?? announced ?? the address. `machine` is empty on an entry paired
// before computers announced themselves; the first connection fills it in.
export type Computer = Endpoint & {
  device: string;
  revoked: boolean;
  name?: string;
  announced?: string;
};

const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const DEVICE_KEY = "device-key";
const COMPUTERS = "computers";
const PHONE_NAME = "phone-name";
export const PHONE_NAME_MAX = 40;

// What computers call this phone until the person names it. Hello allows 64 characters, the computer's preview device screen 40.
export function defaultPhoneName(): string {
  const constants = Platform.constants as { Model?: string };
  return (constants.Model ?? `${Platform.OS} phone`).slice(0, PHONE_NAME_MAX);
}

export async function loadPhoneName(): Promise<string> {
  const saved = await SecureStore.getItemAsync(PHONE_NAME, options);
  return saved?.trim() || defaultPhoneName();
}

// Empty goes back to the default; `loadPhoneName` says which one is in effect.
export async function savePhoneName(name: string): Promise<void> {
  const trimmed = name.trim().slice(0, PHONE_NAME_MAX);
  if (trimmed === "") await SecureStore.deleteItemAsync(PHONE_NAME, options);
  else await SecureStore.setItemAsync(PHONE_NAME, trimmed, options);
}

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
