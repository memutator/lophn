// The screen of an app that runs on the phone (the lab mounts it with local-backend.js and an app database): its
// list_items, add_item, refuse_item and try_offline run in the guest, send_report goes to the host. Each result is on
// screen and goes to the host as `lab.result` (a host call: it is not one of the app's operations). The first local
// call's time goes as `lab.first_local`. Host events `lab/do` run the buttons where taps do not reach a guest (debug).
import { useEvent, useOperation } from "@lophn/app-ui-native";
import { Button, ListCard, Row, Screen, Text, TopBar } from "@lophn/ui-native";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

type Item = { id: string; title: string };

export default function Local() {
  const list = useOperation({ name: "list_items" });
  const add = useOperation({ name: "add_item" });
  const refuse = useOperation({ name: "refuse_item" });
  const offline = useOperation({ name: "try_offline" });
  const report = useOperation({ name: "send_report" });
  const result = useOperation({ name: "lab.result" });
  const first = useOperation({ name: "lab.first_local" });
  const [items, setItems] = useState<Item[]>([]);
  const [last, setLast] = useState("none");
  const taps = useRef(0);

  const show = (action: string, outcome: Awaited<ReturnType<typeof list.run>>) => {
    const text = outcome?.ok ? `ok ${JSON.stringify(outcome.value)}` : `failed ${outcome?.code ?? "?"}`;
    setLast(`${action}: ${text}`);
    void result.run({ action, result: text });
  };
  const refresh = async () => {
    const outcome = await list.run(null);
    if (outcome?.ok) setItems(outcome.value as Item[]);
    return outcome;
  };
  const actions: Record<string, () => Promise<void>> = {
    add: async () => {
      show("add_item", await add.run({ title: `item ${++taps.current}` }));
      await refresh();
    },
    refuse: async () => {
      show("refuse_item", await refuse.run(null));
      await refresh();
    },
    offline: async () => show("try_offline", await offline.run(null)),
    report: async () => show("send_report", await report.run({})),
    list: async () => show("list_items", await refresh()),
  };

  useEffect(() => {
    void refresh().then((outcome) => {
      void first.run({ at: Date.now(), ok: outcome?.ok ?? false });
    });
  }, []);
  useEvent<string>("lab", "do", (name) => void actions[name]?.());

  return (
    <Screen top={<TopBar left="none" title="Local items" sub="runs on this phone" />} scroll>
      <View style={{ padding: 16, gap: 12 }}>
        <Text>{`last: ${last}`}</Text>
        <ListCard>
          {items.map((item) => (
            <Row key={item.id} title={item.title} />
          ))}
        </ListCard>
        <Button variant="primary" onPress={() => void actions.add?.()}>
          Add item
        </Button>
        <Button onPress={() => void actions.refuse?.()}>Refuse</Button>
        <Button onPress={() => void actions.offline?.()}>Try offline</Button>
        <Button onPress={() => void actions.report?.()}>Send report</Button>
      </View>
    </Screen>
  );
}
