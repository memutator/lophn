package dev.lophn.webview

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream

// Shows one folder (the cached remote bundle) at https://remote.lophn.invalid/ and refuses every
// other request. `.invalid` is reserved, so a request that slips past the interceptor reaches no server.
// WebSocket never reaches shouldInterceptRequest; the CSP `connect-src 'none'` blocks it.
class LophnWebView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onMessage by EventDispatcher()
  var root = ""
  var entry = ""
  private var loaded: Pair<String, String>? = null
  private var reply: JavaScriptReplyProxy? = null
  private val script = context.assets.open("lophn-remote.js").bufferedReader().use { it.readText() }
  private var web = build()

  fun load() {
    val next = root to entry
    if (root.isEmpty() || entry.isEmpty() || next == loaded) return
    loaded = next
    web.loadUrl(ORIGIN + entry)
  }

  fun post(data: String) {
    reply?.postMessage(data)
  }

  private fun build(): WebView = WebView(context).apply {
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    settings.javaScriptEnabled = true
    // The desktop renderer reads view preferences from localStorage; it holds no secrets.
    settings.domStorageEnabled = true
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.setGeolocationEnabled(false)
    // window.open and target=_blank load here, so they pass shouldOverrideUrlLoading below.
    settings.setSupportMultipleWindows(false)
    setDownloadListener { _, _, _, _, _ -> }
    webChromeClient = object : WebChromeClient() {
      override fun onConsoleMessage(message: ConsoleMessage): Boolean {
        Log.d(TAG, "console ${message.message()}")
        return true
      }

      override fun onPermissionRequest(request: PermissionRequest) = request.deny()

      override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) =
        callback.invoke(origin, false, false)
    }
    webViewClient = object : WebViewClient() {
      override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse =
        serve(request)

      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url
        if (inside(url)) return false
        if (request.isForMainFrame && request.hasGesture() && (url.scheme == "http" || url.scheme == "https")) {
          runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          }
        } else {
          Log.i(TAG, "blocked navigation $url")
        }
        return true
      }

      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        Log.i(TAG, "render process gone, crashed=${detail.didCrash()}")
        removeView(view)
        view.destroy()
        reply = null
        web = build()
        // React Native lays out only the views it created; size the replacement ourselves.
        web.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
        web.layout(0, 0, width, height)
        loaded?.let { web.loadUrl(ORIGIN + it.second) }
        return true
      }
    }
    WebViewCompat.addWebMessageListener(this, "lophnNative", setOf(ORIGIN_RULE)) { _, message, _, isMainFrame, proxy ->
      if (!isMainFrame) return@addWebMessageListener
      reply = proxy
      onMessage(mapOf("data" to (message.data ?: "")))
    }
    WebViewCompat.addDocumentStartJavaScript(this, script, setOf(ORIGIN_RULE))
    this@LophnWebView.addView(this)
  }

  private fun inside(url: Uri) = url.scheme == "https" && url.host == HOST && url.port == -1

  private fun serve(request: WebResourceRequest): WebResourceResponse {
    if (!inside(request.url) || request.method != "GET") {
      Log.i(TAG, "blocked request ${request.method} ${request.url}")
      return empty(403, "Forbidden")
    }
    val file = fileFor(request.url.path) ?: return empty(404, "Not Found")
    val type = TYPES[file.extension.lowercase()] ?: return empty(404, "Not Found")
    return WebResourceResponse(type, null, 200, "OK", HEADERS, FileInputStream(file))
  }

  // Only plain files under root. `..`, empty segments and any symlink on the way are refused.
  private fun fileFor(path: String?): File? {
    if (root.isEmpty() || path == null) return null
    val segments = path.removePrefix("/").split("/")
    if (segments.any { it.isEmpty() || it == "." || it == ".." || it.contains('\\') || it.any(Char::isISOControl) }) {
      return null
    }
    val file = File(File(root).canonicalFile, segments.joinToString("/"))
    return if (file.canonicalPath == file.absolutePath && file.isFile) file else null
  }

  private fun empty(status: Int, reason: String) =
    WebResourceResponse("text/plain", "utf-8", status, reason, HEADERS, ByteArrayInputStream(ByteArray(0)))

  companion object {
    const val TAG = "LophnWebView"
    const val HOST = "remote.lophn.invalid"
    const val ORIGIN = "https://$HOST/"
    const val ORIGIN_RULE = "https://$HOST"

    // worker-src 'none' also refuses Service Worker registration; SW fetches would skip shouldInterceptRequest.
    private const val CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'none'; " +
      "frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

    private val HEADERS = mapOf(
      "Content-Security-Policy" to CSP,
      "X-Content-Type-Options" to "nosniff",
      "Cache-Control" to "no-store",
    )

    // Same media types the desktop app frame serves (app-protocol.ts), by file extension.
    private val TYPES = mapOf(
      "html" to "text/html",
      "css" to "text/css",
      "js" to "text/javascript",
      "mjs" to "text/javascript",
      "json" to "application/json",
      "wasm" to "application/wasm",
      "txt" to "text/plain",
      "png" to "image/png",
      "jpg" to "image/jpeg",
      "jpeg" to "image/jpeg",
      "gif" to "image/gif",
      "webp" to "image/webp",
      "avif" to "image/avif",
      "svg" to "image/svg+xml",
      "ico" to "image/x-icon",
      "woff" to "font/woff",
      "woff2" to "font/woff2",
      "ttf" to "font/ttf",
      "otf" to "font/otf",
      "mp3" to "audio/mpeg",
      "ogg" to "audio/ogg",
      "wav" to "audio/wav",
      "mp4" to "video/mp4",
      "webm" to "video/webm",
    )
  }
}
