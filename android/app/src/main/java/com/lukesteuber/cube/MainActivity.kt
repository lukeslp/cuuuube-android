/*
 * File Purpose: Hosts Cube's canonical offline web game in a lifecycle-aware Android WebView.
 * Primary Components: MainActivity, hardened WebView settings, navigation policy, and back handling.
 * Inputs/Outputs: Loads file:///android_asset/index.html; opens user-selected web links externally.
 */

@file:Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")

package com.lukesteuber.cube

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var backCallback: OnBackInvokedCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = createWebView()
        setContentView(webView)
        keepScreenImmersive()

        val restored = savedInstanceState?.let { webView.restoreState(it) } != null
        if (!restored) {
            webView.loadUrl(START_URL)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback = OnBackInvokedCallback(::navigateBackOrFinish).also { callback ->
                onBackInvokedDispatcher.registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    callback,
                )
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView = WebView(this).apply {
        setBackgroundColor(Color.rgb(1, 3, 10))
        isFocusable = true
        isFocusableInTouchMode = true
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        overScrollMode = View.OVER_SCROLL_NEVER

        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            blockNetworkLoads = true
            cacheMode = WebSettings.LOAD_NO_CACHE
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            builtInZoomControls = false
            displayZoomControls = false
            safeBrowsingEnabled = true
        }

        val isDebugBuild = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        WebView.setWebContentsDebuggingEnabled(isDebugBuild)
        webViewClient = CubeWebViewClient()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) {
            webView.onResume()
            webView.resumeTimers()
        }
        keepScreenImmersive()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) keepScreenImmersive()
    }

    override fun onPause() {
        if (::webView.isInitialized) {
            webView.pauseTimers()
            webView.onPause()
        }
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (::webView.isInitialized) {
            webView.saveState(outState)
        }
        super.onSaveInstanceState(outState)
    }

    @SuppressLint("GestureBackNavigation")
    override fun onBackPressed() {
        navigateBackOrFinish()
    }

    /**
     * Back closes whatever the game has open on top (license notices, then Best
     * Times) before it leaves the app. The game answers "true" when it closed
     * something. If the page cannot answer in time, Back leaves as it always did.
     */
    private fun navigateBackOrFinish() {
        if (!::webView.isInitialized) {
            finish()
            return
        }
        var answered = false
        val leave = Runnable {
            if (!answered) {
                answered = true
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        }
        val handler = Handler(Looper.getMainLooper())
        handler.postDelayed(leave, BACK_ANSWER_TIMEOUT_MS)
        webView.evaluateJavascript(BACK_SCRIPT) { result ->
            if (answered) return@evaluateJavascript
            if (result == "true") {
                answered = true
                handler.removeCallbacks(leave)
            } else {
                handler.removeCallbacks(leave)
                leave.run()
            }
        }
    }

    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback?.let(onBackInvokedDispatcher::unregisterOnBackInvokedCallback)
            backCallback = null
        }
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.webViewClient = WebViewClient()
            webView.removeAllViews()
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun keepScreenImmersive() {
        val activityWindow = window ?: return
        activityWindow.setFlags(
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        )
        activityWindow.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            activityWindow.setDecorFitsSystemWindows(false)
            activityWindow.insetsController?.let { controller ->
                controller.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                controller.hide(WindowInsets.Type.systemBars())
            }
        }
    }

    private inner class CubeWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest,
        ): Boolean = handleNavigation(request.url, request.isForMainFrame, request.hasGesture())

        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
            handleNavigation(Uri.parse(url), isMainFrame = true, hasGesture = true)

        override fun onRenderProcessGone(
            view: WebView,
            detail: RenderProcessGoneDetail,
        ): Boolean {
            Toast.makeText(
                this@MainActivity,
                R.string.webview_restart_message,
                Toast.LENGTH_LONG,
            ).show()
            recreate()
            return true
        }
    }

    private fun handleNavigation(url: Uri, isMainFrame: Boolean, hasGesture: Boolean): Boolean {
        return when (UrlPolicy.classify(url.toString())) {
            UrlDecision.ALLOW_LOCAL -> false
            UrlDecision.OPEN_EXTERNAL -> {
                if (isMainFrame && hasGesture) openExternalUrl(url)
                true
            }
            UrlDecision.BLOCK -> true
        }
    }

    private fun openExternalUrl(url: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, url).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
            })
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, R.string.no_browser_message, Toast.LENGTH_LONG).show()
        }
    }

    private companion object {
        const val START_URL = "file:///android_asset/index.html"
        const val BACK_ANSWER_TIMEOUT_MS = 700L
        const val BACK_SCRIPT =
            "(function(){try{return !!(window.game&&window.game.handleBack&&window.game.handleBack())}" +
                "catch(e){return false}})()"
    }
}
