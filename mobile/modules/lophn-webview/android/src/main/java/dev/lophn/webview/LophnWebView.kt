package dev.lophn.webview

import android.content.Context
import android.net.Uri
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.ByteArrayInputStream

// Spike: serves the test page in assets/spike/ under `origin` and refuses every other request.
// The real module (mobile-webview) serves the cached bundle instead.
class LophnWebView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onMessage by EventDispatcher()
  private var origin = ""
  private var reply: JavaScriptReplyProxy? = null

  private val web = WebView(context).apply {
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    settings.javaScriptEnabled = true
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    webChromeClient = object : WebChromeClient() {
      override fun onConsoleMessage(message: ConsoleMessage): Boolean {
        Log.i(TAG, "console ${message.message()}")
        return true
      }
    }
    webViewClient = object : WebViewClient() {
      override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse =
        serve(request.url)

      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val inside = request.url.toString().startsWith(origin)
        if (!inside) Log.i(TAG, "blocked navigation ${request.url}")
        return !inside
      }
    }
  }

  init {
    addView(web)
  }

  fun load(next: String) {
    if (next == origin) return
    origin = next
    // WebMessageListener takes only http(s) origin rules; a custom scheme needs "*".
    val rule = Uri.parse(next).let { if (it.scheme == "https") "https://${it.host}" else "*" }
    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      try {
        WebViewCompat.addWebMessageListener(web, "lophnNative", setOf(rule)) { _, message, _, _, proxy ->
          reply = proxy
          onMessage(mapOf("data" to (message.data ?: "")))
        }
        Log.i(TAG, "bridge listener on $rule")
      } catch (e: IllegalArgumentException) {
        Log.i(TAG, "bridge listener refused $rule: ${e.message}")
      }
    }
    web.loadUrl("${next}index.html")
  }

  fun post(data: String) {
    reply?.postMessage(data)
  }

  private fun serve(url: Uri): WebResourceResponse {
    val text = url.toString()
    if (!text.startsWith(origin)) {
      Log.i(TAG, "blocked request $text")
      return WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }
    val path = text.removePrefix(origin).substringBefore('?').substringBefore('#')
    return try {
      val stream = context.assets.open("spike/$path")
      Log.i(TAG, "served $text")
      WebResourceResponse(mime(path), null, 200, "OK", emptyMap(), stream)
    } catch (e: java.io.IOException) {
      Log.i(TAG, "missing $text")
      WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }
  }

  private fun mime(path: String) = when (path.substringAfterLast('.')) {
    "html" -> "text/html"
    "js" -> "text/javascript"
    "css" -> "text/css"
    "woff2" -> "font/woff2"
    else -> "application/octet-stream"
  }

  companion object {
    const val TAG = "LophnWebView"
  }
}
