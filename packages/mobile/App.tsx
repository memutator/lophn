import { UiProvider } from "@lophn/ui-native";
import { useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppearanceProvider } from "./src/app/appearance.tsx";
import { Root } from "./src/app/root.tsx";
import { createPhoneComputers, DataProvider } from "./src/data/mod.ts";
import { Gallery } from "./src/gallery/gallery.tsx";

// Dev only: start Metro with EXPO_PUBLIC_LOPHN_GALLERY=1 to open straight into the kit gallery.
const GALLERY = __DEV__ && process.env.EXPO_PUBLIC_LOPHN_GALLERY === "1";

export default function App() {
  const [computers] = useState(createPhoneComputers);
  const [gallery, setGallery] = useState(GALLERY);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppearanceProvider>
        {(appearance) => (
          <UiProvider
            scheme={appearance.theme === "system" ? undefined : appearance.theme}
          >
            {gallery ? (
              <Gallery onExit={() => setGallery(false)} />
            ) : (
              <DataProvider computers={computers}>
                <Root />
              </DataProvider>
            )}
          </UiProvider>
        )}
      </AppearanceProvider>
    </GestureHandlerRootView>
  );
}
