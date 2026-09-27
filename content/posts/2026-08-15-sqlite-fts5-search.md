---
title: 用 SQLite 做站内搜索，够用且好维护
date: 2026-08-15
tags: [SQLite, 数据库, 搜索, 后端]
category: 技术笔记
summary: 给个人项目加搜索，不必上 Elasticsearch。SQLite 的 FTS5 加上触发器同步，几十行代码就能得到一个支持中文分词的检索能力。
---

给博客加搜索这件事，我纠结了挺久。

一开始想的是前端方案：把所有文章打成 JSON，浏览器里过滤。简单是简单，但文章一多就崩——用户得先下载完整个索引，才能搜第一个字。

后来想上 Elasticsearch，看了看内存占用，觉得为几百篇文章养一个 JVM 进程，实在不划算。

最后选了 SQLite 的 FTS5。**一个文件、零运维、几十行代码**，正好匹配这个体量。

## FTS5 是什么

SQLite 从 3.9 开始内置的全文检索扩展。它把文本切成 token 建倒排索引，支持：

- 布尔查询：`Node.js AND 流`
- 短语查询：`"背压"`
- 前缀查询：`pipe*`
- 排序：`bm25()` 相关度打分
- 高亮：`highlight()`、`snippet()`

建表很直接：

```sql
CREATE VIRTUAL TABLE posts_fts USING fts5(
  title,
  summary,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

## 中文怎么办

这是最容易踩的坑。`unicode61` 分词器是按**空格和标点**切词的，中文没有空格，所以「背压不是一个高级概念」会被切成一个整体 token，搜「背压」完全搜不到。

三个方案：

| 方案 | 做法 | 适用场景 |
| --- | --- | --- |
| 前置分词 | 入库前用 jieba 等工具切好，用空格连接 | 数据量小、能接受额外依赖 |
| 二元切分 | 把中文切成两字组合，`背压` → `背压` | 无需词典，召回率高，索引略大 |
| 外部分词器 | 编译带 ICU 或 simple 分词器的 SQLite | 环境可控，最省事 |

我选了**二元切分（bigram）**，因为它不需要词典文件，也不依赖编译选项：

```js
/**
 * 把文本切成检索用的 token 串。
 * 中文按二元组切分，英文数字保持整词，统一小写。
 */
function toIndexText(text) {
  const tokens = [];
  const re = /[\u4e00-\u9fa5]+|[A-Za-z0-9_]+/g;
  let match;

  while ((match = re.exec(text)) !== null) {
    const seg = match[0];
    if (/[\u4e00-\u9fa5]/.test(seg)) {
      // 中文：单字 + 二元组，兼顾单字查询和词组查询
      for (let i = 0; i < seg.length; i += 1) {
        tokens.push(seg[i]);
        if (i < seg.length - 1) tokens.push(seg.slice(i, i + 2));
      }
    } else {
      tokens.push(seg.toLowerCase());
    }
  }

  return tokens.join(' ');
}
```

查询侧做同样的切分，然后用 `OR` 连接，再用 `bm25` 排序：

```js
function buildQuery(keyword) {
  return toIndexText(keyword)
    .split(' ')
    .filter(Boolean)
    .map((t) => `"${t}"`)
    .join(' OR ');
}
```

## 写入与同步

不想在业务代码里手动维护两份数据，用触发器同步最省心：

```sql
CREATE TRIGGER posts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, summary, body)
  VALUES (new.id, new.title, new.summary, new.body_index);
END;

CREATE TRIGGER posts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, summary, body)
  VALUES ('delete', old.id, old.title, old.summary, old.body_index);
END;

CREATE TRIGGER posts_au AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, summary, body)
  VALUES ('delete', old.id, old.title, old.summary, old.body_index);
  INSERT INTO posts_fts(rowid, title, summary, body)
  VALUES (new.id, new.title, new.summary, new.body_index);
END;
```

注意 FTS5 的**外部内容表**和**内容表**两种模式：

- `content='posts'`（外部内容）：索引不存原文，省空间，但删除时必须按上面的写法显式传旧值
- 普通模式：索引自己存一份原文，占空间但操作简单

个人项目里我倾向普通模式，磁盘比代码可维护性便宜。

## 查询语句

```sql
SELECT
  p.id,
  p.slug,
  p.title,
  snippet(posts_fts, 2, '<mark>', '</mark>', '…', 24) AS excerpt,
  bm25(posts_fts, 8.0, 3.0, 1.0) AS score
FROM posts_fts
JOIN posts p ON p.id = posts_fts.rowid
WHERE posts_fts MATCH ?
ORDER BY score
LIMIT 20;
```

`bm25()` 的参数是**各列的权重**，这里给标题 8 倍、摘要 3 倍、正文 1 倍。分数越小越相关（BM25 返回的是负值，`ORDER BY score` 升序即最相关在前）。

`snippet()` 的签名是 `snippet(表名, 列号, 起始标记, 结束标记, 省略号, token 数)`。列号从 0 开始，所以 `2` 指的是 `body` 列。

## 实测数据

拿我这个站点试了试：

- 文章数：约 120 篇，正文合计 38 万字
- 索引文件大小：**11MB**（原文约 1.2MB，二元切分放大了索引）
- 单次查询耗时：**1 ~ 4ms**
- 冷启动建索引：0.6 秒

这个体量下，SQLite 和 ES 的**查询速度差异用户根本感知不到**，但运维成本差着一个数量级。

## 什么情况下该换掉它

SQLite FTS5 的边界也很清楚：

- 需要**同义词、词干还原、拼写纠错**——它的能力止步于 token 匹配
- 数据量超过**千万级文档**，或者索引文件超过内存能缓存的规模
- 需要**分布式、多副本、聚合分析**
- 需要**近实时**（亚秒级）地反映写入——FTS5 是单机事务性的，没有分布式一致性那套东西

个人博客、内部工具、中小型 SaaS 的站内搜索，基本都在边界之内。

> 选型时最有价值的判断，不是「哪个技术最强」，而是「我现在这个问题，最小的解是什么」。多出来的每一层复杂度，最后都要靠人力去养。

## 最后

我用 SQLite 之后最明显的感受是：**部署变成了「复制一个文件」**。

备份就是 `cp`，迁移就是拷贝，本地调试直接拿生产库的副本跑。这些便利在项目早期不值钱，但项目活得越久越值钱。
