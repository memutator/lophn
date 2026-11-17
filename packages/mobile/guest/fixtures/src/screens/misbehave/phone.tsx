// (c) (d) (e) A screen that breaks on purpose: a render throw, a handler throw, an unhandled rejection, an 8 s busy
// loop, a 300 MB allocation. Each runs from its button or from the host event lab/do (debug builds cannot tap a guest).
import { useEvent } from "@lophn/app-ui-native";
import { Button, Screen, Text } from "@lophn/ui-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

const kept: unknown[] = [];

function busy() {
  const end = Date.now() + 8000;
  while (Date.now() < end) {}
}

function allocate() {
  // 300 arrays of 131,072 doubles: 1 MiB each
  for (let i = 0; i < 300; i++) kept.push(new Array(131072).fill(i + 0.5));
}

export default function Misbehave() {
  const [mode, setMode] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, []);
  const actions: Record<string, () => void> = {
    render: () => setMode("render"),
    handler: () => {
      throw new Error("handler throw");
    },
    reject: () => {
      void Promise.reject(new Error("unhandled rejection"));
    },
    busy,
    alloc: () => {
      allocate();
      setMode(`allocated ${kept.length} MiB`);
    },
  };
  useEvent<string>("lab", "do", (action) => actions[action]?.());
  if (mode === "render") throw new Error("render throw");
  return (
    <Screen scroll>
      <View style={{ padding: 16, gap: 12 }}>
        <Text>{`tick ${tick} ${mode}`}</Text>
        {Object.keys(actions).map((name) => (
          <Button key={name} onPress={actions[name]}>
            {`Guest ${name}`}
          </Button>
        ))}
      </View>
    </Screen>
  );
}
