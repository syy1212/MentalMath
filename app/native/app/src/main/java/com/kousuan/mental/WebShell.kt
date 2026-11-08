package com.kousuan.mental

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.net.URL

/** WebView 工厂：加载本机 HTTP 服务页面，限制只能访问本机地址 */
class WebShell(private val context: Context) {

    @SuppressLint("SetJavaScriptEnabled")
    fun create(url: String): WebView {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val web = WebView(context)
        web.setBackgroundColor(0xFF101014.toInt())
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.loadsImagesAutomatically = true
        s.allowFileAccess = false
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.displayZoomControls = false
        s.useWideViewPort = true
        s.loadWithOverviewMode = true
        s.userAgentString = s.userAgentString + " MentalMath/" + BuildConfig.VERSION_NAME

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, target: String?): Boolean =
                !isAllowed(target)
        }
        web.webChromeClient = WebChromeClient()
        web.loadUrl(url)
        return web
    }

    companion object {
        fun isAllowed(url: String?): Boolean {
            if (url == null || url == "about:blank") return true
            val base = PrefsHolder.baseUrl ?: return false
            return try {
                val target = URL(url)
                val source = URL(base)
                target.protocol == source.protocol && target.host == source.host && target.port == source.port
            } catch (_: Throwable) {
                false
            }
        }
    }

    object PrefsHolder {
        @Volatile
        var baseUrl: String? = null
    }
}
