package com.kousuan.mental

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * 题库导入器：纯 JVM 实现（仅依赖 org.json），负责解析、紧凑格式展开与校验，可在单元测试中直接运行。
 *
 * 支持两种题目格式：
 * 1. StudyOnTV 标准格式：{type, q, a:[选项], k(单选下标)|correctIndices(多选), difficulty, tip, subject, level, id}
 *    ——与 StudyOnTV 的题库 JSON、/api/questions 导出完全兼容。
 * 2. 口算紧凑格式：{e:"12+7", a:19}（或 {expr:"42÷6"}）——服务端自动展开为 4 选 1 单选题。
 *
 * 题库文件本身接受裸数组 [...] 或 {version:2, items:[...]} 包装。
 */
object BankImporter {

    val TYPES = listOf("single", "multiple", "boolean")

    /** 解析题库文本（裸数组或 {version, items}），返回题目数组 */
    fun parseBank(text: String): JSONArray {
        val clean = text.trim().removePrefix("\uFEFF")
        val root = try { JSONObject(clean) } catch (_: Exception) { null }
        if (root != null) {
            val items = root.optJSONArray("items") ?: throw IllegalArgumentException("题库 JSON 缺少 items 数组")
            require(items.length() in 1..5000) { "每次导入 1–5000 道题，收到 ${items.length()} 道" }
            return items
        }
        val array = try { JSONArray(clean) } catch (_: Exception) { null }
            ?: throw IllegalArgumentException("无法解析题库 JSON：需要 [...] 数组或 {\"items\":[...]} 包装")
        require(array.length() in 1..5000) { "每次导入 1–5000 道题，收到 ${array.length()} 道" }
        return array
    }

    /**
     * 校验并规范化一道题。失败抛 IllegalArgumentException（中文错误信息，可直接展示）。
     * 返回规范化副本：补齐 type/difficulty/k/correctIndices 等字段。
     * 兼容 StudyOnTV 老字段名：stem→q、options→a、answerIndex→k。
     */
    fun validate(input: JSONObject): JSONObject {
        val item = expandCompact(applyLegacyAliases(input))
        val stem = item.optString("q").trim()
        require(stem.isNotEmpty()) { "请填写题干" }
        require(stem.length <= 5000) { "题干过长（最多 5000 字）" }
        val type = item.optString("type", "single")
        require(type in TYPES) { "不支持的题型：$type（支持 single / multiple / boolean）" }
        val options = if (type == "boolean") JSONArray(listOf("正确", "错误")) else item.optJSONArray("a") ?: JSONArray()
        require(options.length() in 2..8) { "需要 2–8 个选项" }
        for (i in 0 until options.length()) require(options.getString(i).isNotBlank()) { "选项不能为空" }
        val indices = when (type) {
            "multiple" -> item.optJSONArray("correctIndices") ?: JSONArray()
            else -> JSONArray().put(item.optInt("k", -1))
        }
        require(indices.length() > 0) { "请选择正确答案" }
        for (i in 0 until indices.length()) {
            require(indices.getInt(i) in 0 until options.length()) { "答案序号超出选项范围" }
        }
        val difficulty = item.optInt("difficulty", 2)
        require(difficulty in 1..5) { "难度需要为 1–5 星" }
        val out = JSONObject()
        out.put("type", type)
        out.put("q", stem)
        out.put("a", options)
        if (type == "multiple") out.put("correctIndices", indices) else out.put("k", indices.getInt(0))
        out.put("difficulty", difficulty)
        if (item.has("tip")) out.put("tip", item.optString("tip"))
        if (item.has("subject")) out.put("subject", item.optString("subject"))
        if (item.has("level")) out.put("level", item.optString("level"))
        if (item.has("id")) out.put("id", item.optString("id"))
        return out
    }

    /** 老格式字段名映射：stem→q、options→a、answerIndex→k（不覆盖已有新字段） */
    fun applyLegacyAliases(input: JSONObject): JSONObject {
        if (!input.has("stem") && !input.has("options") && !input.has("answerIndex")) return input
        val out = JSONObject(input.toString())
        if (!out.has("q") && out.has("stem")) out.put("q", out.optString("stem"))
        if (!out.has("a") && out.has("options")) out.put("a", out.optJSONArray("options") ?: JSONArray())
        if (!out.has("k") && out.has("answerIndex")) out.put("k", out.optInt("answerIndex", -1))
        return out
    }

    /** 紧凑口算格式 {e:"12+7", a:19} → 标准单选题；已有 q 字段的题目原样返回。
     *  可选标签（level 年级 / difficulty 星级 / subject / tip）会透传到展开后的题目上。 */
    fun expandCompact(input: JSONObject): JSONObject {
        if (input.has("q")) return input
        val expr = input.optString("e", input.optString("expr")).trim()
        if (expr.isEmpty()) throw IllegalArgumentException("题目缺少 q 题干或 e 算式")
        val answer = intAnswer(input, "a") ?: intAnswer(input, "answer")
            ?: throw IllegalArgumentException("算式 $expr 缺少数值答案 a")
        val parsed = parseExpression(expr)
        require(parsed.second == answer) { "算式 $expr 的结果应为 ${parsed.second}，与给出的答案 $answer 不一致" }
        val out = buildSingle(parsed.first, answer)
        for (key in listOf("level", "difficulty", "subject", "tip")) {
            if (input.has(key) && input.opt(key) != null) out.put(key, input.opt(key))
        }
        return out
    }

    private fun intAnswer(input: JSONObject, key: String): Int? {
        val value = input.opt(key) ?: return null
        return when (value) {
            is Number -> value.toInt()
            is String -> value.trim().toIntOrNull()
            else -> null
        }
    }

    /** 解析算式，返回 (规范题干, 计算结果)。v1 支持两个操作数的四则运算。 */
    fun parseExpression(raw: String): Pair<String, Int> {
        var s = raw.trim()
        s = s.removeSuffix("?").trim()
        s = s.removeSuffix("=").trim()
        if (s.isEmpty()) throw IllegalArgumentException("算式为空")
        // 找运算符（+ − × ÷ 及 ASCII 等价）
        val ops = listOf('＋', '−', '－', '×', '✕', '÷', '－')
        var opIndex = -1
        var opChar = ' '
        for (i in 1 until s.length) { // 首字符允许是负号
            val c = s[i]
            if (c in ops || c == '+' || c == '*' || c == '/' || c == 'x' || c == 'X') {
                opIndex = i; opChar = c; break
            }
        }
        require(opIndex > 0) { "无法识别算式 \"$raw\"：v1 支持两个操作数的 + − × ÷" }
        val left = s.substring(0, opIndex).trim()
        val right = s.substring(opIndex + 1).trim().trimEnd('=', '?').trim()
        val a = left.toIntOrNull() ?: throw IllegalArgumentException("算式 \"$raw\" 的操作数不是整数")
        val b = right.toIntOrNull() ?: throw IllegalArgumentException("算式 \"$raw\" 的操作数不是整数")
        val normOp = when (opChar) {
            '+', '＋' -> '+'
            '-', '−', '－' -> '−'
            '*', '×', '✕', 'x', 'X' -> '×'
            '/', '÷' -> '÷'
            else -> throw IllegalArgumentException("无法识别算式 \"$raw\" 的运算符")
        }
        val result = when (normOp) {
            '+' -> a + b
            '−' -> a - b
            '×' -> a * b
            else -> {
                require(b != 0) { "算式 \"$raw\" 除数不能为 0" }
                require(a % b == 0) { "算式 \"$raw\" 不能整除，请使用能整除的算式" }
                a / b
            }
        }
        return Pair("$a $normOp $b = ?", result)
    }

    /** 数值答案 → 4 选 1 标准单选题（复用生成器的干扰项算法） */
    fun buildSingle(text: String, answer: Int, tip: String = "", subject: String = "口算", level: String = ""): JSONObject {
        val options = Generator.makeOptions(answer).map { it.toString() }
        val k = options.indexOf(answer.toString())
        val item = JSONObject()
            .put("type", "single")
            .put("q", text)
            .put("a", JSONArray(options))
            .put("k", k)
            .put("difficulty", 2)
            .put("subject", subject)
        if (level.isNotEmpty()) item.put("level", level)
        if (tip.isNotEmpty()) item.put("tip", tip)
        return item
    }

    /** 生成导入用的缺省 id（跨库冲突时由 LocalStore 负责换新） */
    fun newId(): String = "q_" + UUID.randomUUID().toString()
}
