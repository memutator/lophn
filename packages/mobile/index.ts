import "./src/app/intl.ts";
import { registerRootComponent } from "expo";
import { AppRegistry } from "react-native";
import App from "./App.tsx";
import { refreshWidgetsInBackground } from "./src/widgets/store.ts";

AppRegistry.registerHeadlessTask("LophnWidgetRefresh", () => refreshWidgetsInBackground);
registerRootComponent(App);
