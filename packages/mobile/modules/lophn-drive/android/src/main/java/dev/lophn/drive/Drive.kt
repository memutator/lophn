package dev.lophn.drive

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.text.InputType
import android.text.method.PasswordTransformationMethod
import android.util.Base64
import android.util.Log
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.CompoundButton
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ScrollView
import android.widget.TextView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.R
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.ReactAccessibilityDelegate
import io.callstack.rnsandbox.SandboxReactNativeView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.lang.ref.WeakReference
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

// Reads and drives a guest screen (a SandboxReactNativeView) through its Android view tree, on the UI thread: no
// accessibility service, no guest JS (it answers while the guest JS is busy or broken). Touch goes straight to the
// guest's surface, the same child the sandbox's own touch interceptor feeds, so it never reaches host UI.
// Every answer is {"ok":true,"value":…} or {"ok":false,"code":…,"reason":…,"message":…}.
class Drive(private val activity: () -> Activity?) {
  private val main = Handler(Looper.getMainLooper())

  // The last snapshot of each view. Weak: a table must never keep a closed guest's views alive.
  private class Entry(val view: WeakReference<View>, val role: String, val name: String)
  private class Table(val id: String, val entries: List<Entry>)
  private val tables = HashMap<String, Table>()
  private var snapshots = 0

  private class Fail(val code: String, val reason: String?, message: String) : Exception(message)
  private class Guest(val root: SandboxReactNativeView, val surface: View)
  private class Found(val view: View, val depth: Int, val role: String, val name: String, val value: String?, val flags: List<String>, val bounds: Rect)

  fun snapshot(view: String, reply: (String) -> Unit) = answer(reply) {
    val g = guest(view)
    val found = walk(g.surface)
    val id = "${++snapshots}"
    tables[view] = Table(id, found.map { Entry(WeakReference(it.view), it.role, it.name) })
    val nodes = JSONArray()
    // Screen pixels of each node, outside the contract's value: the lab compares them with `uiautomator dump`.
    val bounds = JSONArray()
    found.forEachIndexed { i, f ->
      val n = JSONObject().put("node", i + 1).put("depth", f.depth).put("role", f.role).put("name", f.name.take(TEXT_MAX)).put("flags", JSONArray(f.flags))
      f.value?.let { n.put("value", it.take(TEXT_MAX)) }
      nodes.put(n)
      bounds.put(JSONArray(listOf(f.bounds.left, f.bounds.top, f.bounds.right, f.bounds.bottom)))
    }
    val density = g.root.resources.displayMetrics.density
    val value = JSONObject().put("snapshot", id).put("width_dp", (g.root.width / density).roundToInt())
      .put("height_dp", (g.root.height / density).roundToInt()).put("nodes", nodes)
    reply(JSONObject().put("ok", true).put("value", value).put("bounds", bounds).toString())
  }

  fun act(view: String, snapshot: String, actJson: String, reply: (String) -> Unit) = answer(reply) {
    val g = guest(view)
    val act = JSONObject(actJson)
    val target = if (act.has("node")) ref(g, view, snapshot, act.getInt("node")) else null
    when (val type = act.getString("type")) {
      "click" -> {
        val v = target ?: throw Fail(INVALID, null, "click needs a node.")
        val shownNow = shown(g, v)
        val r = shownNow ?: bringIn(g, v)
        // After a native scroll the guest JS must see the scroll before the touch, or its ScrollView takes the press.
        main.postDelayed({ tap(g, r.exactCenterX(), r.exactCenterY(), TAP_HOLD_MS) { reply(OK) } }, if (shownNow == null) SETTLE_MS else 0L)
      }
      "type", "fill" -> {
        val et = target as? EditText ?: throw Fail(INVALID, null, "This element does not take text.")
        enterText(g, et, act.getString("text"), type == "fill")
        reply(OK)
      }
      "press" -> {
        val et = (target ?: g.surface.findFocus()) as? EditText ?: throw Fail(INVALID, null, "There is no text field to press Enter in.")
        val ic = et.onCreateInputConnection(EditorInfo()) ?: throw Fail(INTERNAL, null, "The text field takes no input.")
        ic.performEditorAction(EditorInfo.IME_ACTION_DONE)
        hideKeyboard(et)
        reply(OK)
      }
      "scroll" -> {
        if (target != null) {
          bringIn(g, target)
          reply(OK)
        } else {
          scrollBy(g, if (act.has("dy")) act.getInt("dy") else null)
          // A drag ends in the ScrollView's momentum events; until the guest JS has seen their end, its ScrollView
          // takes the next press for itself.
          main.postDelayed({ reply(OK) }, DRAG_SETTLE_MS)
        }
      }
      else -> throw Fail(INVALID, null, "Unknown act $type.")
    }
  }

  fun screenshot(view: String, format: String, reply: (String) -> Unit) = answer(reply) {
    val g = guest(view)
    val w = g.root.width
    val h = g.root.height
    if (w == 0 || h == 0) throw Fail(UNAVAILABLE, "no_preview", "The screen has no size yet.")
    // View.draw, not PixelCopy: it covers only the guest (no host bar, keyboard or status bar).
    val full = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    full.eraseColor(backdrop(g.root))
    g.root.draw(Canvas(full))
    val scale = SHOT_SIDE.toFloat() / max(w, h)
    val bmp = if (scale < 1f) Bitmap.createScaledBitmap(full, (w * scale).roundToInt(), (h * scale).roundToInt(), true) else full
    try {
      val png = format == "png"
      var bytes = encode(bmp, png, 80)
      if (!png && bytes.size > SHOT_BYTES_MAX) bytes = encode(bmp, false, 60)
      if (bytes.size > SHOT_BYTES_MAX) throw Fail(INTERNAL, null, "The screenshot is larger than 1 MiB.")
      val value = JSONObject().put("media_type", if (png) "image/png" else "image/jpeg")
        .put("data_base64", Base64.encodeToString(bytes, Base64.NO_WRAP)).put("width", bmp.width).put("height", bmp.height)
      reply(ok(value))
    } finally {
      if (bmp !== full) bmp.recycle()
      full.recycle()
    }
  }

  fun waitText(view: String, text: String, timeoutMs: Int, reply: (String) -> Unit) {
    val end = SystemClock.uptimeMillis() + timeoutMs
    fun tick() {
      answer(reply) {
        val g = guest(view)
        when {
          walk(g.surface).any { it.name.contains(text) || it.value?.contains(text) == true } -> reply(ok(JSONObject().put("found", true)))
          SystemClock.uptimeMillis() >= end -> reply(ok(JSONObject().put("found", false)))
          else -> main.postDelayed({ tick() }, WAIT_EVERY_MS)
        }
      }
    }
    tick()
  }

  private fun answer(reply: (String) -> Unit, block: () -> Unit) {
    try {
      block()
    } catch (e: Fail) {
      reply(JSONObject().put("ok", false).put("code", e.code).put("reason", e.reason ?: JSONObject.NULL).put("message", e.message).toString())
    } catch (e: Exception) {
      Log.e(TAG, "drive", e)
      reply(JSONObject().put("ok", false).put("code", INTERNAL).put("message", "The phone failed to drive the screen.").toString())
    }
  }

  private fun ok(value: Any) = JSONObject().put("ok", true).put("value", value).toString()

  // ---- finding the guest, and when not to answer -------------------------------------------------------------

  private fun guest(view: String): Guest {
    val act = activity() ?: throw Fail(UNAVAILABLE, "phone_in_background", "The app is not in front.")
    // In-process reads keep working in the background and with the screen off; nobody would see the screen then.
    if ((act as? LifecycleOwner)?.lifecycle?.currentState != Lifecycle.State.RESUMED) throw Fail(UNAVAILABLE, "phone_in_background", "The app is not in front.")
    val pm = act.getSystemService(Context.POWER_SERVICE) as PowerManager
    if (!pm.isInteractive || !act.hasWindowFocus()) throw Fail(UNAVAILABLE, "screen_off", "The screen is off or covered.")
    val root = find(act.window.decorView, view) ?: throw Fail(UNAVAILABLE, "no_preview", "No screen of this view is showing.")
    val surface = root.getChildAt(0) ?: throw Fail(UNAVAILABLE, "no_preview", "No screen of this view is showing.")
    return Guest(root, surface)
  }

  // GuestScreen mounts each view under the origin `<view>:<random>`.
  private fun find(v: View, view: String): SandboxReactNativeView? {
    if (v is SandboxReactNativeView && v.isAttachedToWindow && v.delegate?.origin?.substringBeforeLast(':', "") == view) return v
    if (v is ViewGroup) for (i in 0 until v.childCount) find(v.getChildAt(i), view)?.let { return it }
    return null
  }

  // ---- snapshot ----------------------------------------------------------------------------------------------

  private fun roleTag(v: View): String? {
    val r = v.getTag(R.id.accessibility_role) as? ReactAccessibilityDelegate.AccessibilityRole ?: return null
    return if (r == ReactAccessibilityDelegate.AccessibilityRole.NONE) null else r.name.lowercase()
  }

  private fun isSvg(v: View) = v.javaClass.name.startsWith("com.horcrux.svg.SvgView")

  private fun isScroll(v: View) = v is ScrollView || v is HorizontalScrollView

  private fun actionable(v: View) = v.isClickable || v.isFocusable || roleTag(v) != null

  // Only the input type and transformation are read, never the text.
  private fun isSecure(v: EditText): Boolean {
    val variation = v.inputType and InputType.TYPE_MASK_VARIATION
    val cls = v.inputType and InputType.TYPE_MASK_CLASS
    return v.transformationMethod is PasswordTransformationMethod ||
      (cls == InputType.TYPE_CLASS_TEXT && (variation == InputType.TYPE_TEXT_VARIATION_PASSWORD || variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD || variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD)) ||
      (cls == InputType.TYPE_CLASS_NUMBER && variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD)
  }

  private fun interesting(v: View): Boolean =
    actionable(v) || !v.contentDescription.isNullOrEmpty() || (v is TextView && v.text.isNotEmpty()) ||
      isScroll(v) || v is CompoundButton || v is EditText || isSvg(v)

  private fun role(v: View): String = when {
    v is EditText -> "textbox"
    roleTag(v) != null -> roleTag(v)!!
    v is CompoundButton -> "switch"
    isScroll(v) -> "scrollview"
    v is TextView -> "text"
    isSvg(v) -> "image"
    else -> "generic"
  }

  private fun texts(v: View, out: MutableList<String>) {
    if (v.visibility != View.VISIBLE || v is EditText) return
    if (v is TextView && v.text.isNotEmpty()) out.add(v.text.toString())
    if (v is ViewGroup) for (i in 0 until v.childCount) texts(v.getChildAt(i), out)
  }

  private fun name(v: View): String {
    v.contentDescription?.takeIf { it.isNotEmpty() }?.let { return it.toString() }
    if (v is EditText) return v.hint?.toString() ?: ""
    if (v is TextView) return v.text.toString()
    // Only an element a finger acts on takes its children's text as its name; a list would take every row's.
    if (isScroll(v) || !actionable(v)) return ""
    val parts = mutableListOf<String>()
    texts(v, parts)
    return parts.joinToString(" ").take(NAME_JOIN_MAX)
  }

  private fun flags(v: View, onScreen: Boolean): List<String> {
    val st = v.getTag(R.id.accessibility_state) as? ReadableMap
    fun b(k: String) = st != null && st.hasKey(k) && !st.isNull(k) && try { st.getBoolean(k) } catch (_: Exception) { false }
    val f = mutableListOf<String>()
    if (!v.isEnabled || b("disabled")) f.add("disabled")
    if ((v is CompoundButton && v.isChecked) || b("checked")) f.add("checked")
    if (v.isSelected || b("selected")) f.add("selected")
    if (isScroll(v) || v.canScrollVertically(1) || v.canScrollVertically(-1)) f.add("scrollable")
    if (!onScreen) f.add("offscreen")
    return f
  }

  private fun value(v: View): String? {
    if (v !is EditText) return null
    if (isSecure(v)) return if (v.length() == 0) "" else "••••"
    return v.text.toString()
  }

  // The nodes on screen, and the rows of a scroll container off screen too (flagged), so a row below the fold has a node.
  private fun walk(surface: View): List<Found> {
    val out = ArrayList<Found>()
    fun go(v: View, depth: Int, underNamed: Boolean, inScroll: Boolean) {
      if (out.size >= NODES_MAX || v.visibility != View.VISIBLE) return
      val vis = Rect()
      val onScreen = v.getGlobalVisibleRect(vis) && !vis.isEmpty
      var listed = false
      var named = underNamed
      // Text and decoration inside an element that took them as its name are not listed again.
      val skip = underNamed && ((v is TextView && v !is EditText && !v.isClickable && !v.isFocusable) || (isSvg(v) && v.contentDescription.isNullOrEmpty()))
      if (interesting(v) && !skip && (onScreen || inScroll)) {
        val nm = name(v)
        out.add(Found(v, depth.coerceAtMost(DEPTH_MAX), role(v), nm, value(v), flags(v, onScreen), if (onScreen) vis else screenRect(v)))
        listed = true
        if (actionable(v) && nm.isNotEmpty() && v !is TextView) named = true
      }
      if (v is ViewGroup) for (i in 0 until v.childCount) go(v.getChildAt(i), if (listed) depth + 1 else depth, named, inScroll || isScroll(v))
    }
    go(surface, 0, false, false)
    return out
  }

  private fun ref(g: Guest, view: String, snapshot: String, node: Int): View {
    val table = tables[view]
    if (table == null || table.id != snapshot) throw stale()
    val e = table.entries.getOrNull(node - 1) ?: throw stale()
    val v = e.view.get() ?: throw stale()
    var p: Any? = v.parent
    while (p is View && p !== g.root) p = p.parent
    if (p !== g.root || !v.isAttachedToWindow) throw stale()
    // A recycled view may now show another element; what it was must still hold.
    if (role(v) != e.role || name(v) != e.name) throw stale()
    return v
  }

  private fun stale() = Fail(CONFLICT, "stale_ref", "This node is from an older snapshot or is gone.")

  // ---- input -------------------------------------------------------------------------------------------------

  private fun screenRect(v: View): Rect {
    val l = IntArray(2)
    v.getLocationOnScreen(l)
    return Rect(l[0], l[1], l[0] + v.width, l[1] + v.height)
  }

  // The part of `v` a finger would touch, or null when its centre is not inside the guest.
  private fun shown(g: Guest, v: View): Rect? {
    val r = Rect()
    if (!v.getGlobalVisibleRect(r) || r.isEmpty) return null
    val gr = Rect()
    if (!g.root.getGlobalVisibleRect(gr) || !gr.contains(r.centerX(), r.centerY())) return null
    return r
  }

  // Scrolls `v` into view natively; refuses rather than touch a clamped point at the edge.
  private fun bringIn(g: Guest, v: View): Rect {
    v.requestRectangleOnScreen(Rect(0, 0, v.width, v.height), true)
    return shown(g, v) ?: throw Fail(CONFLICT, "off_screen", "The node could not be brought on screen.")
  }

  private fun event(down: Long, at: Long, action: Int, x: Float, y: Float): MotionEvent =
    MotionEvent.obtain(down, at, action, x, y, 0).apply { source = InputDevice.SOURCE_TOUCHSCREEN }

  private fun send(surface: View, e: MotionEvent) {
    surface.dispatchTouchEvent(e)
    e.recycle()
  }

  // A press at a screen point: DOWN now, UP after `hold` ms, in the surface's coordinates.
  private fun tap(g: Guest, x: Float, y: Float, hold: Long, after: () -> Unit) {
    val s = screenRect(g.surface)
    val lx = x - s.left
    val ly = y - s.top
    val t = SystemClock.uptimeMillis()
    send(g.surface, event(t, t, MotionEvent.ACTION_DOWN, lx, ly))
    main.postDelayed({
      send(g.surface, event(t, t + hold, MotionEvent.ACTION_UP, lx, ly))
      after()
    }, hold)
  }

  private fun enterText(g: Guest, et: EditText, text: String, replace: Boolean) {
    shown(g, et) ?: bringIn(g, et)
    // Focus without a tap: a tap reaches the guest's TextInput, whose onPress focuses it again from JS later and raises
    // the soft keyboard. The guest does not shrink for the keyboard, so it would cover the screen for the person while
    // the agent's snapshot and screenshot do not show it (and a ScrollView spends the next press on closing it).
    if (!et.isFocused && !et.requestFocus()) throw Fail(INVALID, null, "This text field does not take text now.")
    val ic = et.onCreateInputConnection(EditorInfo()) ?: throw Fail(INTERNAL, null, "The text field takes no input.")
    ic.beginBatchEdit()
    val end = et.length()
    if (replace) ic.setSelection(0, end) else ic.setSelection(end, end)
    ic.commitText(text, 1)
    ic.endBatchEdit()
    hideKeyboard(et)
  }

  // A keyboard the person opened before.
  private fun hideKeyboard(v: View) {
    val imm = v.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    imm.hideSoftInputFromWindow(v.windowToken, 0)
  }

  // The scroll container around the focused element, else the first one on screen.
  private fun scroller(g: Guest): View? {
    fun scrolls(v: View) = v is ScrollView || v.canScrollVertically(1) || v.canScrollVertically(-1)
    var p: Any? = g.surface.findFocus()
    while (p is View && p !== g.root) {
      if (scrolls(p)) return p
      p = p.parent
    }
    fun go(v: View): View? {
      if (v.visibility != View.VISIBLE) return null
      if (scrolls(v) && v.getGlobalVisibleRect(Rect())) return v
      if (v is ViewGroup) for (i in 0 until v.childCount) go(v.getChildAt(i))?.let { return it }
      return null
    }
    return go(g.surface)
  }

  // Drags of at most 0.8 of the container until it moved by dy dp or stops moving; each ends still, so nothing flings.
  private fun scrollBy(g: Guest, dyDp: Int?) {
    val sv = scroller(g) ?: throw Fail(INVALID, null, "Nothing on this screen scrolls.")
    val density = sv.resources.displayMetrics.density
    var left = dyDp?.let { it * density } ?: (sv.height / 2f)
    var drags = 0
    while (abs(left) >= 1f && drags < DRAGS_MAX) {
      val r = Rect()
      if (!sv.getGlobalVisibleRect(r)) break
      val step = left.coerceIn(-0.8f * r.height(), 0.8f * r.height())
      val before = sv.scrollY
      drag(g.surface, r.exactCenterX(), r.exactCenterY() + step / 2, r.exactCenterY() - step / 2)
      val moved = sv.scrollY - before
      if (moved == 0) break
      left -= moved
      drags++
    }
  }

  private fun drag(surface: View, x: Float, y0: Float, y1: Float) {
    val s = screenRect(surface)
    val lx = x - s.left
    val a = y0 - s.top
    val b = y1 - s.top
    val t = SystemClock.uptimeMillis()
    val steps = 12
    send(surface, event(t, t, MotionEvent.ACTION_DOWN, lx, a))
    for (i in 1..steps) send(surface, event(t, t + i * 16L, MotionEvent.ACTION_MOVE, lx, a + (b - a) * i / steps))
    // Still before lifting, so the velocity tracker sees no fling.
    send(surface, event(t, t + steps * 16L + 80, MotionEvent.ACTION_MOVE, lx, b))
    send(surface, event(t, t + steps * 16L + 90, MotionEvent.ACTION_UP, lx, b))
  }

  // ---- screenshot --------------------------------------------------------------------------------------------

  // What shows behind a guest that leaves its background transparent (JPEG has no alpha).
  private fun backdrop(v: View): Int {
    var p: Any? = v
    while (p is View) {
      val bg = p.background
      if (bg is ColorDrawable && Color.alpha(bg.color) == 255) return bg.color
      p = p.parent
    }
    return Color.WHITE
  }

  private fun encode(bmp: Bitmap, png: Boolean, quality: Int): ByteArray {
    val out = ByteArrayOutputStream()
    bmp.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, quality, out)
    return out.toByteArray()
  }

  private companion object {
    const val TAG = "LophnDrive"
    const val OK = "{\"ok\":true,\"value\":{}}"
    const val INVALID = "invalid_input"
    const val CONFLICT = "conflict"
    const val UNAVAILABLE = "unavailable"
    const val INTERNAL = "internal"
    // The contract's caps (packages/protocol/phone/drive.ts).
    const val NODES_MAX = 5000
    const val TEXT_MAX = 200
    const val DEPTH_MAX = 100
    const val SHOT_BYTES_MAX = 1024 * 1024
    const val SHOT_SIDE = 1080
    const val NAME_JOIN_MAX = 1000
    const val TAP_HOLD_MS = 50L
    const val SETTLE_MS = 150L
    const val DRAG_SETTLE_MS = 300L
    const val WAIT_EVERY_MS = 200L
    const val DRAGS_MAX = 40
  }
}
