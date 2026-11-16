package dev.lophn.appdb

import com.facebook.react.BaseReactPackage
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import io.callstack.rnsandbox.SandboxAwareModule
import java.util.concurrent.ConcurrentHashMap

// Autolinked for the app's own runtime, and registered with the sandbox as a substitution package
// (plugins/with-app-db.js) so a guest that lists the module as a substitution of itself gets an instance with its origin.
class LophnAppDbPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == LophnAppDbModule.NAME) LophnAppDbModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(LophnAppDbModule.NAME to ReactModuleInfo(LophnAppDbModule.NAME, LophnAppDbModule::class.java.name, false, false, false, false))
  }
}

// One instance per runtime. The synchronous methods run on that runtime's JS thread, where the native side may touch it.
class LophnAppDbModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx), SandboxAwareModule {
  private var origin: String? = null
  private var installed = false

  override fun getName() = NAME

  override fun configureSandbox(origin: String, requestedName: String, resolvedName: String) {
    this.origin = origin
  }

  // Only the app's main ReactHost may bind files or open paths. A guest's context is not the main host's context
  // (and its application context is the sandbox's wrapper, not the ReactApplication).
  private fun requireHost(method: String) {
    val app = reactApplicationContext.applicationContext as? ReactApplication
    if (origin != null || app == null || app.reactHost?.currentReactContext !== reactApplicationContext) {
      throw IllegalStateException("forbidden: $NAME.$method is only for the app's host runtime")
    }
  }

  private fun runtime(): Long {
    val ptr = reactApplicationContext.javaScriptContextHolder?.get() ?: 0L
    if (ptr == 0L) throw IllegalStateException("unavailable: no JS runtime")
    return ptr
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun installHost(): Boolean {
    requireHost("installHost")
    nativeInstallHost(runtime())?.let { throw IllegalStateException(it) }
    return true
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun bind(origin: String, path: String, record: Boolean): Boolean {
    requireHost("bind")
    bindings[origin] = Binding(path, record)
    return true
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun unbind(origin: String): Boolean {
    requireHost("unbind")
    bindings.remove(origin)
    nativeUnbind(origin)
    return true
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun install(): Boolean {
    val o = origin ?: throw IllegalStateException("forbidden: $NAME.install is only for a guest runtime")
    if (installed) throw IllegalStateException("forbidden: this runtime already has its database handle")
    val b = bindings[o] ?: throw IllegalStateException("not_found: no database is bound to this guest")
    installed = true
    nativeInstallGuest(runtime(), o, b.path, b.record)?.let { throw IllegalStateException(it) }
    return true
  }

  private data class Binding(val path: String, val record: Boolean)

  companion object {
    const val NAME = "LophnAppDb"
    private val bindings = ConcurrentHashMap<String, Binding>()

    init {
      System.loadLibrary("lophnappdb")
    }

    @JvmStatic external fun nativeInstallHost(runtimePtr: Long): String?

    @JvmStatic external fun nativeInstallGuest(runtimePtr: Long, origin: String, path: String, record: Boolean): String?

    @JvmStatic external fun nativeUnbind(origin: String)
  }
}
