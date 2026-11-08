package com.kousuan.mental

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * 组合根（结构对应 StudyOnTV 的 DeviceRuntime）：任意 Activity 首次进入时调用 ensure()，
 * 依次打开 SQLite → 首启内置建库 → 启动 HTTP 服务 → 异步检查题库源自动同步。
 */
object Runtime {

    private var server: LanServer? = null
    lateinit var store: LocalStore
        private set

    @Synchronized
    fun ensure(context: Context) {
        if (server != null) return
        val app = context.applicationContext
        store = LocalStore(app)
        ensureBuiltIn()
        server = LanServer(app, store).also { it.start() }
        WebShell.PrefsHolder.baseUrl = localBase()
        // 题库源自动同步：到期才拉取，单源失败不影响启动
        Thread { BankSync.autoSync(store) }.apply { isDaemon = true }.start()
    }

    fun localBase(): String = "http://127.0.0.1:${server?.boundPort ?: LanServer.PORT}/"

    fun lanUrl(): String {
        val ip = server?.localIp() ?: ""
        return "http://$ip:${server?.boundPort ?: LanServer.PORT}/"
    }

    /**
     * 内置题库：bank 行始终存在；题目为空（首启或被清空）时按 4 档位各生成 40 道自动补齐。
     */
    private fun ensureBuiltIn() {
        if (store.bank(Generator.BUILT_IN) == null) {
            store.saveBank(JSONObject()
                .put("id", Generator.BUILT_IN)
                .put("name", "内置口算题库")
                .put("kind", "built-in"))
        }
        if (store.countQuestions(Generator.BUILT_IN) > 0) return
        val all = JSONArray()
        for (level in Generator.LEVELS) {
            for (question in Generator.generate(level.id, 40)) {
                all.put(JSONObject()
                    .put("type", "single")
                    .put("q", question.text)
                    .put("a", JSONArray(question.options.map { it.toString() }))
                    .put("k", question.options.indexOf(question.answer))
                    .put("difficulty", level.difficulty)
                    .put("tip", question.text.replace(" = ?", " = ${question.answer}"))
                    .put("subject", "口算"))
                // 年级标签留空，由家长在管理端批量补标（档位名不是年级）
            }
        }
        try {
            store.replaceBank(Generator.BUILT_IN, all)
        } catch (_: Exception) { /* 生成失败下次启动重试 */ }
    }
}
