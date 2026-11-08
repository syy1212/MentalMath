package com.kousuan.mental

import kotlin.random.Random

/**
 * 口算生成器：移植 StudyOnTV mental.js 的构造法——
 * 构造时保证结果恒在合法范围内（加减不出现负数、除法必定整除），而不是生成后再过滤。
 * 纯 Kotlin 实现，无 Android 依赖，可在 JVM 单元测试中直接运行。
 */
object Generator {

    /** 内置题库的 bank_id */
    const val BUILT_IN = "built-in"

    data class Level(val id: Int, val name: String, val note: String, val difficulty: Int)

    val LEVELS = listOf(
        Level(1, "20 以内加减", "入门", 1),
        Level(2, "100 以内加减", "进位退位", 2),
        Level(3, "表内乘除", "乘法口诀", 2),
        Level(4, "两步混合", "稍有挑战", 3)
    )

    data class Question(val text: String, val answer: Int, val options: List<Int>)

    private val rnd = Random.Default

    /** 闭区间 [min, max] 随机整数 */
    private fun rnd(min: Int, max: Int): Int =
        if (max <= min) min else min + rnd.nextInt(max - min + 1)

    private fun shuffle(list: List<Int>): List<Int> = list.shuffled(rnd)

    /** 正确答案 + 邻近干扰项（±1/2/3/5/9/10），不足时用 answer + 11n 兜底，过滤负数与重复 */
    fun makeOptions(answer: Int): List<Int> {
        val set = mutableListOf(answer)
        val pool = shuffle(listOf(
            answer + 1, answer - 1, answer + 2, answer - 2,
            answer + 3, answer - 3, answer + 5, answer - 5,
            answer + 9, answer - 9, answer + 10, answer - 10
        ))
        for (value in pool) {
            if (set.size >= 4) break
            if (value >= 0 && !set.contains(value)) set.add(value)
        }
        var extra = 1
        while (set.size < 4) {
            val value = answer + extra * 11
            if (!set.contains(value)) set.add(value)
            extra++
        }
        return shuffle(set)
    }

    /** 生成一道题；返回 null 表示该档位暂时重复过多（调用方换一道重试） */
    fun makeQuestion(level: Int): Question? {
        val text: String
        val answer: Int
        when (level) {
            1, 2 -> {
                val max = if (level == 1) 20 else 100
                if (rnd.nextInt(2) == 0) {
                    val a = rnd(1, max - 1); val b = rnd(1, max - a)
                    text = "$a + $b = ?"; answer = a + b
                } else {
                    val a = rnd(2, max); val b = rnd(1, a)
                    text = "$a − $b = ?"; answer = a - b
                }
            }
            3 -> {
                if (rnd.nextInt(10) < 6) {
                    val a = rnd(2, 9); val b = rnd(2, 9)
                    text = "$a × $b = ?"; answer = a * b
                } else {
                    val b = rnd(2, 9); answer = rnd(2, 9); val a = b * answer
                    text = "$a ÷ $b = ?"
                }
            }
            4 -> {
                val a = rnd(10, 50); val b = rnd(1, 20); val c = rnd(1, minOf(a + b, 20))
                text = "$a + $b − $c = ?"; answer = a + b - c
            }
            else -> return null
        }
        return Question(text, answer, makeOptions(answer))
    }

    fun levelName(level: Int): String = LEVELS.firstOrNull { it.id == level }?.name ?: "口算"

    fun levelDifficulty(level: Int): Int = LEVELS.firstOrNull { it.id == level }?.difficulty ?: 2

    /** 连续生成 count 道不重复的题（按题干去重），用于首启内置题库 */
    fun generate(level: Int, count: Int): List<Question> {
        val out = ArrayList<Question>(count)
        val seen = HashSet<String>()
        var attempts = 0
        while (out.size < count && attempts < count * 20) {
            attempts++
            val q = makeQuestion(level) ?: continue
            if (seen.add(q.text)) out.add(q)
        }
        return out
    }
}
