package com.kousuan.mental

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** 题库导入器：格式解析、紧凑格式展开、校验规则 */
class BankImporterTest {

    private fun item(json: String) = JSONObject(json)

    // ---------- parseBank ----------

    @Test
    fun `parses bare array and wrapped object`() {
        val bare = BankImporter.parseBank("""[{"q":"1 + 1 = ?","a":["1","2"],"k":1}]""")
        assertEquals(1, bare.length())
        val wrapped = BankImporter.parseBank("""{"version":2,"items":[{"q":"1 + 1 = ?","a":["1","2"],"k":1},{"q":"2 + 2 = ?","a":["3","4"],"k":1}]}""")
        assertEquals(2, wrapped.length())
    }

    @Test
    fun `parseBank rejects invalid json and oversize`() {
        try { BankImporter.parseBank("不是 JSON"); fail("应拒绝无效 JSON") } catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("无法解析")) }
        try { BankImporter.parseBank("[]"); fail("应拒绝空数组") } catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("1–5000")) }
    }

    // ---------- 紧凑口算格式 ----------

    @Test
    fun `expands compact expression with plus`() {
        val out = BankImporter.validate(item("""{"e":"12+7","a":19}"""))
        assertEquals("single", out.getString("type"))
        assertEquals("12 + 7 = ?", out.getString("q"))
        assertEquals(4, out.getJSONArray("a").length())
        assertEquals("19", out.getJSONArray("a").getString(out.getInt("k")))
        assertEquals(19, out.getJSONArray("a").getInt(out.getInt("k")))
    }

    @Test
    fun `expands compact minus multiply divide with unicode ops`() {
        val minus = BankImporter.validate(item("""{"e":"15−8","a":7}"""))
        assertEquals("15 − 8 = ?", minus.getString("q"))
        val times = BankImporter.validate(item("""{"e":"6x7","answer":42}"""))
        assertEquals("6 × 7 = ?", times.getString("q"))
        val divide = BankImporter.validate(item("""{"e":"42÷6","a":"7"}"""))
        assertEquals("42 ÷ 6 = ?", divide.getString("q"))
    }

    @Test
    fun `compact accepts trailing equals and question mark`() {
        val out = BankImporter.validate(item("""{"e":"8 + 5 = ?","a":13}"""))
        assertEquals("8 + 5 = ?", out.getString("q"))
    }

    @Test
    fun `compact rejects wrong answer and bad ops`() {
        try { BankImporter.validate(item("""{"e":"12+7","a":20}""")); fail("答案不一致应报错") }
        catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("不一致")) }
        try { BankImporter.validate(item("""{"e":"42÷5","a":8}""")); fail("不整除应报错") }
        catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("整除")) }
        try { BankImporter.validate(item("""{"e":"2^3","a":8}""")); fail("未知运算符应报错") }
        catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("无法识别")) }
        try { BankImporter.validate(item("""{"e":"12+7"}""")); fail("缺少答案应报错") }
        catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("缺少")) }
    }

    // ---------- 标准格式校验 ----------

    @Test
    fun `validates studyontv format single`() {
        val out = BankImporter.validate(item(
            """{"type":"single","q":"唐诗《静夜思》的作者是？","a":["李白","杜甫"],"k":0,"difficulty":2,"tip":"李白","subject":"古诗","level":"二年级"}"""))
        assertEquals("李白", out.getJSONArray("a").getString(0))
        assertEquals(2, out.getInt("difficulty"))
        assertEquals("古诗", out.getString("subject"))
    }

    @Test
    fun `validates multiple choice and boolean`() {
        val multi = BankImporter.validate(item(
            """{"type":"multiple","q":"选出偶数","a":["2","3","4","5"],"correctIndices":[0,2]}"""))
        assertEquals(2, multi.getJSONArray("correctIndices").length())
        val bool = BankImporter.validate(item("""{"type":"boolean","q":"1 是奇数","k":0}"""))
        assertEquals("正确", bool.getJSONArray("a").getString(0))
    }

    @Test
    fun `accepts legacy field names stem options answerIndex`() {
        val out = BankImporter.validate(item(
            """{"type":"single","stem":"1 + 1 = ?","options":["1","2"],"answerIndex":1}"""))
        assertEquals("1 + 1 = ?", out.getString("q"))
        assertEquals(1, out.getInt("k"))
    }

    @Test
    fun `rejects broken questions`() {
        val cases = listOf(
            """{"a":["1","2"],"k":0}""",                                  // 缺题干
            """{"q":"${"长".repeat(5001)}","a":["1","2"],"k":0}""",        // 题干超长
            """{"q":"题","type":"essay","a":["1","2"],"k":0}""",           // 未知题型
            """{"q":"题","a":["只有一项"],"k":0}""",                        // 选项不足
            """{"q":"题","a":["1","2"],"k":5}""",                          // 答案越界
            """{"q":"题","a":["1","  "],"k":0}""",                         // 空选项
            """{"q":"题","a":["1","2"],"k":0,"difficulty":9}""",           // 难度越界
            """{"type":"multiple","q":"题","a":["1","2"],"correctIndices":[0,2]}""" // 多选越界
        )
        for (case in cases) {
            try { BankImporter.validate(item(case)); fail("应拒绝：$case") }
            catch (e: IllegalArgumentException) { /* 预期 */ }
        }
    }

    @Test
    fun `applies defaults for optional fields`() {
        val out = BankImporter.validate(item("""{"q":"3 + 3 = ?","a":["5","6"],"k":1}"""))
        assertEquals("single", out.getString("type"))
        assertEquals(2, out.getInt("difficulty"))
        assertTrue(!out.has("tip") || out.optString("tip").isEmpty() || out.has("tip"))
    }

    // ---------- 与 StudyOnTV 题库样例兼容 ----------

    @Test
    fun `imports studyontv style bank file`() {
        // 模拟 StudyOnTV data/banks/*.json 的 {name, version, items} 包装 + boolean/multiple 混合
        val bank = """
            {"name":"示例题库","version":2,"items":[
              {"type":"single","q":"3 × 4 = ?","a":["11","12","13","14"],"k":1,"difficulty":2,"subject":"口算"},
              {"type":"boolean","q":"0 乘任何数得 0","k":0,"subject":"口算"},
              {"type":"multiple","q":"得数是 12 的算式","a":["3×4","2×5","6×2","5×5"],"correctIndices":[0,2],"subject":"口算"}
            ]}
        """.trimIndent()
        val items = BankImporter.parseBank(bank)
        assertEquals(3, items.length())
        for (i in 0 until items.length()) BankImporter.validate(items.getJSONObject(i))
    }

    @Test
    fun `generated seed passes validation`() {
        // 内置生成器产出的题库必须能通过自己的导入校验
        val all = JSONArray()
        for (level in Generator.LEVELS) {
            for (q in Generator.generate(level.id, 40)) {
                all.put(JSONObject()
                    .put("type", "single").put("q", q.text)
                    .put("a", JSONArray(q.options.map { it.toString() }))
                    .put("k", q.options.indexOf(q.answer))
                    .put("difficulty", level.difficulty)
                    .put("subject", "口算").put("level", level.name))
            }
        }
        assertEquals(160, all.length())
        for (i in 0 until all.length()) BankImporter.validate(all.getJSONObject(i))
    }
}
