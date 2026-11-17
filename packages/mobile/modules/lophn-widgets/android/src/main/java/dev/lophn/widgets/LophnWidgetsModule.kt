package dev.lophn.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import android.util.Base64
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

// What the phone app's TS reaches of the home screen: the widget files, placed widget ids, drawing, placing a widget
// or an app icon (pinned shortcut).
class LophnWidgetsModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  // TS reads and writes only the widget files, never the rest of the app's private folder.
  private fun file(name: String): String {
    require(NAME.matches(name)) { "not a widget file: $name" }
    return name
  }

  override fun definition() = ModuleDefinition {
    Name("LophnWidgets")

    AsyncFunction("readText") { name: String -> Files.read(ctx, file(name)) }
    AsyncFunction("writeText") { name: String, text: String ->
      require(name != Files.BINDINGS) { "the bindings change only through bindWidget and dropUnplacedBindings" }
      Files.write(ctx, file(name), text)
    }
    // The two changes TS makes to the bindings, each in one step under the lock the pin callback takes.
    AsyncFunction("bindWidget") { id: Int, bind: String ->
      Files.updateBindings(ctx) { widgets ->
        widgets.put(id.toString(), JSONObject(bind))
        true
      }
      Unit
    }
    // Forgets the widgets the launcher no longer has; returns the bindings left.
    AsyncFunction("dropUnplacedBindings") {
      val placed = Render.placedIds(ctx).toSet()
      Files.updateBindings(ctx) { widgets ->
        val gone = widgets.keys().asSequence().filter { key -> key.toIntOrNull().let { it == null || it !in placed } }.toList()
        gone.forEach { widgets.remove(it) }
        gone.isNotEmpty()
      }
    }
    AsyncFunction("redraw") { ids: List<Int>? ->
      if (ids == null) Render.drawAll(ctx)
      else {
        val m = AppWidgetManager.getInstance(ctx)
        val cache = Files.json(ctx, Files.CACHE)
        for (id in ids) Render.draw(ctx, m, id, cache)
      }
    }

    Function("isPinSupported") { AppWidgetManager.getInstance(ctx).isRequestPinAppWidgetSupported }
    // True when the launcher showed its "add" sheet. The binding is written by PinResultReceiver if the person adds it.
    Function("requestPin") { size: String, bind: String ->
      val provider = when (size) {
        "small" -> LophnWidgetSmall::class.java
        "wide" -> LophnWidgetWide::class.java
        else -> throw IllegalArgumentException("size: $size")
      }
      val callback = Intent(ctx, PinResultReceiver::class.java).putExtra(PinResultReceiver.EXTRA_BIND, bind)
      // Mutable: the system adds the new widget's id to it.
      val pending = PendingIntent.getBroadcast(ctx, bind.hashCode(), callback, PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      AppWidgetManager.getInstance(ctx).requestPinAppWidget(ComponentName(ctx, provider), null, pending)
    }
    // "Choose a widget" opened by ConfigureActivity is done: keep (ok) or drop the widget, and leave the home screen on top.
    Function("finishConfigure") { id: Int, ok: Boolean ->
      val waiting = ConfigureActivity.waiting?.takeIf { it.id == id } ?: return@Function false
      waiting.runOnUiThread {
        waiting.answer(ok)
        appContext.currentActivity?.moveTaskToBack(true)
      }
      true
    }

    Function("isShortcutPinSupported") { ShortcutManagerCompat.isRequestPinShortcutSupported(ctx) }
    // True when the launcher showed its sheet, or at once (no sheet) when this id is already pinned.
    Function("pinShortcut") { id: String, label: String, png: String, url: String ->
      val bytes = Base64.decode(png, Base64.DEFAULT)
      val icon = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let { IconCompat.createWithAdaptiveBitmap(adaptive(it)) }
        ?: IconCompat.createWithResource(ctx, R.drawable.lophn_mark)
      val info = ShortcutInfoCompat.Builder(ctx, id)
        .setShortLabel(label)
        .setIcon(icon)
        .setIntent(Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(ctx.packageName))
        .build()
      ShortcutManagerCompat.requestPinShortcut(ctx, info, null)
    }
    Function("pinnedShortcuts") {
      ShortcutManagerCompat.getShortcuts(ctx, ShortcutManagerCompat.FLAG_MATCH_PINNED).map { it.id }
    }
    Function("disableShortcuts") { ids: List<String>, message: String -> ShortcutManagerCompat.disableShortcuts(ctx, ids, message) }
    Function("enableShortcuts") { ids: List<String> ->
      ShortcutManagerCompat.enableShortcuts(ctx, ShortcutManagerCompat.getShortcuts(ctx, ShortcutManagerCompat.FLAG_MATCH_PINNED).filter { it.id in ids })
    }
  }

  // The launcher masks a 108-unit square and shows its middle 72: put the icon in that middle on white.
  private fun adaptive(icon: Bitmap): Bitmap {
    val size = icon.width * 108 / 72
    val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    canvas.drawColor(Color.WHITE)
    canvas.drawBitmap(icon, (size - icon.width) / 2f, (size - icon.height) / 2f, null)
    return out
  }

  companion object {
    private val NAME = Regex("^widgets/[A-Za-z0-9_-][A-Za-z0-9._-]*$")
  }
}
