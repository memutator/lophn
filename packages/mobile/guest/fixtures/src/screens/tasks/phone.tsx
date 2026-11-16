// (a) A normal kit screen: calls round-trip through the host's fake operations, a host event changes the screen, and
// the Input takes typing from the soft keyboard.
import { useEvent, useOperation, usePlace } from "@lophn/app-ui-native";
import { Button, Input, ListCard, Row, Screen, Text, TopBar } from "@lophn/ui-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

type Task = { id: number; title: string };

export default function Tasks() {
  const place = usePlace();
  const list = useOperation({ name: "tasks.list" });
  const add = useOperation({ name: "tasks.add" });
  const missing = useOperation({ name: "tasks.missing" });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("none");
  useEffect(() => {
    void list.run(null).then((result) => {
      if (result?.ok) setTasks(result.value as Task[]);
    });
  }, []);
  useEvent<string>("lab", "note", setNote);
  const submit = async () => {
    const result = await add.run({ title });
    if (result?.ok) {
      setTasks(result.value as Task[]);
      setTitle("");
    }
  };
  return (
    <Screen top={<TopBar left="none" title="Fixture tasks" sub={place.place ?? "outside"} />} scroll>
      <View style={{ padding: 16, gap: 12 }}>
        <Text>{`event: ${note}`}</Text>
        <ListCard>
          {tasks.map((task) => (
            <Row key={task.id} title={task.title} />
          ))}
        </ListCard>
        <Input value={title} onChangeText={setTitle} placeholder="New task" />
        <Button variant="primary" onPress={() => void submit()}>
          Add task
        </Button>
        <Button onPress={() => void missing.run(null)}>Call a missing operation</Button>
        <Text>{`missing: ${missing.state.status === "failed" ? missing.state.code : missing.state.status}`}</Text>
      </View>
    </Screen>
  );
}
