// React Native's StatusBar in a guest. The status bar belongs to the whole app, so a screen does not set it (the guest
// has no StatusBarManager: see the sandbox patch). The kit's Screen renders one; here it draws nothing and does nothing.
function StatusBar(_props: object): null {
  return null;
}
StatusBar.currentHeight = null;
StatusBar.setHidden = (_hidden: boolean, _animation?: string) => {};
StatusBar.setBarStyle = (_style: string, _animated?: boolean) => {};
StatusBar.setNetworkActivityIndicatorVisible = (_visible: boolean) => {};
StatusBar.setBackgroundColor = (_color: string, _animated?: boolean) => {};
StatusBar.setTranslucent = (_translucent: boolean) => {};
StatusBar.pushStackEntry = (props: object) => props;
StatusBar.popStackEntry = (_entry: object) => {};
StatusBar.replaceStackEntry = (_entry: object, props: object) => props;

export default StatusBar;
