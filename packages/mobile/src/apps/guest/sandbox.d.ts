// The part of @callstack/react-native-sandbox the host uses. The package ships no type declarations (only its source,
// which does not type-check against React Native 0.88's types).
declare module "@callstack/react-native-sandbox" {
  import type { Ref } from "react";
  import type { ViewProps } from "react-native";

  export interface SandboxReactNativeViewRef {
    postMessage(message: unknown): void;
  }
  export interface ErrorEvent {
    name: string;
    message: string;
    stack?: string;
    isFatal?: boolean;
  }
  export interface SandboxReactNativeViewProps extends ViewProps {
    ref?: Ref<SandboxReactNativeViewRef>;
    origin?: string;
    componentName: string;
    jsBundleSource?: string;
    allowedTurboModules?: string[];
    turboModuleSubstitutions?: Record<string, string>;
    imageFolder?: string;
    onMessage?: (data: unknown) => void;
    onError?: (error: ErrorEvent) => void;
  }
  export default function SandboxReactNativeView(
    props: SandboxReactNativeViewProps,
  ): React.ReactNode;
}
