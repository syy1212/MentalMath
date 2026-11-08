# 题库 JSON 格式说明

把这份文档发给 AI（WorkBuddy / Codex 等），它就能按格式批量做题。题库由 **Agent 通过 HTTP 接口自动添加**（管理页不提供手动导入）。

## 标签

每道题都可以带两个标签，加题时直接写、也可以之后在管理页批量修改：

- **`level`：年级**，如 `"二年级"`（自由文本，建议用 一年级～六年级）
- **`difficulty`：难度 1–5 星**（整数，不写默认 2 星）

紧凑口算格式同样支持标签：`{"e":"12+7","a":19,"level":"二年级","difficulty":3}`。

## 让 Agent 自动加题（HTTP API，无需鉴权）

```bash
curl -X POST http://<设备IP>:8098/api/questions \
  -H 'Content-Type: application/json' \
  -d '{
    "bankId": "agent-数学加练",
    "bankName": "Agent · 二年级数学加练",
    "items": [
      {"e":"12+7","a":19,"level":"二年级","difficulty":3},
      {"e":"42÷6","a":7,"level":"二年级","difficulty":2},
      {"e":"23+45","a":68,"level":"二年级","difficulty":2}
    ]
  }'
```

- `bankId` 不存在会自动创建为新题库（`bankName` 可选，用于命名）；同名 bankId 再推送即往同一库追加
- **年级标签**：题目自带 `level` 时按题目；**未写时自动补上管理端「设置 → Agent 默认年级」配置的年级**（默认二年级），保证题库里所有题都有年级标签
- 每批 1–5000 道；响应 `{"ok":true,"added":N,"skipped":M}`
- 查看题目：`GET /api/questions?bankId=agent-数学加练&level=二年级&difficulty=3`
- 批量改标签（按筛选）：`POST /api/questions/tag {"bankId":"agent-数学加练","setLevel":"二年级","setDifficulty":3}`
- 批量改标签（按 id）：`POST /api/questions/tag {"ids":["q_x",...],"setDifficulty":4}`
- 删除某题库：`POST /api/banks/delete {"id":"..."}`（先 `GET /api/banks` 查 id）

把题目加入练习：在管理页「设置」标签把 **练习出题来源** 选成对应题库。

## 题库文件结构

## 题库文件结构

裸数组或带包装都可以：

```json
[
  { "e": "12+7", "a": 19 },
  { "e": "42÷6", "a": 7 }
]
```

```json
{
  "version": 2,
  "name": "题库名字",
  "items": [ ...题目... ]
}
```

## 格式一：紧凑口算格式（推荐，最省事）

一道题就两个值：`e` 算式 + `a` 数值答案。App 自动算出结果、生成 4 个选项（含干扰项）、展开成单选题。

```json
{"e": "12+7",   "a": 19}
{"e": "15-8",   "a": 7}
{"e": "6×7",    "a": 42}
{"e": "42÷6",   "a": 7}
```

规则：
- 支持的运算符：`+`、`-`（或 `−`）、`×`（或 `*`、`x`）、`÷`（或 `/`）；写不写 `=` 和 `?` 都行
- 减法结果可以为 0，除法必须能整除，答案 `a` 必须与算式一致（会校验）
- 想带解析可加 `"tip": "先算 10+7"`

## 格式二：标准格式（与 StudyOnTV 题库完全兼容）

家长间流传的 StudyOnTV 题库 JSON 直接导入即可。三种题型：

### 单选（single，默认）

```json
{
  "type": "single",
  "q": "3 × 4 = ?",
  "a": ["11", "12", "13", "14"],
  "k": 1,
  "tip": "三四十二",
  "difficulty": 2,
  "subject": "口算",
  "level": "表内乘除"
}
```

- `q` 题干；`a` 选项数组（2–8 个）；`k` 正确选项的下标（从 0 开始）
- `difficulty` 1–5 星，默认 2；`tip` 解析（可选）；`subject` / `level` 科目与年级（可选）

### 多选（multiple）

```json
{
  "type": "multiple",
  "q": "得数是 12 的算式",
  "a": ["3×4", "2×5", "6×2", "5×5"],
  "correctIndices": [0, 2]
}
```

`correctIndices` 是正确选项下标的数组。

### 判断（boolean）

```json
{"type": "boolean", "q": "0 乘任何数都得 0", "k": 0}
```

选项固定为「正确 / 错误」，`k` 0 = 正确，1 = 错误。

## 校验规则（导入时）

- 每批 1–5000 道，整批事务导入
- 单题校验失败（缺题干、答案越界、题型不支持等）会**跳过**并在结果里报告数量，不中断整批
- 支持老字段名：`stem`→`q`、`options`→`a`、`answerIndex`→`k`
- 重复 id：同一题库内视为修改，跨题库会自动换新 id

## 让 AI 帮你出题

直接把本文件发给 AI，附一句需求，例如：

> 按 docs/bank-format.md 的紧凑口算格式，出 40 道「100 以内进位加法」， difficulty 不需要，输出一个 JSON 文件给我。

拿到文件后：让 Agent 按上面「让 Agent 自动加题」的接口直接推送，或者手动 `POST /api/questions` 导入。
