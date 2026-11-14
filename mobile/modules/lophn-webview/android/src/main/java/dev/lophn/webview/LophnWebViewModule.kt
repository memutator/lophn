package dev.lophn.webview

import android.app.Activity
import android.net.Uri
import android.webkit.ValueCallback
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LophnWebViewModule : Module() {
  // The page's open file chooser; the picker's answer comes back through OnActivityResult.
  var chooser: ValueCallback<Array<Uri>>? = null

  override fun definition() = ModuleDefinition {
    Name("LophnWebView")

    OnActivityResult { _, payload ->
      if (payload.requestCode != CHOOSE_FILE) return@OnActivityResult
      // null (cancelled) still has to reach the page, or the input never opens again. parseResult reads only
      // the single `data` uri; a multiple pick comes as clipData.
      val data = payload.data
      val picked = if (payload.resultCode != Activity.RESULT_OK || data == null) {
        null
      } else {
        data.clipData?.let { clip -> Array(clip.itemCount) { clip.getItemAt(it).uri } } ?: data.data?.let { arrayOf(it) }
      }
      chooser?.onReceiveValue(picked)
      chooser = null
    }

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

  companion object {
    const val CHOOSE_FILE = 0x10f1
  }
}
