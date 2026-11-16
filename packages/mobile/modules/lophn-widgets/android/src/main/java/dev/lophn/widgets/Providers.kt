package dev.lophn.widgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

// Two fixed providers (Android needs them in the manifest at build time); which app a placed widget shows is its
// binding, not its provider. Both draw at once from the cache, then refresh it in the background.
open class LophnWidgetProvider : AppWidgetProvider() {
  override fun onReceive(ctx: Context, intent: Intent) {
    if (intent.action == Render.ACTION_REFRESH) {
      Refresh.start(ctx, goAsync())
      return
    }
    super.onReceive(ctx, intent)
  }

  // Draws the other provider's widgets too: its own onUpdate waits behind this broadcast until the refresh ends.
  override fun onUpdate(ctx: Context, m: AppWidgetManager, ids: IntArray) {
    Render.drawAll(ctx)
    Refresh.start(ctx, goAsync())
  }
}

class LophnWidgetSmall : LophnWidgetProvider()

class LophnWidgetWide : LophnWidgetProvider()

// The launcher placed a widget the app asked for with requestPin. Only this callback learns the new id (a cancelled
// request sends nothing), so the binding is written here, then the cache is refreshed for it.
class PinResultReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    val bind = intent.getStringExtra(EXTRA_BIND) ?: return
    if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
    synchronized(Files) {
      val all = Files.json(ctx, Files.BINDINGS) ?: JSONObject().put("v", 1)
      val widgets = all.optJSONObject("widgets") ?: JSONObject().also { all.put("widgets", it) }
      widgets.put(id.toString(), JSONObject(bind))
      Files.write(ctx, Files.BINDINGS, all.toString())
    }
    Refresh.start(ctx, goAsync(), changed = true)
  }

  companion object {
    const val EXTRA_BIND = "dev.lophn.widgets.BIND"
  }
}
