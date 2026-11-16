package dev.lophn.drive

import android.view.WindowManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The phone side of `drive.*`: reads and drives a guest screen of the phone app. Every answer is a JSON string that
// index.ts checks against the drive contract (packages/protocol/phone/drive.ts).
class LophnDriveModule : Module() {
  private val drive = Drive { appContext.currentActivity }

  override fun definition() = ModuleDefinition {
    Name("LophnDrive")

    AsyncFunction("snapshot") { view: String, promise: Promise ->
      drive.snapshot(view) { promise.resolve(it) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("act") { view: String, snapshot: String, act: String, promise: Promise ->
      drive.act(view, snapshot, act) { promise.resolve(it) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("screenshot") { view: String, format: String, promise: Promise ->
      drive.screenshot(view, format) { promise.resolve(it) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("waitText") { view: String, text: String, timeoutMs: Int, promise: Promise ->
      drive.waitText(view, text, timeoutMs) { promise.resolve(it) }
    }.runOnQueue(Queues.MAIN)

    Function("keepScreenOn") { on: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      activity.runOnUiThread {
        val flag = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        if (on) activity.window.addFlags(flag) else activity.window.clearFlags(flag)
      }
    }
  }
}
