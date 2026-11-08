package com.kousuan.mental

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * 题库自动同步：
 * - url 源：打开 app 时检查（默认 24h 到期），GET JSON → 校验 → 按 bank 整库替换
 * - device 源：从局域网 StudyOnTV 设备 /api/questions 拉取（auth → 抽样取并集，兼容旧版单次 50 条随机子集）
 * 同步结果记录在 banks 表（last_sync / item_count / last_error），前端展示。
 */
object BankSync {

    fun sync(store: LocalStore, bankId: String): JSONObject {
        val bank = store.bank(bankId) ?: throw IllegalArgumentException("题库不存在")
        return when (bank.optString("kind")) {
            "url" -> syncUrl(store, bank)
            "device" -> syncDevice(store, bank)
            else -> throw IllegalArgumentException("该题库类型不支持同步（${bank.optString("kind")}）")
        }
    }

    private fun syncUrl(store: LocalStore, bank: JSONObject): JSONObject {
        val id = bank.getString("id")
        val url = bank.optString("url")
        require(url.startsWith("http://") || url.startsWith("https://")) { "URL 无效：$url" }
        try {
            val items = BankImporter.parseBank(httpGet(url))
            val (added, skipped) = store.replaceBank(id, items)
            store.noteBankSync(id, store.countQuestions(id),
                if (skipped > 0) "跳过 $skipped 道不支持的题目" else null)
            return JSONObject().put("ok", true).put("added", added).put("skipped", skipped)
        } catch (e: Exception) {
            store.noteBankSync(id, store.countQuestions(id), e.message ?: "同步失败")
            throw e
        }
    }

    private fun syncDevice(store: LocalStore, bank: JSONObject): JSONObject {
        val id = bank.getString("id")
        val host = bank.optString("host")
        val secret = store.bankSecret(id)
        require(host.isNotEmpty()) { "缺少设备地址" }
        try {
            val token = deviceAuth(host, secret)
            val items = fetchDeviceQuestions(host, token)
            val (added, skipped) = store.replaceBank(id, items)
            store.noteBankSync(id, store.countQuestions(id),
                if (skipped > 0) "跳过 $skipped 道不支持的题目" else null)
            return JSONObject().put("ok", true).put("added", added).put("skipped", skipped)
        } catch (e: Exception) {
            store.noteBankSync(id, store.countQuestions(id), e.message ?: "同步失败")
            throw e
        }
    }

    /**
     * 启动时自动同步：所有启用的 url / device 源，last_sync 距今超过 autoSyncHours 才拉取。
     * 单源失败不影响其他源，错误写入 last_error。
     */
    fun autoSync(store: LocalStore) {
        val hours = store.config().optInt("autoSyncHours", 24)
        val due = System.currentTimeMillis() - hours * 3600000L
        val banks = store.banks()
        for (i in 0 until banks.length()) {
            val bank = banks.getJSONObject(i)
            val kind = bank.optString("kind")
            if (kind != "url" && kind != "device") continue
            if (!bank.optBoolean("enabled", true)) continue
            if (bank.optLong("lastSync", 0) > due) continue
            try { sync(store, bank.getString("id")) } catch (_: Exception) { /* 已记录到 last_error */ }
        }
    }

    // ---------- StudyOnTV 设备协议 ----------

    /** POST /api/auth {passphrase} → {token}，对齐 StudyOnTV 管理鉴权 */
    private fun deviceAuth(host: String, passphrase: String): String {
        require(passphrase.isNotEmpty()) { "请先在题库设置里填写设备管理密码" }
        val body = JSONObject().put("passphrase", passphrase).toString().toByteArray(Charsets.UTF_8)
        val conn = URL("http://$host/api/auth").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.connectTimeout = 5000
        conn.readTimeout = 10000
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        conn.outputStream.use { it.write(body) }
        val response = readResponse(conn)
        val json = try { JSONObject(response) } catch (_: Exception) { JSONObject() }
        val token = json.optString("token")
        require(token.isNotEmpty()) { "设备验证失败：${json.optString("message", "管理密码错误？")}" }
        return token
    }

    /**
     * 拉取设备题目。新版本支持 limit=5000 一次取全；
     * 旧版本单次最多返回 50 条随机子集（offset 无效），此处循环抽样按 id 取并集，直到不再出现新 id。
     */
    private fun fetchDeviceQuestions(host: String, token: String): JSONArray {
        val first = sampleOnce(host, token, 5000)
        val union = LinkedHashMap<String, JSONObject>()
        for (i in 0 until first.length()) {
            val item = first.getJSONObject(i)
            union[item.optString("id")] = item
        }
        if (first.length() > 50) return JSONArray(union.values.toList())
        var rounds = 0
        var lastSize = union.size
        while (rounds < 30) {
            rounds++
            val batch = sampleOnce(host, token, 50)
            for (i in 0 until batch.length()) {
                val item = batch.getJSONObject(i)
                union.putIfAbsent(item.optString("id"), item)
            }
            if (union.size == lastSize && rounds >= 3) break // 连续几轮无新题，视为取全
            lastSize = union.size
        }
        require(union.isNotEmpty()) { "设备未返回任何题目" }
        return JSONArray(union.values.toList())
    }

    private fun sampleOnce(host: String, token: String, limit: Int): JSONArray {
        val conn = URL("http://$host/api/questions?limit=$limit").openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.connectTimeout = 5000
        conn.readTimeout = 15000
        conn.setRequestProperty("Authorization", "Bearer $token")
        val json = try { JSONObject(readResponse(conn)) } catch (_: Exception) { JSONObject() }
        return json.optJSONArray("items") ?: JSONArray()
    }

    // ---------- 通用 HTTP ----------

    private fun httpGet(url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 10000
        conn.readTimeout = 15000
        conn.instanceFollowRedirects = true
        return readResponse(conn)
    }

    private fun readResponse(conn: HttpURLConnection): String {
        try {
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            if (code !in 200..299) throw IllegalArgumentException("HTTP $code：${text.take(200)}")
            return text
        } finally {
            conn.disconnect()
        }
    }
}
