// Entry of the app database lab build (README "앱 DB native module"): the lab is the host's main component, and the
// same bundle serves the guest its probe component.
import { AppRegistry } from "react-native";
import { AppDbProbe } from "../fixtures/app-db-probe.tsx";
import { AppDbLab } from "./app-db.tsx";

AppRegistry.registerComponent("main", () => AppDbLab);
AppRegistry.registerComponent("AppDbProbe", () => AppDbProbe);
