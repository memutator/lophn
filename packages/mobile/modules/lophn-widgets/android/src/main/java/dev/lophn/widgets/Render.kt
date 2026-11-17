package dev.lophn.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.io.File

// Draws widgets from widgets/cache.json, which the phone app's TS writes (src/widgets/cache.ts). No JS runs here: every
// word on a widget is in that file. A cache that is missing, broken or of a shape this code does not know draws the
// widget as "Tap to choose" rather than failing.
object Render {
  const val ACTION_REFRESH = "dev.lophn.widgets.REFRESH"
  private const val TAG = "LophnWidgets"

  fun providers() = listOf(LophnWidgetSmall::class.java, LophnWidgetWide::class.java)

  fun placedIds(ctx: Context): IntArray {
    val m = AppWidgetManager.getInstance(ctx)
    return providers().flatMap { m.getAppWidgetIds(ComponentName(ctx, it)).toList() }.toIntArray()
  }

  fun drawAll(ctx: Context) {
    val m = AppWidgetManager.getInstance(ctx)
    val cache = Files.json(ctx, Files.CACHE)
    for (id in placedIds(ctx)) draw(ctx, m, id, cache)
  }

  fun draw(ctx: Context, m: AppWidgetManager, id: Int, cache: JSONObject? = Files.json(ctx, Files.CACHE)) {
    val strings = cache?.optJSONObject("strings")
    val choose = strings?.optString("tap_to_choose")?.ifEmpty { null } ?: "Tap to choose"
    val entry = cache?.optJSONObject("widgets")?.optJSONObject(id.toString())
    val views = try {
      when (entry?.optString("state")) {
        "ok" -> widget(ctx, m, id, entry)
        "gone" -> placeholder(ctx, strings?.optString("gone") ?: "This widget is no longer available", false, entry.getString("open_url"))
        "computer_removed" -> placeholder(ctx, strings?.optString("computer_removed") ?: "Computer removed", false, entry.getString("open_url"))
        else -> null
      }
    } catch (e: Exception) {
      Log.w(TAG, "widget $id: cannot draw its cache entry", e)
      null
    } ?: placeholder(ctx, choose, true, "lophn://widget/bind?id=$id")
    m.updateAppWidget(id, views)
  }

  private fun placeholder(ctx: Context, text: String, mark: Boolean, url: String): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.lophn_placeholder)
    v.setTextViewText(R.id.lw_text, text)
    v.setViewVisibility(R.id.lw_mark, if (mark) View.VISIBLE else View.GONE)
    v.setOnClickPendingIntent(R.id.lw_root, open(ctx, url))
    return v
  }

  private fun widget(ctx: Context, m: AppWidgetManager, id: Int, entry: JSONObject): RemoteViews? {
    val rows = entry.optJSONArray("rows") ?: return null
    val v = RemoteViews(ctx.packageName, R.layout.lophn_widget)
    v.setTextViewText(R.id.lw_title, entry.getString("title"))
    v.setTextViewText(R.id.lw_footer, entry.getString("footer"))
    val tone = entry.optString("tone").ifEmpty { null }
    // The launcher applies an update onto the views it already shows: without these, rows and dimming would pile up.
    v.removeAllViews(R.id.lw_rows)
    for (i in 0 until rows.length()) addRow(ctx, v, rows.getJSONObject(i), tone)
    v.setFloat(R.id.lw_rows, "setAlpha", if (entry.optBoolean("stale")) 0.4f else 1f)
    v.setOnClickPendingIntent(R.id.lw_root, open(ctx, entry.getString("open_url")))
    v.setOnClickPendingIntent(R.id.lw_refresh, refresh(ctx, m, id))
    return v
  }

  // The widget's `tone` is the tone of every node that has none of its own.
  private fun addRow(ctx: Context, v: RemoteViews, node: JSONObject, widgetTone: String?) {
    val pkg = ctx.packageName
    val tone = node.optString("tone").ifEmpty { widgetTone }
    when (node.getString("kind")) {
      "text" -> {
        val layout = when (node.getString("style")) {
          "title" -> R.layout.lophn_row_title
          "body" -> R.layout.lophn_row_body
          "caption" -> R.layout.lophn_row_caption
          else -> throw IllegalArgumentException("text style")
        }
        val row = RemoteViews(pkg, layout)
        row.setTextViewText(R.id.lw_text, node.getString("text"))
        color(ctx, row, R.id.lw_text, tone)
        v.addView(R.id.lw_rows, row)
      }
      "stat" -> {
        val row = RemoteViews(pkg, R.layout.lophn_row_stat)
        row.setTextViewText(R.id.lw_value, node.getString("value"))
        row.setTextViewText(R.id.lw_label, node.getString("label"))
        color(ctx, row, R.id.lw_value, tone)
        v.addView(R.id.lw_rows, row)
      }
      "progress" -> {
        // One layout per tone, so the bar's colour follows night mode on every API level.
        val layout = when (tone) {
          "good" -> R.layout.lophn_row_progress_good
          "warn" -> R.layout.lophn_row_progress_warn
          "bad" -> R.layout.lophn_row_progress_bad
          else -> R.layout.lophn_row_progress_neutral
        }
        val row = RemoteViews(pkg, layout)
        row.setProgressBar(R.id.lw_bar, 1000, (node.getDouble("value").coerceIn(0.0, 1.0) * 1000).toInt(), false)
        val label = node.optString("label")
        row.setTextViewText(R.id.lw_label, label)
        if (label.isEmpty()) row.setViewVisibility(R.id.lw_label, View.GONE)
        v.addView(R.id.lw_rows, row)
      }
      "list" -> {
        val list = RemoteViews(pkg, R.layout.lophn_row_list)
        val items = node.getJSONArray("items")
        for (i in 0 until items.length()) {
          val item = items.getJSONObject(i)
          val row = RemoteViews(pkg, R.layout.lophn_row_item)
          row.setTextViewText(R.id.lw_text, item.getString("text"))
          row.setTextViewText(R.id.lw_trail, item.optString("trail"))
          val itemTone = item.optString("tone").ifEmpty { widgetTone }
          color(ctx, row, R.id.lw_text, itemTone)
          color(ctx, row, R.id.lw_trail, itemTone)
          list.addView(R.id.lw_items, row)
        }
        v.addView(R.id.lw_rows, list)
      }
      else -> throw IllegalArgumentException("node kind")
    }
  }

  private fun color(ctx: Context, row: RemoteViews, view: Int, tone: String?) {
    val res = when (tone) {
      "good" -> R.color.lophn_w_good_text
      "warn" -> R.color.lophn_w_warn_text
      "bad" -> R.color.lophn_w_bad_text
      else -> return
    }
    // From 31 the launcher resolves the colour, so it follows a night mode switch without a redraw.
    if (Build.VERSION.SDK_INT >= 31) row.setColor(view, "setTextColor", res)
    else row.setTextColor(view, ctx.getColor(res))
  }

  private fun open(ctx: Context, url: String): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(ctx.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun refresh(ctx: Context, m: AppWidgetManager, id: Int): PendingIntent {
    val cls = m.getAppWidgetInfo(id)?.provider?.className ?: LophnWidgetSmall::class.java.name
    val intent = Intent(ACTION_REFRESH).setClassName(ctx, cls).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
    return PendingIntent.getBroadcast(ctx, id, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }
}

// The two files TS and native share, in the app's private folder. TS reaches only `widgets/` (LophnWidgetsModule).
object Files {
  const val CACHE = "widgets/cache.json"
  const val BINDINGS = "widgets/bindings.json"

  fun read(ctx: Context, name: String): String? = File(ctx.filesDir, name).let { if (it.exists()) it.readText() else null }

  fun json(ctx: Context, name: String): JSONObject? = try { read(ctx, name)?.let(::JSONObject) } catch (_: Exception) { null }

  // Through a temporary file, so a widget drawn at the same moment never reads half a file.
  @Synchronized
  fun write(ctx: Context, name: String, text: String) {
    val file = File(ctx.filesDir, name)
    file.parentFile?.mkdirs()
    val tmp = File(file.parentFile, "${file.name}.tmp")
    tmp.writeText(text)
    if (!tmp.renameTo(file)) throw java.io.IOException("cannot write $name")
  }

  // The bindings change in one read-change-write under this object's lock: the pin callback and the app's JS both
  // change them, and a write from a read taken before the other's change would drop that change. `change` gets the
  // `widgets` object and says whether it changed it. Returns the file's text after.
  @Synchronized
  fun updateBindings(ctx: Context, change: (widgets: JSONObject) -> Boolean): String {
    val all = json(ctx, BINDINGS) ?: JSONObject().put("v", 1)
    val widgets = all.optJSONObject("widgets") ?: JSONObject().also { all.put("widgets", it) }
    val text = all.toString()
    if (!change(widgets)) return text
    val next = all.toString()
    write(ctx, BINDINGS, next)
    return next
  }
}
