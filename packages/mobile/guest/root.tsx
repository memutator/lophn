// The guest's only root component, "Screen". It draws nothing until the host's `init` (so `lophnApp.place` stands
// before the screen's first render), then the screen under the kit's UiProvider inside an error boundary that reports
// to the host instead of letting React tear the runtime down.
import { UiProvider } from "@lophn/ui-native";
import { Component, type ComponentType, type ReactNode, useEffect, useState } from "react";
import { AppRegistry } from "react-native";
import {
  PHONE_READY_RETRY_MAX,
  PHONE_READY_RETRY_MS,
  type PhoneHostMessage,
} from "../../protocol/apps/phone-screen.ts";
import type { Bridge } from "./bridge.ts";

type Init = Extract<PhoneHostMessage, { type: "init" }>;

class Boundary extends Component<{ bridge: Bridge; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.bridge.fatal(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// Registers the root and returns the function the screen bundle calls (`__lophnMount`).
export function registerRoot(bridge: Bridge): (screen: ComponentType) => void {
  let Screen: ComponentType | undefined;
  function Root() {
    const [init, setInit] = useState<Init>();
    useEffect(() => {
      let sent = 0;
      let timer: ReturnType<typeof setInterval> | undefined;
      const stop = bridge.watch((next) => {
        clearInterval(timer);
        setInit(next);
      });
      const ready = () => {
        if (sent++ >= PHONE_READY_RETRY_MAX) clearInterval(timer);
        else bridge.send({ type: "ready" });
      };
      ready();
      timer = setInterval(ready, PHONE_READY_RETRY_MS);
      return () => {
        stop();
        clearInterval(timer);
      };
    }, []);
    if (!init || !Screen) return null;
    return (
      <UiProvider scheme={init.scheme}>
        <Boundary bridge={bridge}>
          <Screen />
        </Boundary>
      </UiProvider>
    );
  }
  AppRegistry.registerComponent("Screen", () => Root);
  return (screen) => {
    Screen = screen;
  };
}
