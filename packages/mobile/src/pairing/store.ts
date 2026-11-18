import { getRandomValues } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { Computer } from "../../../remote-client/mod.ts";
import {
  generateKeyPair,
  type KeyPair,
  type RosterSnapshot,
  remoteKeyBytes,
  remoteKeyText,
} from "../remote.ts";
import { readComputers, readRoster } from "./saved.ts";

// Hermes has no global crypto, so packages/base's cryptoRandom does not work here.
export const random = { fill: (bytes: Uint8Array) => getRandomValues(bytes) };

const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const DEVICE_KEY = "device-key";
const COMPUTERS = "computers";
const PHONE_NAME = "phone-name";
export const PHONE_NAME_MAX = 40;

// The roster the phone holds, in the app's files folder. Public keys and signatures only; the roots it is read against
// (the saved computers' signing keys) stay in SecureStore.
const rosterFile = () => new File(Paths.document, "roster.json");

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

// One key pair for this phone, made on first use. The roster knows the phone by its public key.
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

// The phone is off the roster: its key never joins again, so the next join is a new device with a new key.
export async function forgetDeviceKey(): Promise<KeyPair> {
  await SecureStore.deleteItemAsync(DEVICE_KEY, options);
  return deviceKey();
}

export async function loadComputers(): Promise<Computer[]> {
  return readComputers(await SecureStore.getItemAsync(COMPUTERS, options));
}

export function saveComputers(computers: Computer[]): Promise<void> {
  return SecureStore.setItemAsync(
    COMPUTERS,
    JSON.stringify(computers),
    options,
  );
}

export function loadRoster(): RosterSnapshot {
  const file = rosterFile();
  return readRoster(file.exists ? file.textSync() : null);
}

export function saveRoster(roster: RosterSnapshot): void {
  rosterFile().write(JSON.stringify(roster));
}
