package dev.lophn.widgets

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle

// The launcher starts this when a widget is dropped. It has no UI: it opens the phone app's "Choose a widget"
// (lophn://widget/bind?id=<n>&from=configure) and waits for that screen to call finishConfigure(id, ok). Answering OK at
// once would lose the widget when the person presses Home; with no answer the launcher removes it.
class ConfigureActivity : Activity() {
  companion object {
    /** The activity waiting for "Choose a widget" to answer. */
    var waiting: ConfigureActivity? = null
  }

  var id = AppWidgetManager.INVALID_APPWIDGET_ID
    private set
  private var opened = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    id = intent?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      ?: AppWidgetManager.INVALID_APPWIDGET_ID
    setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
    if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return finish()
    waiting = this
    startActivity(
      Intent(Intent.ACTION_VIEW, Uri.parse("lophn://widget/bind?id=$id&from=configure"))
        .setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }

  // Back from "Choose a widget" returns here with no answer: keep the widget as "Tap to choose" rather than leave an
  // invisible activity on top of the launcher.
  override fun onResume() {
    super.onResume()
    if (waiting !== this) return
    if (opened) answer(true) else opened = true
  }

  fun answer(ok: Boolean) {
    setResult(if (ok) RESULT_OK else RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
    // The system sends no update after a configure activity: the first drawing is ours.
    if (ok) Render.draw(this, AppWidgetManager.getInstance(this), id)
    waiting = null
    finish()
  }

  override fun onDestroy() {
    if (waiting === this) waiting = null
    super.onDestroy()
  }
}
