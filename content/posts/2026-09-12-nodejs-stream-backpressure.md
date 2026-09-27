---
title: 理解了背压，才算真正会用 Node.js 流
date: 2026-09-12
tags: [Node.js, 性能优化, 后端]
category: 技术笔记
series: 服务端实战
summary: 一次导出大文件导致服务内存暴涨的排查过程，以及从 pipe 到 pipeline 的改造。背压不是一个高级概念，而是流的默认契约。
featured: true
---

上周线上有个导出接口，导出一个 2GB 左右的 CSV，跑了没多久服务就被 OOM Killer 干掉了。

代码看起来人畜无害：

```js
app.get('/export', async (req, res) => {
  const rows = await db.query('SELECT * FROM records'); // 一次性全查出来
  const csv = rows.map(r => toCsvLine(r)).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});
```

问题显而易见——`SELECT *` 把整张表读进了内存，`join` 又复制了一份。但真正让我想写这篇笔记的，是改造成流之后踩到的第二个坑。

## 第一版改造：看起来对了

```js
app.get('/export', async (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  const cursor = db.queryStream('SELECT * FROM records');
  cursor.pipe(res);
});
```

内存确实降下来了。但压测时发现，当客户端下载速度慢（比如手机 4G），服务端内存还是会缓慢上涨。

原因在于：**`pipe` 只做了一半的事**。

## 背压到底是什么

流的核心契约其实很简单：

- 可读流通过 `push()` 产生数据
- 可写流通过 `write()` 消费数据
- `write()` 返回 `false`，表示「我缓冲区满了，先别给了」

所谓背压（backpressure），就是可读流在收到 `false` 之后**主动暂停**，等可写流 `drain` 之后再继续。

`pipe()` 内部确实处理了这件事：

```js
// pipe 的核心逻辑，简化版
src.on('data', chunk => {
  const ok = dest.write(chunk);
  if (!ok) src.pause();          // 关键：暂停上游
});
dest.on('drain', () => src.resume());
```

那我这里为什么没生效？

因为我中间插了一层自己的 `Transform`，用来做 CSV 转义，而那层没把背压传下去：

```js
// 有问题的写法
const csvTransform = new Transform({
  transform(chunk, enc, cb) {
    this.push(toCsvLine(chunk));  // 完全忽略了 push 的返回值
    cb();
  },
});
```

`this.push()` 返回 `false` 时说明下游缓冲区已满，此时应当停止读取上游，而不是继续 `cb()` 往下灌。

## 正确写法

`Transform` 里用 `push` 的返回值控制节奏：

```js
const csvTransform = new Transform({
  objectMode: true,
  transform(row, enc, cb) {
    const line = toCsvLine(row) + '\n';
    if (this.push(line)) {
      cb();              // 下游还有余量，继续
    } else {
      // 下游满了，等它 drain 之后再继续
      this.once('drain', cb);
    }
  },
});
```

然后用 `pipeline` 串起来，顺便把错误处理也解决了：

```js
const { pipeline } = require('node:stream/promises');

app.get('/export', async (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="records.csv"');

  try {
    await pipeline(
      db.queryStream('SELECT * FROM records'),
      csvTransform,
      res
    );
  } catch (err) {
    if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') return; // 客户端主动断开，属正常
    req.log.error(err);
    if (!res.headersSent) res.status(500).end();
  }
});
```

## 为什么一定要用 pipeline

对比一下 `pipe` 和 `pipeline` 的差别：

| 能力 | `pipe` | `pipeline` |
| --- | --- | --- |
| 传递背压 | ✅ | ✅ |
| 错误传播到终点 | ❌ | ✅ |
| 中途出错自动销毁整条链 | ❌ | ✅ |
| 返回 Promise，可 await | ❌ | ✅ |
| 清理监听器，避免泄漏 | ❌ | ✅ |

`pipe` 不会把错误传下去。也就是说，如果数据库游标在中途报错，`res` 永远不会收到通知，连接就挂在那里，直到超时。`pipeline` 会把这个错误一路抛到最后，并且销毁所有中间流。

## 改造后的效果

- 导出 2GB 数据，服务端常驻内存稳定在 **80MB** 左右，与文件大小无关
- 客户端限速到 200KB/s 时，内存不再持续增长
- 客户端中途取消下载，服务端能在 100ms 内释放资源

## 几个容易忽略的点

- **`highWaterMark` 不是越大越好**。默认 16KB 对大多数场景够用；调到 1MB 只是把内存压力从下游挪到了上游
- **`objectMode` 下的 `highWaterMark` 以「对象个数」计**，不是字节数。默认 16，意味着最多缓冲 16 行记录
- **`res` 本身就是可写流**，不需要包一层 `Writable`
- 调试时打印 `stream.writableLength`，能直观看到缓冲区堆积情况

> 判断一段流代码写得好不好，有个简单的标准：把下游换成慢速的 `setTimeout` 消费者，看上游会不会无限制地读下去。会，就是没处理背压。

背压不是需要额外实现的优化，它是流的默认契约。大多数时候我们不是「没做背压」，而是**亲手把它绕过去了**。
