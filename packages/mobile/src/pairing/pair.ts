import { Dimensions, PixelRatio, Platform } from "react-native";
import { createIdSource, systemClock } from "../../../base/mod.ts";
import {
  type Dial,
  type JoinSelf,
  join as joinClient,
} from "../../../remote-client/mod.ts";
import { phoneCapabilities } from "../link/answer.ts";
import {
  type KeyPair,
  type RemotePhone,
  type RosterInviteText,
  remoteKeyText,
} from "../remote.ts";
import { random } from "./store.ts";

const ids = createIdSource({ clock: systemClock, random });

// The screen the core keeps for this phone (its preview device screen), sent in every hello.
export function phoneScreen(): RemotePhone {
  const { width, height } = Dimensions.get("screen");
  return {
    os: Platform.OS === "ios" ? "ios" : "android",
    width: Math.round(width),
    height: Math.round(height),
    dpr: PixelRatio.get(),
  };
}

// Joins the roster with the invite's computer. `self` is this phone as the roster already has it (another computer let it
// in); otherwise it joins as a new device with a new id.
export function join(
  invite: RosterInviteText,
  deps: { key: KeyPair; dial: Dial; name: string; self: JoinSelf | undefined },
) {
  const { self, ...client } = deps;
  const phone = phoneScreen();
  return joinClient(invite, {
    ...client,
    random,
    capabilities: phoneCapabilities(),
    phone,
    entry: {
      id: self?.id ?? ids.newId("dev"),
      kind: "phone",
      key: remoteKeyText(deps.key.publicKey),
      signing_key: null,
      machine: null,
      name: deps.name,
      os: phone.os,
      rev: self?.rev ?? 1,
    },
    statements: self?.statements ?? [],
  });
}
