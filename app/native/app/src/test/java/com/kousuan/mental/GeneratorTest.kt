package com.kousuan.mental

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 口算生成器：验证构造法约束——结果范围、除法整除、选项合法性 */
class GeneratorTest {

    @Test
    fun `level1 results within 0-20`() {
        repeat(500) {
            val q = Generator.makeQuestion(1)!!
            val a = q.answer
            assertTrue("题目 ${q.text} 结果 $a 超出 0-20", a in 0..20)
            if (q.text.contains(" − ")) assertTrue("减法结果不能为负", a >= 0)
            if (q.text.contains(" + ")) assertTrue("加法结果不能超过 20", a <= 20)
        }
    }

    @Test
    fun `level2 results within 0-100`() {
        repeat(500) {
            val q = Generator.makeQuestion(2)!!
            assertTrue("题目 ${q.text} 结果 ${q.answer} 超出 0-100", q.answer in 0..100)
        }
    }

    @Test
    fun `level3 multiplication within table and division exact`() {
        repeat(500) {
            val q = Generator.makeQuestion(3)!!
            if (q.text.contains(" × ")) {
                val (a, b) = q.text.removeSuffix(" = ?").split(" × ").map { it.trim().toInt() }
                assertTrue("乘数 $a 超出表内范围", a in 2..9)
                assertTrue("乘数 $b 超出表内范围", b in 2..9)
                assertEquals("乘法结果错误", a * b, q.answer)
            } else {
                val (a, b) = q.text.removeSuffix(" = ?").split(" ÷ ").map { it.trim().toInt() }
                assertEquals("除法必须整除：${q.text}", 0, a % b)
                assertEquals("除法结果错误", a / b, q.answer)
                assertTrue("除数 $b 超出表内范围", b in 2..9)
            }
        }
    }

    @Test
    fun `level4 two-step never negative`() {
        repeat(500) {
            val q = Generator.makeQuestion(4)!!
            assertTrue("题目 ${q.text} 结果 ${q.answer} 为负", q.answer >= 0)
        }
    }

    @Test
    fun `options valid for all levels`() {
        for (level in 1..4) {
            repeat(200) {
                val q = Generator.makeQuestion(level)!!
                assertEquals("必须是 4 个选项", 4, q.options.size)
                assertEquals("选项有重复：${q.options}", 4, q.options.toSet().size)
                assertTrue("选项必须包含正确答案", q.options.contains(q.answer))
                assertTrue("选项不能为负：${q.options}", q.options.all { it >= 0 })
            }
        }
    }

    @Test
    fun `generate dedupes and fills count`() {
        for (level in 1..4) {
            val questions = Generator.generate(level, 40)
            assertEquals("档位 $level 应生成 40 道不重复题目", 40, questions.size)
            assertEquals("题干应不重复", 40, questions.map { it.text }.toSet().size)
        }
    }

    @Test
    fun `levels metadata consistent`() {
        assertEquals(4, Generator.LEVELS.size)
        assertEquals(listOf(1, 2, 3, 4), Generator.LEVELS.map { it.id })
        assertTrue(Generator.levelName(1).contains("20"))
        assertTrue(Generator.levelName(3).contains("乘除"))
    }
}
