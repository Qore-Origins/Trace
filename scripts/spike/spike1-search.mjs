// SPIKE-1 + SPIKE-4: 检索实现对比（FlexSearch 分词 vs 内存扫包含）与性能基准
// 判定标准（LLD 附录C）：中文检索命中率 100%（无漏检）；万级规模 build/query ≤ 1s
// 运行：node scripts/spike/spike1-search.mjs
import { Document, Encoder } from 'flexsearch'

// ---------- 语料生成（规模上限：1000 计划 / 10000 任务） ----------
const WORDS = [
  '学期计划', '技能大赛', '备赛冲刺', '周计划', '实训项目', '溯源查询', '检索索引',
  '复盘总结', '课程设计', '毕业论文', '面试准备', '项目评审', '里程碑', '需求分析',
  '系统设计', '开发实施', '测试验收', '部署上线', '用户手册', '架构决策'
]
const EN_WORDS = ['sprint', 'milestone', 'trace', 'review', 'refactor']
const EMOJI = ['重要', '⚠️ 紧急']

const rand = (n) => Math.floor(Math.random() * n)
const pick = (arr) => arr[rand(arr.length)]

function genCorpus() {
  const docs = []
  let docId = 0
  for (let p = 0; p < 1000; p++) {
    const planName = `${pick(WORDS)}-${p}`
    const noteContent = `${pick(WORDS)}的经验：${pick(WORDS)}前置，返工减半 ${pick(EN_WORDS)} ${pick(EMOJI)}`
    docs.push({ id: docId++, path: `计划${p}`, scope: 'plan', text: planName })
    docs.push({ id: docId++, path: `计划${p}`, scope: 'note', text: noteContent })
    const taskCount = 8 + rand(5) // 8-12
    for (let t = 0; t < taskCount; t++) {
      docs.push({
        id: docId++,
        path: `计划${p}`,
        scope: 'task',
        text: `${pick(WORDS)}任务${t} ${pick(EN_WORDS)}`
      })
    }
  }
  return docs // ~1000*(2+10) = 12000 docs
}

// ---------- 查询集：从语料中采样的中文子串（含 infix/单词/英文/不存在） ----------
function genQueries(docs) {
  const qs = []
  for (let i = 0; i < 24; i++) {
    const d = docs[rand(docs.length)]
    const words = d.text.split(/\s+/).filter(Boolean)
    const w = words[rand(words.length)]
    if (w.length >= 2) qs.push(w.slice(0, 2 + rand(2))) // 2-4 字子串
  }
  qs.push('trace', '周计划', '不存在的词汇XYZ')
  return [...new Set(qs)]
}

// ---------- 真值：暴力包含匹配（AND 语义） ----------
function bruteForce(docs, kw) {
  const kws = kw.split(/\s+/)
  return docs.filter((d) => kws.every((k) => d.text.toLowerCase().includes(k.toLowerCase()))).map((d) => d.id)
}

// ---------- 方案 B：内存扫包含（预提取 + includes） ----------
function approachB(docs, kw) {
  return bruteForce(docs, kw) // 等价实现（B 即真值算法的生产化）
}

// ---------- 方案 A：FlexSearch Document + 自定义分词 ----------
function flexApproach(docs, queries) {
  const results = {}
  for (const [name, tokenizer] of [['reverse', 'reverse'], ['full', 'full']]) {
    const t0 = performance.now()
    const enc = new Encoder({ tokenizer })
    const index = new Document({
      cache: false,
      tokenize: tokenizer,
      encoder: enc,
      document: {
        id: 'id',
        index: ['text']
      }
    })
    for (const d of docs) index.add(d.id, d)
    const buildMs = performance.now() - t0

    const t1 = performance.now()
    let maxMs = 0
    let totalRecall = 0
    let recallOk = 0
    for (const q of queries) {
      const qt = performance.now()
      // AND 语义：多词结果集取交集
      const kws = q.split(/\s+/)
      let sets = kws.map((k) => new Set(index.search(k, { limit: 100000 }).flatMap((r) => [...r.result])))
      let hits = sets.reduce((a, b) => new Set([...a].filter((x) => b.has(x))))
      const ms = performance.now() - qt
      maxMs = Math.max(maxMs, ms)
      const truth = new Set(bruteForce(docs, q))
      const hitSet = new Set(hits)
      let miss = 0
      for (const id of truth) if (!hitSet.has(id)) miss++
      if (miss === 0) recallOk++
      totalRecall += miss
    }
    results[name] = { buildMs, avgMs: (performance.now() - t1) / queries.length, maxMs, recallOk, totalMiss: totalRecall, queries: queries.length }
  }
  return results
}

// ---------- 执行 ----------
const docs = genCorpus()
const queries = genQueries(docs)
console.log(`语料: ${docs.length} docs（1000 计划/约 10000 任务） | 查询: ${queries.length} 条`)

// 方案 B 基准
{
  const t0 = performance.now()
  let maxMs = 0
  let miss = 0
  for (const q of queries) {
    const qt = performance.now()
    approachB(docs, q)
    maxMs = Math.max(maxMs, performance.now() - qt)
  }
  // B 与真值同构，漏检恒为 0（构造性）
  console.log(`[B 内存扫包含] build=0ms | avg=${((performance.now() - t0) / queries.length).toFixed(2)}ms | max=${maxMs.toFixed(2)}ms | 漏检=0（构造性保证）`)
}

// 方案 A（两种分词器）
const res = flexApproach(docs, queries)
for (const [name, r] of Object.entries(res)) {
  console.log(`[A FlexSearch:${name}] build=${r.buildMs.toFixed(0)}ms | avg=${r.avgMs.toFixed(2)}ms | max=${r.maxMs.toFixed(2)}ms | 命中率=${r.recallOk}/${r.queries} | 总漏检=${r.totalMiss}`)
}
console.log('DONE_SPIKE1')
