// (drive) The kit parts an app agent drives through lophn-drive, with a status line that shows every effect: buttons,
// an icon button, a decorative icon, a labelled Input, a secure Input, a segmented control, a checkbox row, a switch,
// 60 rows in a ScrollView, an 8 s busy loop, a render error, a button that re-keys rows 0-2 (their old nodes go stale)
// and one that sends a button off screen where nothing can scroll it back (off_screen).
import { Button, Checkbox, Field, Icon, IconButton, Input, Row, SegmentedControl, Switch, Text, useTheme } from "@lophn/ui-native";
import { Plus, Search, Star } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";

export default function Drive() {
  const theme = useTheme();
  const [presses, setPresses] = useState(0);
  const [stars, setStars] = useState(0);
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [submitted, setSubmitted] = useState("-");
  const [on, setOn] = useState(false);
  const [row, setRow] = useState("-");
  const [gen, setGen] = useState(0);
  const [tab, setTab] = useState(0);
  const [ck, setCk] = useState(false);
  const [away, setAway] = useState(false);
  const [boom, setBoom] = useState(false);
  if (boom) throw new Error("render boom");
  const status = `presses=${presses} stars=${stars} name=${name} pwlen=${pw.length} submit=${submitted} switch=${on ? "on" : "off"} row=${row} gen=${gen} tab=${tab} ck=${ck} away=${away}`;
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }}>
      <View style={{ paddingHorizontal: 8, paddingTop: 4, gap: 4 }}>
        <Text variant="caption" mono>
          {status}
        </Text>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Button size="sm" variant="primary" icon={Plus} onPress={() => setPresses((n) => n + 1)}>
            Save
          </Button>
          <IconButton icon={Star} label="Star" size={18} onPress={() => setStars((n) => n + 1)} />
          <Icon icon={Search} />
          <Button size="sm" onPress={() => setGen((g) => g + 1)}>
            Replace
          </Button>
          <Button size="sm" disabled>
            Off
          </Button>
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <View style={{ flex: 1 }}>
            <Field label="Name">
              <Input value={name} onChangeText={setName} placeholder="type here" compact onSubmit={() => setSubmitted(name || "(empty)")} />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Password">
              <Input value={pw} onChangeText={setPw} placeholder="secret" compact secure />
            </Field>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ flex: 1 }}>
            <SegmentedControl items={["Day", "Week"]} on={tab} onChange={setTab} />
          </View>
          <View style={{ flex: 1 }}>
            <Row lead={<Checkbox on={ck} />} title="Agree" onPress={() => setCk((c) => !c)} />
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Switch on={on} onChange={setOn} label="Notifications" />
          <Button
            size="sm"
            onPress={() => {
              const end = Date.now() + 8000;
              while (Date.now() < end) {}
            }}
          >
            Busy 8s
          </Button>
          <Button size="sm" variant="danger" onPress={() => setBoom(true)}>
            Crash
          </Button>
          <Button size="sm" onPress={() => setAway(true)}>
            Send away
          </Button>
          <View style={{ transform: [{ translateY: away ? 4000 : 0 }] }}>
            <Button size="sm">Away</Button>
          </View>
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
        {Array.from({ length: 60 }, (_, i) => (
          <Row
            key={i < 3 ? `${gen}-${i}` : `${i}`}
            title={i < 3 ? `Row ${i} v${gen}` : `Row ${i}`}
            onPress={() => setRow(String(i))}
          />
        ))}
      </ScrollView>
    </View>
  );
}
