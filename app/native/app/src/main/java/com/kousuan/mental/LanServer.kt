package com.kousuan.mental

import android.content.Context
import android.content.res.AssetManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.Collections
import java.util.concurrent.Executors

/**
 * 局域网 HTTP 服务（端口 8098，无鉴权——纯刷题应用，家庭内网使用）。
 * 手写 HTTP/1.1，零第三方依赖；结构沿用 StudyOnTV LanServer 的 accept 循环 + 线程池 + 逐行解析。
 * 服务两类客户端：本机 WebView（127.0.0.1，加载练习页）和局域网浏览器（电脑/手机直接管理题库）。
 */
class LanServer(private val context: Context, private val store: LocalStore) {

    companion object {
        const val PORT = 8098
        private const val MAX_BODY = 8 * 1024 * 1024
        private val MIME = mapOf(
            "html" to "text/html; charset=utf-8",
            "js" to "application/javascript; charset=utf-8",
            "css" to "text/css; charset=utf-8",
            "json" to "application/json; charset=utf-8",
            "svg" to "image/svg+xml",
            "png" to "image/png",
            "jpg" to "image/jpeg",
            "woff2" to "font/woff2",
            "ico" to "image/x-icon"
        )
    }

    @Volatile var boundPort: Int = PORT
        private set
    private var socket: ServerSocket? = null
    private val pool = Executors.newFixedThreadPool(4)

    fun start() {
        val server = ServerSocket()
        server.reuseAddress = true
        server.bind(InetSocketAddress(PORT))
        socket = server
        boundPort = server.localPort
        Thread({
            while (!server.isClosed) {
                try {
                    val client = server.accept()
                    pool.execute { handle(client) }
                } catch (_: Exception) {
                    break
                }
            }
        }, "LanServer-accept").apply { isDaemon = true }.start()
    }

    fun stop() {
        try { socket?.close() } catch (_: Exception) {}
        pool.shutdownNow()
    }

    fun localIp(): String? {
        val en = java.net.NetworkInterface.getNetworkInterfaces() ?: return null
        for (ni in Collections.list(en)) {
            if (!ni.isUp || ni.isLoopback) continue
            for (addr in Collections.list(ni.inetAddresses)) {
                if (!addr.isLoopbackAddress && addr is java.net.Inet4Address) return addr.hostAddress
            }
        }
        return null
    }

    // ---------- 请求处理 ----------

    private fun handle(client: Socket) {
        try {
            client.soTimeout = 15000
            val input = client.getInputStream()
            val out = client.getOutputStream()
            // 请求头逐字节按行读（避免缓冲区吞掉 body 的前几个字节）
            val requestLine = readByteLine(input)
            if (requestLine.isEmpty()) return
            val parts = requestLine.split(" ")
            if (parts.size < 2) return
            val method = parts[0].uppercase()
            val target = parts[1]
            val headers = HashMap<String, String>()
            while (true) {
                val line = readByteLine(input)
                if (line.isEmpty()) break
                val idx = line.indexOf(':')
                if (idx > 0) headers[line.substring(0, idx).trim().lowercase()] = line.substring(idx + 1).trim()
            }
            // Content-Length 以字节计；中文等多字节字符必须按字节读，再统一 UTF-8 解码
            var body = ""
            val length = headers["content-length"]?.toIntOrNull() ?: 0
            if (length > 0) {
                require(length <= MAX_BODY) { "请求体过大" }
                if (headers["expect"]?.contains("100-continue") == true) {
                    out.write("HTTP/1.1 100 Continue\r\n\r\n".toByteArray(Charsets.UTF_8))
                    out.flush()
                }
                val buf = ByteArray(length)
                var read = 0
                while (read < length) {
                    val n = input.read(buf, read, length - read)
                    if (n < 0) break
                    read += n
                }
                body = String(buf, 0, read, Charsets.UTF_8)
            }
            val path: String
            val query: String
            val qIdx = target.indexOf('?')
            if (qIdx >= 0) { path = target.substring(0, qIdx); query = target.substring(qIdx + 1) }
            else { path = target; query = "" }
            route(method, path, query, body, out)
        } catch (_: Exception) {
        } finally {
            try { client.close() } catch (_: Exception) {}
        }
    }

    /** 按字节读一行（到 \n 为止，去掉结尾 \r），不预读 body */
    private fun readByteLine(input: java.io.InputStream): String {
        val buf = java.io.ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0 || b == '\n'.code.toByte().toInt()) break
            buf.write(b)
        }
        return buf.toString("UTF-8").trimEnd('\r')
    }

    private fun route(method: String, path: String, query: String, body: String, out: OutputStream) {
        try {
            if (path.startsWith("/api/")) api(method, path, query, body, out)
            else static(path, out)
        } catch (e: IllegalArgumentException) {
            json(out, 200, err("bad_request").put("message", e.message ?: "请求无效"))
        } catch (e: Exception) {
            json(out, 500, err("server_error").put("message", e.message ?: "服务异常"))
        }
    }

    private fun q(query: String): Map<String, String> =
        if (query.isEmpty()) emptyMap() else query.split("&").associate {
            val kv = it.split("=", limit = 2)
            kv[0] to URLDecoder.decode(kv.getOrElse(1) { "" }, "UTF-8")
        }

    private fun bodyJson(body: String): JSONObject =
        try { JSONObject(body.ifEmpty { "{}" }) } catch (_: Exception) { throw IllegalArgumentException("请求体不是有效 JSON") }

    private fun err(code: String): JSONObject = JSONObject().put("error", code)

    private fun json(out: OutputStream, status: Int, payload: JSONObject) {
        val bytes = payload.toString().toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 $status OK\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: ${bytes.size}\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Connection: close\r\n\r\n"
        out.write(head.toByteArray(Charsets.UTF_8))
        out.write(bytes)
        out.flush()
    }

    // ---------- API ----------

    private fun api(method: String, path: String, query: String, body: String, out: OutputStream) {
        val params = q(query)
        when {
            path == "/api/hello" && method == "GET" -> json(out, 200, JSONObject()
                .put("app", "口算天天练")
                .put("version", BuildConfig.VERSION_NAME)
                .put("ip", localIp() ?: "")
                .put("port", boundPort)
                .put("questions", store.countQuestions()))

            path == "/api/state" && method == "GET" -> json(out, 200, JSONObject()
                .put("config", store.config())
                .put("banks", store.banks())
                .put("questions", store.countQuestions())
                .put("today", store.todayPractice())
                .put("version", BuildConfig.VERSION_NAME))

            path == "/api/config" && method == "PUT" ->
                json(out, 200, JSONObject().put("config", store.saveConfig(bodyJson(body))))

            path == "/api/practice/round" && method == "POST" -> {
                val input = bodyJson(body)
                val config = store.config()
                val count = input.optInt("count", config.optInt("roundSize", 10)).coerceIn(1, 100)
                // 设备端不传 sourceId 时按家长配置的 practiceSource 出题（generator 或题库 id，源失效则回退生成器）
                val sourceId = input.optString("sourceId", "").ifBlank {
                    val configured = config.optString("practiceSource", "generator")
                    if (configured != "generator" && store.bank(configured) == null) "generator" else configured
                }
                if (sourceId.startsWith("generator:")) {
                    val level = sourceId.substringAfter("generator:").toIntOrNull()
                        ?: throw IllegalArgumentException("档位无效")
                    require(level in 1..4) { "档位无效" }
                    return json(out, 200, JSONObject().put("kind", "generator")
                        .put("sourceId", sourceId)
                        .put("level", level)
                        .put("sourceName", Generator.levelName(level))
                        .put("items", generatorRound(level, count)))
                }
                if (sourceId == "generator") {
                    // 配置来源为生成器：每轮随机选一个启用档位
                    val levels = config.optJSONArray("levels") ?: JSONArray(listOf(1, 2, 3, 4))
                    val level = if (levels.length() > 0) levels.getInt(java.util.concurrent.ThreadLocalRandom.current().nextInt(levels.length())) else 1
                    return json(out, 200, JSONObject().put("kind", "generator")
                        .put("sourceId", "generator:$level")
                        .put("level", level)
                        .put("sourceName", Generator.levelName(level))
                        .put("items", generatorRound(level, count)))
                }
                val bank = store.bank(sourceId) ?: throw IllegalArgumentException("题库不存在")
                require(bank.optBoolean("enabled", true)) { "题库已停用" }
                val level = input.optString("level", "").trim()
                json(out, 200, JSONObject().put("kind", "bank")
                    .put("sourceId", bank.getString("id"))
                    .put("sourceName", bank.optString("name"))
                    .put("items", store.sampleForRound(bank.getString("id"), level, count)))
            }

            path == "/api/practice/finish" && method == "POST" -> {
                val input = bodyJson(body)
                val payload = JSONObject()
                    .put("sourceId", input.optString("sourceId", ""))
                    .put("sourceName", input.optString("sourceName", ""))
                    .put("level", input.optInt("level", 0))
                    .put("total", input.optInt("total", 0).coerceIn(0, 500))
                    .put("correct", input.optInt("correct", 0).coerceIn(0, 500))
                    .put("bestStreak", input.optInt("bestStreak", 0).coerceIn(0, 500))
                    .put("seconds", input.optDouble("seconds", 0.0))
                // ts 可选回填（测试/批量导入用），不允许未来时间
                val now = System.currentTimeMillis()
                var ts = input.optLong("ts", 0)
                if (ts <= 0 || ts > now + 60000) ts = now
                store.logEvent("practice", payload, ts)
                json(out, 200, JSONObject().put("ok", true))
            }

            path == "/api/practice/reset" && method == "POST" ->
                json(out, 200, JSONObject().put("ok", true).put("deleted", store.resetPractice()))

            path == "/api/questions" && method == "GET" -> {
                val limit = params["limit"]?.toIntOrNull() ?: 200
                val offset = params["offset"]?.toIntOrNull() ?: 0
                val (items, total) = store.questions(
                    params["bankId"], params["level"], params["difficulty"]?.toIntOrNull(),
                    params["untagged"] == "1", limit, offset)
                json(out, 200, JSONObject().put("items", items).put("total", total))
            }

            path == "/api/questions/facets" && method == "GET" ->
                json(out, 200, store.facets())

            path == "/api/questions/tag" && method == "POST" -> {
                val input = bodyJson(body)
                val ids = if (input.has("ids")) {
                    val arr = input.getJSONArray("ids")
                    val list = ArrayList<String>(arr.length())
                    for (i in 0 until arr.length()) list.add(arr.getString(i))
                    list
                } else null
                val setLevel = if (input.has("setLevel")) input.optString("setLevel").trim().take(20) else null
                val setDifficulty = if (input.has("setDifficulty")) {
                    val d = input.optInt("setDifficulty", -1)
                    require(d in 1..5) { "难度需要为 1–5 星" }
                    d
                } else null
                val updated = store.updateTags(
                    ids, input.optString("bankId", "").ifEmpty { null },
                    input.optString("level", "").ifEmpty { null }, input.optInt("difficulty", 0).takeIf { it != 0 },
                    input.optBoolean("untagged", false),
                    setLevel, setDifficulty)
                json(out, 200, JSONObject().put("ok", true).put("updated", updated))
            }

            path == "/api/questions" && method == "POST" -> {
                val input = bodyJson(body)
                val items = input.optJSONArray("items") ?: throw IllegalArgumentException("缺少 items 数组")
                val bankId = input.optString("bankId", "manual")
                // Agent 推送时可带 bankName 命名新题库（bankId 已存在则忽略）
                val bankName = input.optString("bankName").ifBlank { "Agent 题库" }
                ensureBankRow(bankId, bankName, "file")
                val (added, skipped) = store.upsertIntoBank(bankId, items)
                json(out, 200, JSONObject().put("ok", true).put("added", added).put("skipped", skipped))
            }

            path == "/api/questions/delete" && method == "POST" -> {
                val input = bodyJson(body)
                val deleted = if (input.has("ids")) {
                    val ids = input.getJSONArray("ids")
                    require(ids.length() in 1..5000) { "请选择要删除的题目" }
                    val list = ArrayList<String>(ids.length())
                    for (i in 0 until ids.length()) list.add(ids.getString(i))
                    store.deleteQuestions(list)
                } else if (input.has("bankId")) {
                    val bankId = input.getString("bankId")
                    store.deleteBankQuestions(bankId)
                } else throw IllegalArgumentException("需要 ids 或 bankId")
                json(out, 200, JSONObject().put("ok", true).put("deleted", deleted))
            }

            path == "/api/banks" && method == "GET" ->
                json(out, 200, JSONObject().put("items", store.banks()))

            path == "/api/banks" && method == "POST" -> createBank(bodyJson(body), out)

            path == "/api/banks/sync" && method == "POST" -> {
                val input = bodyJson(body)
                val id = input.optString("id", "")
                try {
                    json(out, 200, BankSync.sync(store, id))
                } catch (e: IllegalArgumentException) {
                    json(out, 200, err("sync_failed").put("message", e.message ?: "同步失败"))
                }
            }

            path == "/api/banks/delete" && method == "POST" -> {
                val input = bodyJson(body)
                val id = input.optString("id", "")
                val deleted = store.deleteBank(id)
                json(out, 200, JSONObject().put("ok", true).put("deletedQuestions", deleted))
            }

            path == "/api/stats" && method == "GET" -> {
                val days = params["days"]?.toIntOrNull() ?: 7
                json(out, 200, store.practiceStats(days))
            }

            else -> json(out, 404, err("not_found").put("message", "$method $path 不存在"))
        }
    }

    /** 新建/更新题库源。url 源与 device 源按 url/host 生成稳定 id，重复添加即更新 */
    private fun createBank(input: JSONObject, out: OutputStream) {
        val kind = input.optString("kind", "")
        when (kind) {
            "url" -> {
                val url = input.optString("url").trim()
                require(url.startsWith("http://") || url.startsWith("https://")) { "URL 无效：$url" }
                // optString 的默认值在字段存在但为空串时不生效，必须显式 ifBlank
                val name = input.optString("name").ifBlank { url.substringAfterLast('/').ifEmpty { "URL 题库" } }
                val id = "url_" + shortHash(url)
                val merged = JSONObject()
                    .put("id", id).put("kind", "url")
                    .put("name", name)
                    .put("url", url)
                    .put("enabled", input.optBoolean("enabled", true))
                store.bank(id)?.let { existing ->
                    merged.put("lastSync", existing.optLong("lastSync"))
                    merged.put("lastError", existing.optString("lastError"))
                }
                store.saveBank(merged)
                json(out, 200, JSONObject().put("ok", true).put("id", id))
            }
            "device" -> {
                val host = input.optString("host").trim()
                require(host.matches(Regex("^[\\w.\\-]+:\\d+$"))) { "设备地址格式：IP:端口，如 192.168.0.103:8099" }
                val passphrase = input.optString("passphrase", "")
                val name = input.optString("name").ifBlank { "StudyOnTV 设备" }
                val id = "device_" + shortHash(host)
                val merged = JSONObject()
                    .put("id", id).put("kind", "device")
                    .put("name", name)
                    .put("host", host)
                    .put("enabled", input.optBoolean("enabled", true))
                if (passphrase.isNotEmpty()) merged.put("secret", passphrase)
                    else store.bankSecret(id).takeIf { it.isNotEmpty() }?.let { merged.put("secret", it) }
                store.bank(id)?.let { merged.put("lastSync", it.optLong("lastSync")) }
                store.saveBank(merged)
                json(out, 200, JSONObject().put("ok", true).put("id", id))
            }
            "file" -> {
                val items = input.optJSONArray("items") ?: throw IllegalArgumentException("缺少 items 数组")
                val name = input.optString("name").ifBlank { "导入题库" }
                val id = "file_" + System.currentTimeMillis()
                // 先导入成功再登记 bank 行，导入失败不残留空题库
                val (added, skipped) = store.replaceBank(id, items)
                store.saveBank(JSONObject()
                    .put("id", id).put("kind", "file").put("name", name))
                store.noteBankSync(id, added, if (skipped > 0) "跳过 $skipped 道不支持的题目" else null)
                json(out, 200, JSONObject().put("ok", true).put("id", id)
                    .put("added", added).put("skipped", skipped))
            }
            else -> throw IllegalArgumentException("kind 需要 url / device / file")
        }
    }

    /** 确保目标 bank 行存在（手动追加题目前调用） */
    private fun ensureBankRow(id: String, name: String, kind: String) {
        if (store.bank(id) == null) {
            store.saveBank(JSONObject().put("id", id).put("name", name).put("kind", kind))
        }
    }

    private fun generatorRound(level: Int, count: Int): JSONArray {
        val out = JSONArray()
        val seen = HashSet<String>()
        var attempts = 0
        while (out.length() < count && attempts < count * 20) {
            attempts++
            val question = Generator.makeQuestion(level) ?: continue
            if (!seen.add(question.text)) continue
            out.put(JSONObject()
                .put("id", "gen_" + java.util.UUID.randomUUID().toString())
                .put("type", "single")
                .put("q", question.text)
                .put("a", JSONArray(question.options.map { it.toString() }))
                .put("k", question.options.indexOf(question.answer))
                .put("difficulty", Generator.levelDifficulty(level))
                .put("tip", question.text.replace(" = ?", " = ${question.answer}"))
                .put("subject", "口算")
                .put("level", Generator.levelName(level))
                .put("bankId", "generator"))
        }
        return out
    }

    private fun shortHash(value: String): String =
        java.security.MessageDigest.getInstance("SHA-1").digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { String.format("%02x", it) }.take(10)

    // ---------- 静态文件 ----------

    private fun static(path: String, out: OutputStream) {
        val assets: AssetManager = context.assets
        // /admin 前缀走家长管理页（对齐 StudyOnTV：设备端只答题，题库管理在网页）
        val clean = path.removePrefix("/").replace("..", "")
        val isAdmin = clean == "admin" || clean == "admin/" || clean.startsWith("admin/")
        val assetPath = when {
            clean.isEmpty() -> "web/index.html"
            clean == "admin" || clean == "admin/" -> "web/admin.html"
            clean.startsWith("admin/") -> "web/" + clean.removePrefix("admin/")
            else -> "web/$clean"
        }
        val ext = assetPath.substringAfterLast('.', "")
        val isFile = ext.isNotEmpty() && assetPath.contains('/')
        val fallback = if (isAdmin) "web/admin.html" else "web/index.html"
        val target = try {
            assets.open(if (isFile) assetPath else fallback)
        } catch (_: Exception) {
            try { assets.open(fallback) } catch (_: Exception) {
                write(out, 200, "text/html; charset=utf-8", "<h1>口算天天练</h1><p>前端资源缺失</p>".toByteArray(Charsets.UTF_8))
                return
            }
        }
        target.use { stream ->
            val bytes = stream.readBytes()
            write(out, 200, MIME[ext] ?: "application/octet-stream", bytes)
        }
    }

    private fun write(out: OutputStream, status: Int, mime: String, bytes: ByteArray) {
        val head = "HTTP/1.1 $status OK\r\n" +
            "Content-Type: $mime\r\n" +
            "Content-Length: ${bytes.size}\r\n" +
            "Cache-Control: no-cache\r\n" +
            "Connection: close\r\n\r\n"
        out.write(head.toByteArray(Charsets.UTF_8))
        out.write(bytes)
        out.flush()
    }
}
