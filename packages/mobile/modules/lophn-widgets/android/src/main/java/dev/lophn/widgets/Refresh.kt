package dev.lophn.widgets

import android.content.BroadcastReceiver
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

// Runs the phone app's JS task "LophnWidgetRefresh" (refreshWidgetsInBackground) while the widget broadcast is held
// open with goAsync(). The React host is started in this process: RN's HeadlessJsTaskService is a service, and Android
// 12+ refuses to start one from a widget broadcast while the app is in the background.
// Broadcasts come in bursts (one onUpdate per provider class, after an install or an unmask). Android hands them to the
// app one after another, each after the previous goAsync() ended, so one that comes right after a refresh is dropped,
// and one that comes during a refresh joins it.
object Refresh {
  private const val TASK = "LophnWidgetRefresh"
  private const val TAG = "LophnWidgets"
  private const val TIMEOUT_MS = 25_000L
  private const val FRESH_MS = 3_000L
  private val main = Handler(Looper.getMainLooper())
  private val held = mutableListOf<BroadcastReceiver.PendingResult>()
  private var running = false
  private var again = false
  // Bumped by every launch and by done(), so a task that ends after its deadline does not end a later one.
  private var generation = 0
  private val deadline = Runnable { done() }
  private var startedAt = 0L
  private var doneAt = -FRESH_MS

  /** `changed`: something the running task may already have read has changed (a new binding), so run once more after it. */
  fun start(ctx: Context, result: BroadcastReceiver.PendingResult?, changed: Boolean = false) {
    val app = ctx.applicationContext
    main.post {
      result?.let(held::add)
      if (running) {
        again = again || changed
        return@post
      }
      if (!changed && SystemClock.elapsedRealtime() - doneAt < FRESH_MS) return@post done()
      running = true
      startedAt = SystemClock.elapsedRealtime()
      launch(app)
    }
  }

  private fun launch(app: Context) {
    main.removeCallbacks(deadline)
    main.postDelayed(deadline, TIMEOUT_MS)
    val gen = ++generation
    val host = (app as? ReactApplication)?.reactHost ?: return done()
    host.currentReactContext?.let { return run(it, gen) }
    host.addReactInstanceEventListener(object : ReactInstanceEventListener {
      override fun onReactContextInitialized(context: ReactContext) {
        host.removeReactInstanceEventListener(this)
        main.post { run(context, gen) }
      }
    })
    host.start()
  }

  private fun run(context: ReactContext, gen: Int) {
    if (gen != generation) return
    val tasks = HeadlessJsTaskContext.getInstance(context)
    var mine = -1
    tasks.addTaskEventListener(object : HeadlessJsTaskEventListener {
      override fun onHeadlessJsTaskStart(taskId: Int) {}
      override fun onHeadlessJsTaskFinish(taskId: Int) {
        if (taskId != mine) return
        tasks.removeTaskEventListener(this)
        main.post {
          if (gen != generation) return@post
          if (again) {
            again = false
            launch(context.applicationContext)
          } else done()
        }
      }
    })
    try {
      mine = tasks.startTask(HeadlessJsTaskConfig(TASK, Arguments.createMap(), TIMEOUT_MS, true))
    } catch (e: Exception) {
      Log.w(TAG, "cannot start $TASK", e)
      done()
    }
  }

  private fun done() {
    main.removeCallbacks(deadline)
    if (running) {
      doneAt = SystemClock.elapsedRealtime()
      Log.i(TAG, "refresh done in ${doneAt - startedAt} ms, ${held.size} broadcast(s)")
    }
    generation++
    running = false
    again = false
    for (one in held) one.finish()
    held.clear()
  }
}
