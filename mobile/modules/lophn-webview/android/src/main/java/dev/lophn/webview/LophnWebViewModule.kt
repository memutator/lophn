package dev.lophn.webview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LophnWebViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LophnWebView")

    View(LophnWebView::class) {
      Events("onMessage")

      Prop("root") { view: LophnWebView, root: String ->
        view.root = root
      }

      Prop("entry") { view: LophnWebView, entry: String ->
        view.entry = entry
      }

      OnViewDidUpdateProps { view: LophnWebView ->
        view.load()
      }

      AsyncFunction("postMessage") { view: LophnWebView, data: String ->
        view.post(data)
      }
    }
  }
}
