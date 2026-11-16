import {
  PHONE_BASE_FORMAT,
  PHONE_HOST_MODULES,
  type PhoneHostInfo,
} from "../../../../protocol/apps/phone-screen.ts";
import appUiNative from "../../../../sdk/app-ui-native/package.json";
import kit from "../../../../design/native/package.json";

// What this phone app's base bundle gives a screen: the base bundle is built from these two package sources and its
// `require` serves exactly PHONE_HOST_MODULES (guest/base.ts).
export function guestHostInfo(): PhoneHostInfo {
  return {
    base: PHONE_BASE_FORMAT,
    kit: kit.version,
    app_ui_native: appUiNative.version,
    modules: [...PHONE_HOST_MODULES],
  };
}
