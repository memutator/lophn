package dev.lophn.webview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LophnWebViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LophnWebView")

    View(LophnWebView::class) {
      Events("onMessage")

      Prop("origin") { view: LophnWebView, origin: String ->
        view.load(origin)
      }

      AsyncFunction("postMessage") { view: LophnWebView, data: String ->
        view.post(data)
      }
    }
  }
}
