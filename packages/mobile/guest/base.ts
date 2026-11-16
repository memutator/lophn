// The guest base bundle: built once with the phone app (guest/build-base.sh, Metro then hermesc) and loaded first in
// every guest runtime, before a screen's phone.js. It serves the host modules to screens through `require` (screens are
// built with exactly these names external), installs `lophnApp` and the bridge, and the two globals a screen bundle
// calls: `__lophnMount(Screen)` and, when its evaluation throws, `__lophnFatal(error)`.
import "../src/app/intl.ts";
import "./no-network.ts";
import type {
  PHONE_GUEST_GLOBALS,
  PHONE_HOST_MODULES,
} from "../../protocol/apps/phone-screen.ts";
import { installBridge } from "./bridge.ts";
import { registerRoot } from "./root.tsx";

// `require`, not `import *`: an import namespace would read every lazy export of react-native at once, including the
// network modules a guest does not have.
const registry = {
  react: require("react"),
  "react/jsx-runtime": require("react/jsx-runtime"),
  "react-native": require("react-native"),
  "react-native-svg": require("react-native-svg"),
  "react-native-safe-area-context": require("react-native-safe-area-context"),
  "lucide-react-native": require("lucide-react-native"),
  "@lophn/ui-native": require("@lophn/ui-native"),
  "@lophn/app-ui-native": require("@lophn/app-ui-native"),
} satisfies Record<(typeof PHONE_HOST_MODULES)[number], unknown>;

const bridge = installBridge();
const mount = registerRoot(bridge);

const globals: Record<(typeof PHONE_GUEST_GLOBALS)[keyof typeof PHONE_GUEST_GLOBALS], unknown> = {
  require: (name: string) => {
    if (!Object.hasOwn(registry, name)) throw new Error(`a phone screen cannot import ${name}`);
    return registry[name as keyof typeof registry];
  },
  __lophnMount: mount,
  __lophnFatal: bridge.fatal,
};
Object.assign(globalThis, globals);
