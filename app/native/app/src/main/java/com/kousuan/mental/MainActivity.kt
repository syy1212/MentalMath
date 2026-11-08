package com.kousuan.mental

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.WebView
import android.widget.Toast
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 主界面：WebView 加载本机服务的练习页。
 * 支持系统分享导入：文件管理器 / 微信里「分享 → 口算天天练」把题库 JSON 一键导入为新题库。
 */
class MainActivity : Activity() {

    private lateinit var web: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Runtime.ensure(this)
        web = WebShell(this).create(Runtime.localBase() + "#/practice")
        setContentView(web)
        handleSendIntent(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleSendIntent(intent)
    }

    private fun handleSendIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val type = intent.type ?: return
        if (!type.startsWith("text/") && !type.contains("json")) return
        val content = sharedContent(intent) ?: return toast("没有可导入的内容")
        if (!content.trimStart().startsWith("[") && !content.trimStart().startsWith("{")) {
            return toast("分享的内容不是题库 JSON")
        }
        Thread {
            try {
                val items = BankImporter.parseBank(content)
                val id = "file_" + System.currentTimeMillis()
                val name = "分享导入 " + SimpleDateFormat("M/d HH:mm", Locale.getDefault()).format(Date())
                // 先导入成功再登记 bank 行，导入失败不残留空题库
                val (added, skipped) = Runtime.store.replaceBank(id, items)
                Runtime.store.saveBank(JSONObject().put("id", id).put("kind", "file").put("name", name))
                Runtime.store.noteBankSync(id, added, if (skipped > 0) "跳过 $skipped 道不支持的题目" else null)
                runOnUiThread {
                    toast("已导入「$name」：$added 道题" + if (skipped > 0) "（跳过 $skipped 道）" else "")
                    web.loadUrl(Runtime.localBase() + "#/banks")
                }
            } catch (e: Exception) {
                runOnUiThread { toast("导入失败：" + (e.message ?: "未知错误")) }
            }
        }.apply { isDaemon = true }.start()
    }

    private fun sharedContent(intent: Intent): String? {
        val stream: Uri? = if (android.os.Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }
        if (stream != null) {
            return try {
                contentResolver.openInputStream(stream)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
            } catch (_: Exception) { null }
        }
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return null
        return text.trim().ifEmpty { null }
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()
}
