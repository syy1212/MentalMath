package com.kousuan.mental

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * 本地持久层（SQLite）。schema 设计沿用 StudyOnTV 的思路：
 * questions 列只存最小过滤集（bank_id/subject/level），题目完整 JSON 存 details 列，读时从 details 重建。
 * 每个导入源一个 bank（内置生成 / 文件 / URL / 设备），同步更新按 bank 整库替换。
 */
class LocalStore(context: Context) : SQLiteOpenHelper(context, "mentalmath.db", null, 3) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE questions(id TEXT PRIMARY KEY, bank_id TEXT NOT NULL DEFAULT 'built-in', type TEXT NOT NULL DEFAULT 'single', subject TEXT, level TEXT, difficulty INTEGER, stem TEXT NOT NULL, options TEXT NOT NULL, answer TEXT NOT NULL, tip TEXT, enabled INTEGER DEFAULT 1, created_at INTEGER, details TEXT)")
        db.execSQL("CREATE INDEX idx_questions_bank ON questions(bank_id)")
        db.execSQL("CREATE TABLE banks(id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, url TEXT, host TEXT, secret TEXT, last_sync INTEGER DEFAULT 0, item_count INTEGER DEFAULT 0, last_error TEXT, enabled INTEGER DEFAULT 1, created_at INTEGER)")
        db.execSQL("CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, payload TEXT, ts INTEGER)")
        db.execSQL("CREATE INDEX idx_events_ts ON events(ts)")
        db.execSQL("CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // v3：内置题库的 level 原来存的是档位名（如「20 以内加减」），不是年级标签——列与 details JSON 一起清空
        if (oldVersion < 3) {
            val rows = mutableListOf<Pair<String, String>>()
            db.rawQuery("SELECT id, details FROM questions WHERE bank_id='built-in'", null).use { c ->
                while (c.moveToNext()) rows.add(c.getString(0) to (c.getString(1) ?: "{}"))
            }
            for ((id, raw) in rows) {
                val details = try { org.json.JSONObject(raw) } catch (_: Exception) { org.json.JSONObject() }
                details.put("level", "")
                db.execSQL("UPDATE questions SET level='', details=? WHERE id=?",
                    arrayOf(details.toString(), id))
            }
        }
    }

    // ---------- kv / 配置 ----------

    fun get(key: String, default: String = ""): String =
        readableDatabase.rawQuery("SELECT v FROM kv WHERE k=?", arrayOf(key)).use {
            if (it.moveToFirst()) (it.getString(0) ?: default) else default
        }

    private fun set(key: String, value: String) {
        writableDatabase.insertWithOnConflict("kv", null, ContentValues().apply {
            put("k", key); put("v", value)
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun config(): JSONObject {
        val stored = try { JSONObject(get("config", "{}")) } catch (_: Exception) { JSONObject() }
        val levels = stored.optJSONArray("levels") ?: JSONArray(listOf(1, 2, 3, 4))
        return JSONObject()
            .put("roundSize", stored.optInt("roundSize", 10).coerceIn(5, 50))
            .put("levels", levels)
            .put("autoSyncHours", stored.optInt("autoSyncHours", 24).coerceIn(1, 168))
            .put("theme", stored.optString("theme", "system"))
            // 设备端「开始练习」的出题来源：generator = 内置出题器，或某个题库源 id。家长在网页管理端配置
            .put("practiceSource", stored.optString("practiceSource", "generator"))
            // Agent 推题未写年级时自动补的默认年级（空 = 不自动补）。保证全部题都有年级标签
            .put("defaultLevel", stored.optString("defaultLevel", "二年级"))
    }

    fun saveConfig(patch: JSONObject): JSONObject {
        val merged = JSONObject(config().toString())
        for (key in patch.keys()) merged.put(key, patch.get(key))
        val clean = config().apply {
            put("roundSize", merged.optInt("roundSize", 10).coerceIn(5, 50))
            put("levels", merged.optJSONArray("levels") ?: JSONArray(listOf(1, 2, 3, 4)))
            put("autoSyncHours", merged.optInt("autoSyncHours", 24).coerceIn(1, 168))
            put("theme", merged.optString("theme", "system"))
            put("practiceSource", merged.optString("practiceSource", "generator"))
            put("defaultLevel", merged.optString("defaultLevel", "二年级").take(20))
        }
        set("config", clean.toString())
        return clean
    }

    // ---------- 题目 ----------

    /** 读取题目：优先从 details 重建完整 JSON，补充 bankId */
    private fun rowToItem(c: android.database.Cursor): JSONObject {
        val details = c.getString(c.getColumnIndexOrThrow("details"))
        val item = if (details.isNullOrEmpty()) JSONObject() else JSONObject(details)
        item.put("id", c.getString(c.getColumnIndexOrThrow("id")))
        if (!item.has("q")) item.put("q", c.getString(c.getColumnIndexOrThrow("stem")))
        if (!item.has("a")) item.put("a", JSONArray(c.getString(c.getColumnIndexOrThrow("options"))))
        item.put("bankId", c.getString(c.getColumnIndexOrThrow("bank_id")))
        return item
    }

    /** 题目列表：bankId / level 年级 / difficulty 星级 / untagged 仅未设年级 可组合筛选 */
    fun questions(bankId: String?, level: String?, difficulty: Int?, untagged: Boolean, limit: Int, offset: Int): Pair<JSONArray, Int> {
        val where = StringBuilder("WHERE 1=1")
        val args = mutableListOf<String>()
        if (!bankId.isNullOrEmpty()) { where.append(" AND bank_id=?"); args.add(bankId) }
        if (untagged) { where.append(" AND level=''") } else if (!level.isNullOrEmpty()) { where.append(" AND level=?"); args.add(level) }
        if (difficulty != null) { where.append(" AND difficulty=?"); args.add(difficulty.toString()) }
        val total = readableDatabase.rawQuery("SELECT COUNT(*) FROM questions $where", args.toTypedArray()).use {
            if (it.moveToFirst()) it.getInt(0) else 0
        }
        val out = JSONArray()
        readableDatabase.rawQuery(
            "SELECT * FROM questions $where ORDER BY created_at DESC, id LIMIT ${limit.coerceIn(1, 5000)} OFFSET ${offset.coerceAtLeast(0)}", args.toTypedArray()
        ).use { c -> while (c.moveToNext()) out.put(rowToItem(c)) }
        return Pair(out, total)
    }

    /** 年级/科目去重列表（打标签的下拉选项用） */
    fun facets(): JSONObject {
        val levels = JSONArray()
        readableDatabase.rawQuery("SELECT DISTINCT level FROM questions WHERE level!='' ORDER BY level LIMIT 50", null).use { c ->
            while (c.moveToNext()) levels.put(c.getString(0))
        }
        val subjects = JSONArray()
        readableDatabase.rawQuery("SELECT DISTINCT subject FROM questions WHERE subject!='' ORDER BY subject LIMIT 50", null).use { c ->
            while (c.moveToNext()) subjects.put(c.getString(0))
        }
        return JSONObject().put("levels", levels).put("subjects", subjects)
    }

    /**
     * 批量打标签：按 ids 或筛选条件（bankId/level/difficulty）选中题目，
     * setLevel（年级，空串=清除）、setDifficulty（1–5 星）至少填一个。返回修改条数。
     */
    fun updateTags(
        ids: List<String>?, bankId: String?, level: String?, difficulty: Int?, untagged: Boolean,
        setLevel: String?, setDifficulty: Int?
    ): Int {
        require(setLevel != null || setDifficulty != null) { "没有要修改的标签" }
        require(!ids.isNullOrEmpty() || !bankId.isNullOrEmpty() || !level.isNullOrEmpty() || difficulty != null || untagged) {
            "需要 ids 或筛选条件（bankId / level / difficulty / untagged）"
        }
        val where = StringBuilder("WHERE 1=1")
        val args = mutableListOf<String>()
        if (!ids.isNullOrEmpty()) {
            require(ids.size in 1..5000) { "每次 1–5000 道" }
            where.append(" AND id IN (${ids.joinToString(",") { "?" }})")
            args.addAll(ids)
        }
        if (!bankId.isNullOrEmpty()) { where.append(" AND bank_id=?"); args.add(bankId) }
        if (untagged) { where.append(" AND level=''") } else if (!level.isNullOrEmpty()) { where.append(" AND level=?"); args.add(level) }
        if (difficulty != null) { where.append(" AND difficulty=?"); args.add(difficulty.toString()) }

        val db = writableDatabase
        var count = 0
        db.beginTransaction()
        try {
            db.rawQuery("SELECT id, details FROM questions $where", args.toTypedArray()).use { c ->
                while (c.moveToNext()) {
                    val id = c.getString(0)
                    val details = try { JSONObject(c.getString(1)) } catch (_: Exception) { JSONObject() }
                    if (setLevel != null) details.put("level", setLevel)
                    if (setDifficulty != null) details.put("difficulty", setDifficulty)
                    val cv = ContentValues().apply {
                        if (setLevel != null) put("level", setLevel)
                        if (setDifficulty != null) put("difficulty", setDifficulty)
                        put("details", details.toString())
                    }
                    count += db.update("questions", cv, "id=?", arrayOf(id))
                }
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        return count
    }

    /** 练习抽题：随机抽取 count 道 */
    fun sampleForRound(bankId: String, level: String?, count: Int): JSONArray {
        val where = StringBuilder("WHERE bank_id=?")
        val args = mutableListOf(bankId)
        if (!level.isNullOrEmpty()) { where.append(" AND level=?"); args.add(level) }
        val out = JSONArray()
        readableDatabase.rawQuery(
            "SELECT * FROM questions ${where}ORDER BY RANDOM() LIMIT ${count.coerceIn(1, 100)}", args.toTypedArray()
        ).use { c -> while (c.moveToNext()) out.put(rowToItem(c)) }
        return out
    }

    fun countQuestions(bankId: String? = null): Int {
        val where = if (bankId.isNullOrEmpty()) "" else "WHERE bank_id=?"
        val args = if (bankId.isNullOrEmpty()) arrayOf<String>() else arrayOf(bankId)
        return readableDatabase.rawQuery("SELECT COUNT(*) FROM questions $where", args).use {
            if (it.moveToFirst()) it.getInt(0) else 0
        }
    }

    /** 单题插入（内部）：校验 + 年级缺省自动补默认年级 + 跨库 id 冲突时换新 id，同库同 id 即修改 */
    private fun insertQuestion(db: SQLiteDatabase, bankId: String, raw: JSONObject): Int {
        val item = BankImporter.validate(raw)
        if (item.optString("level").isEmpty()) {
            val fallback = config().optString("defaultLevel", "")
            if (fallback.isNotEmpty()) item.put("level", fallback)
        }
        val requested = item.optString("id")
        val id = if (requested.isNotEmpty()) {
            val owner = db.rawQuery("SELECT bank_id FROM questions WHERE id=?", arrayOf(requested)).use {
                if (it.moveToFirst()) it.getString(0) else null
            }
            if (owner == null || owner == bankId) requested else BankImporter.newId()
        } else BankImporter.newId()
        item.put("id", id)
        val type = item.getString("type")
        val indices = JSONArray()
        if (type == "multiple") {
            val ci = item.getJSONArray("correctIndices")
            for (i in 0 until ci.length()) indices.put(ci.getInt(i))
        } else indices.put(item.getInt("k"))
        db.insertWithOnConflict("questions", null, ContentValues().apply {
            put("id", id); put("bank_id", bankId); put("type", type)
            put("subject", item.optString("subject")); put("level", item.optString("level"))
            put("difficulty", item.optInt("difficulty", 2))
            put("stem", item.getString("q")); put("options", item.getJSONArray("a").toString())
            put("answer", indices.toString()); put("tip", item.optString("tip")); put("enabled", 1)
            put("created_at", System.currentTimeMillis()); put("details", item.toString())
        }, SQLiteDatabase.CONFLICT_REPLACE)
        return 1
    }

    /**
     * 整库替换：一事务内先删该 bank 全部题目再插入。单题校验失败只跳过不中断，
     * 全部失败则抛异常回滚（保证 bank 至少与源一致或不变）。
     * 返回 (added, skipped)。
     */
    fun replaceBank(bankId: String, items: JSONArray): Pair<Int, Int> {
        require(items.length() in 1..5000) { "每次导入 1–5000 道题，收到 ${items.length()} 道" }
        val db = writableDatabase
        var added = 0
        var skipped = 0
        db.beginTransaction()
        try {
            db.delete("questions", "bank_id=?", arrayOf(bankId))
            for (i in 0 until items.length()) {
                added += try { insertQuestion(db, bankId, items.getJSONObject(i)) } catch (_: Exception) { skipped++; 0 }
            }
            require(added > 0) { "题库中没有可导入的题目（共 ${items.length()} 道，跳过 $skipped 道）" }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        return Pair(added, skipped)
    }

    /** 追加/更新导入：不删除已有题目，同 id 同库即修改 */
    fun upsertIntoBank(bankId: String, items: JSONArray): Pair<Int, Int> {
        require(items.length() in 1..5000) { "每次导入 1–5000 道题，收到 ${items.length()} 道" }
        val db = writableDatabase
        var added = 0
        var skipped = 0
        db.beginTransaction()
        try {
            for (i in 0 until items.length()) {
                added += try { insertQuestion(db, bankId, items.getJSONObject(i)) } catch (_: Exception) { skipped++; 0 }
            }
            require(added > 0) { "没有可导入的题目（共 ${items.length()} 道，跳过 $skipped 道）" }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        return Pair(added, skipped)
    }

    fun deleteQuestions(ids: List<String>): Int {
        val db = writableDatabase
        var count = 0
        db.beginTransaction()
        try {
            ids.forEach { count += db.delete("questions", "id=?", arrayOf(it)) }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        return count
    }

    fun deleteBankQuestions(bankId: String): Int = writableDatabase.delete("questions", "bank_id=?", arrayOf(bankId))

    // ---------- 题库源 ----------

    private fun bankRow(c: android.database.Cursor): JSONObject = JSONObject()
        .put("id", c.getString(c.getColumnIndexOrThrow("id")))
        .put("name", c.getString(c.getColumnIndexOrThrow("name")))
        .put("kind", c.getString(c.getColumnIndexOrThrow("kind")))
        .put("url", c.getString(c.getColumnIndexOrThrow("url")) ?: "")
        .put("host", c.getString(c.getColumnIndexOrThrow("host")) ?: "")
        .put("hasSecret", !c.getString(c.getColumnIndexOrThrow("secret")).isNullOrEmpty())
        .put("lastSync", c.getLong(c.getColumnIndexOrThrow("last_sync")))
        .put("itemCount", c.getInt(c.getColumnIndexOrThrow("item_count")))
        .put("lastError", c.getString(c.getColumnIndexOrThrow("last_error")) ?: "")
        .put("enabled", c.getInt(c.getColumnIndexOrThrow("enabled")) == 1)

    fun banks(): JSONArray {
        val out = JSONArray()
        readableDatabase.rawQuery("SELECT * FROM banks ORDER BY created_at ASC", null).use { c ->
            while (c.moveToNext()) {
                val row = bankRow(c)
                row.put("itemCount", countQuestions(row.getString("id")))
                out.put(row)
            }
        }
        return out
    }

    fun bank(id: String): JSONObject? = readableDatabase.rawQuery("SELECT * FROM banks WHERE id=?", arrayOf(id)).use {
        if (it.moveToFirst()) bankRow(it).put("itemCount", countQuestions(id)) else null
    }

    fun saveBank(bank: JSONObject) {
        writableDatabase.insertWithOnConflict("banks", null, ContentValues().apply {
            put("id", bank.getString("id")); put("name", bank.optString("name", "题库"))
            put("kind", bank.optString("kind", "file"))
            put("url", bank.optString("url")); put("host", bank.optString("host"))
            put("secret", bank.optString("secret"))
            put("last_sync", bank.optLong("lastSync", 0))
            put("item_count", bank.optInt("itemCount", 0))
            put("last_error", bank.optString("lastError", ""))
            put("enabled", if (bank.optBoolean("enabled", true)) 1 else 0)
            put("created_at", bank.optLong("createdAt", System.currentTimeMillis()))
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun noteBankSync(id: String, count: Int, error: String?) {
        writableDatabase.update("banks", ContentValues().apply {
            put("last_sync", System.currentTimeMillis()); put("item_count", count)
            put("last_error", error ?: "")
        }, "id=?", arrayOf(id))
    }

    /** 删除题库源及其全部题目；返回删除的题目数。内置题库不允许删。 */
    fun deleteBank(id: String): Int {
        require(id != Generator.BUILT_IN) { "内置题库不能删除" }
        val count = deleteBankQuestions(id)
        writableDatabase.delete("banks", "id=?", arrayOf(id))
        return count
    }

    fun bankSecret(id: String): String =
        readableDatabase.rawQuery("SELECT secret FROM banks WHERE id=?", arrayOf(id)).use {
            if (it.moveToFirst()) (it.getString(0) ?: "") else ""
        }

    // ---------- 练习记录 ----------

    fun logEvent(type: String, payload: JSONObject, ts: Long = System.currentTimeMillis()) {
        writableDatabase.execSQL("INSERT INTO events(type,payload,ts) VALUES(?,?,?)",
            arrayOf(type, payload.toString(), ts))
    }

    private fun startOfDay(offsetDays: Int): Long {
        val cal = Calendar.getInstance()
        cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0)
        cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0)
        cal.add(Calendar.DAY_OF_YEAR, -offsetDays)
        return cal.timeInMillis
    }

    /**
     * 近 N 天刷题统计与简单分析：
     * days 按天聚合（含每题均时），bySource 按来源聚合，recent 最近练习，
     * prev 上一个同长周期对比，dayStreak 连续练习天数。
     */
    fun practiceStats(days: Int): JSONObject {
        val n = days.coerceIn(1, 90)
        val start = startOfDay(n - 1)
        val endEx = startOfDay(-1) // 明天 0 点，覆盖今天全天

        class Day(var rounds: Int = 0, var answered: Int = 0, var correct: Int = 0, var seconds: Double = 0.0)
        val dayList = ArrayList<Day>(n)
        for (i in 0 until n) dayList.add(Day())
        val bySource = LinkedHashMap<String, JSONObject>()
        val recentAll = ArrayList<JSONObject>()
        var answered = 0; var correct = 0; var rounds = 0; var seconds = 0.0

        readableDatabase.rawQuery(
            "SELECT payload, ts FROM events WHERE type='practice' AND ts>=? AND ts<?",
            arrayOf(start.toString(), endEx.toString())
        ).use { c ->
            while (c.moveToNext()) {
                val p = try { JSONObject(c.getString(0)) } catch (_: Exception) { JSONObject() }
                val ts = c.getLong(1)
                val total = p.optInt("total", 0)
                val hit = p.optInt("correct", 0)
                val sec = p.optDouble("seconds", 0.0)
                val dayIndex = ((ts - start) / 86400000L).toInt().coerceIn(0, n - 1)
                val d = dayList[dayIndex]
                d.rounds++; d.answered += total; d.correct += hit; d.seconds += sec
                answered += total; correct += hit; rounds++; seconds += sec
                val sid = p.optString("sourceId", "").ifEmpty { "unknown" }
                val s = bySource.getOrPut(sid) {
                    JSONObject().put("name", p.optString("sourceName", sid))
                        .put("rounds", 0).put("answered", 0).put("correct", 0)
                        .put("seconds", 0.0).put("bestStreak", 0)
                }
                s.put("rounds", s.optInt("rounds") + 1)
                s.put("answered", s.optInt("answered") + total)
                s.put("correct", s.optInt("correct") + hit)
                s.put("seconds", s.optDouble("seconds") + sec)
                if (p.optInt("bestStreak", 0) > s.optInt("bestStreak", 0)) s.put("bestStreak", p.optInt("bestStreak", 0))
                recentAll.add(JSONObject()
                    .put("ts", ts).put("name", p.optString("sourceName", ""))
                    .put("total", total).put("correct", hit).put("seconds", sec)
                    .put("bestStreak", p.optInt("bestStreak", 0)))
            }
        }

        val daysOut = JSONArray()
        for ((idx, d) in dayList.withIndex()) {
            val cal = Calendar.getInstance(); cal.timeInMillis = startOfDay(n - 1 - idx)
            val label = when (val off = n - 1 - idx) {
                0 -> "今天"; 1 -> "昨天"
                else -> "${cal.get(Calendar.MONTH) + 1}/${cal.get(Calendar.DAY_OF_MONTH)}"
            }
            daysOut.put(JSONObject()
                .put("label", label)
                .put("rounds", d.rounds).put("answered", d.answered).put("correct", d.correct)
                .put("seconds", Math.round(d.seconds * 10) / 10.0)
                .put("accuracy", if (d.answered > 0) d.correct * 100 / d.answered else 0)
                .put("perQ", if (d.answered > 0) Math.round(d.seconds / d.answered * 10) / 10.0 else 0.0))
        }

        val sources = JSONArray()
        bySource.values
            .sortedByDescending { it.optInt("answered") }
            .forEach { s ->
                val a = s.optInt("answered")
                s.put("accuracy", if (a > 0) s.optInt("correct") * 100 / a else 0)
                s.put("perQ", if (a > 0) Math.round(s.optDouble("seconds") / a * 10) / 10.0 else 0.0)
                sources.put(s)
            }

        val recent = JSONArray()
        recentAll.sortedByDescending { it.optLong("ts") }.take(12).forEach { row ->
            val total = row.optInt("total")
            row.put("accuracy", if (total > 0) row.optInt("correct") * 100 / total else 0)
                .put("perQ", if (total > 0) Math.round(row.optDouble("seconds") / total * 10) / 10.0 else 0.0)
            recent.put(row)
        }

        // 上一个同长周期对比
        var prevAnswered = 0; var prevCorrect = 0; var prevSeconds = 0.0
        readableDatabase.rawQuery(
            "SELECT payload FROM events WHERE type='practice' AND ts>=? AND ts<?",
            arrayOf((start - n * 86400000L).toString(), start.toString())
        ).use { c ->
            while (c.moveToNext()) {
                val p = try { JSONObject(c.getString(0)) } catch (_: Exception) { JSONObject() }
                prevAnswered += p.optInt("total", 0); prevCorrect += p.optInt("correct", 0)
                prevSeconds += p.optDouble("seconds", 0.0)
            }
        }
        val prev = if (prevAnswered > 0) JSONObject()
            .put("answered", prevAnswered)
            .put("accuracy", prevCorrect * 100 / prevAnswered)
            .put("perQ", Math.round(prevSeconds / prevAnswered * 10) / 10.0)
        else JSONObject().put("answered", 0)

        // 连续练习天数（今天没练则从昨天往前数）
        val tz = java.util.TimeZone.getDefault().getOffset(System.currentTimeMillis()).toLong()
        val counts = HashMap<Long, Int>()
        readableDatabase.rawQuery(
            "SELECT ts FROM events WHERE type='practice' AND ts>=?",
            arrayOf((System.currentTimeMillis() - 400L * 86400000L).toString())
        ).use { c ->
            while (c.moveToNext()) {
                val day = (c.getLong(0) + tz) / 86400000L
                counts[day] = (counts[day] ?: 0) + 1
            }
        }
        var streak = 0
        var cursor = (System.currentTimeMillis() + tz) / 86400000L
        if ((counts[cursor] ?: 0) == 0) cursor--
        while (streak < 365 && (counts[cursor] ?: 0) > 0) { streak++; cursor-- }

        return JSONObject()
            .put("days", daysOut)
            .put("totals", JSONObject()
                .put("rounds", rounds).put("answered", answered).put("correct", correct)
                .put("seconds", Math.round(seconds * 10) / 10.0)
                .put("accuracy", if (answered > 0) correct * 100 / answered else 0)
                .put("perQ", if (answered > 0) Math.round(seconds / answered * 10) / 10.0 else 0.0))
            .put("bySource", sources)
            .put("recent", recent)
            .put("prev", prev)
            .put("dayStreak", streak)
    }

    /** 清空全部练习记录（管理端/测试用） */
    fun resetPractice(): Int = writableDatabase.delete("events", "type='practice'", null)

    fun todayPractice(): JSONObject {
        val start = startOfDay(0)
        var answered = 0; var correct = 0; var rounds = 0
        readableDatabase.rawQuery("SELECT payload FROM events WHERE type='practice' AND ts>=?", arrayOf(start.toString())).use { c ->
            while (c.moveToNext()) {
                val p = try { JSONObject(c.getString(0)) } catch (_: Exception) { JSONObject() }
                rounds++; answered += p.optInt("total", 0); correct += p.optInt("correct", 0)
            }
        }
        return JSONObject().put("rounds", rounds).put("answered", answered).put("correct", correct)
            .put("accuracy", if (answered > 0) correct * 100 / answered else 0)
    }
}
