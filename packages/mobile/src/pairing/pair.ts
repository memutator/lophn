import { Dimensions, PixelRatio, Platform } from "react-native";
import {
  type Dial,
  type PairDevice,
  pair as pairClient,
} from "../../../remote-client/mod.ts";
import { phoneCapabilities } from "../link/answer.ts";
import type { KeyPair, RemotePairing } from "../remote.ts";
import { random } from "./store.ts";

// The kind and screen the core keeps for this phone (its preview device screen). The name is not here: every
// connection sends it in the hello.
function thisDevice(): PairDevice {
  const { width, height } = Dimensions.get("screen");
  return {
    kind: "phone",
    os: Platform.OS === "ios" ? "ios" : "android",
    width: Math.round(width),
    height: Math.round(height),
    dpr: PixelRatio.get(),
  };
}

// Pairs this phone with the pairing text's computer.
export function pair(
  qr: RemotePairing,
  deps: { key: KeyPair; dial: Dial; name: string },
) {
  return pairClient(qr, {
    ...deps,
    random,
    capabilities: phoneCapabilities(),
    device: thisDevice(),
  });
}
