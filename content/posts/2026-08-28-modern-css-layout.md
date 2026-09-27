---
title: 现在写 CSS 布局，我已经很少用 float 和 position 了
date: 2026-08-28
tags: [CSS, 前端, 布局]
category: 技术笔记
summary: 整理一下这些年真正高频使用的布局手段：Grid 负责页面骨架，Flex 负责组件内部，容器查询负责自适应。附几个可以直接抄的配方。
---

翻自己五年前的项目，布局代码里全是 `float`、`clearfix`、`position: absolute` 配一堆魔法数字。

现在再看新写的样式，几乎只剩下 `grid`、`flex` 和 `gap`。不是刻意追新，是它们确实把问题变简单了。

## 分工原则

我现在的用法很固定，基本不做选择：

| 场景 | 用什么 | 理由 |
| --- | --- | --- |
| 页面整体骨架 | Grid | 行列同时控制，模板区域一目了然 |
| 组件内部排列 | Flex | 一维、内容驱动、天然处理对齐 |
| 卡片墙 / 图片墙 | Grid + `auto-fill` | 不用算断点，容器宽度自己决定列数 |
| 元素层叠 | `position: relative/absolute` | 只在确实需要脱离文档流时用 |

一句话：**Grid 管二维，Flex 管一维，两者都不要用来做「元素之间留空隙」——那是 `gap` 的活。**

## 配方一：圣杯布局

以前要写三段浮动加负边距，现在：

```css
.layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 260px;
  gap: 32px;
  align-items: start;
}
```

`minmax(0, 1fr)` 里的 `0` 很关键。不加的话，中间列遇到长内容（比如一段没有空格的 URL 或代码块）会被撑破，因为 `1fr` 的最小值是 `auto`。

> 记不住就用 `minmax(0, 1fr)`，这个写法几乎不会出错。

响应式也很直白：

```css
@media (max-width: 1024px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
}
```

## 配方二：不用写断点的卡片墙

这是我最喜欢的一个：

```css
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 18px;
}
```

`auto-fill` 会尽可能多地塞列，每列最窄 280px。窗口从 1920 拖到 700，列数自动从 5 变到 2，一行媒体查询都不用写。

`auto-fill` 和 `auto-fit` 的区别值得记一下：

- `auto-fill`：列数按容器算，**空列也占位**。只有一张卡片时，它只占 280px 宽
- `auto-fit`：空列会**塌缩**，剩下的列拉伸填满。只有一张卡片时，它会撑满整行

需要「卡片保持固定宽度」用 `auto-fill`，需要「卡片拉伸铺满」用 `auto-fit`。

## 配方三：等高的两栏，内容各自独立滚动

```css
.split {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  height: 480px;
}

.split > * {
  min-height: 0;      /* 关键：允许子元素被压缩 */
  overflow-y: auto;
  overscroll-behavior: contain;
}
```

`min-height: 0` 是 Grid / Flex 里最容易被忽略的一行。默认情况下，网格项的 `min-height` 是 `auto`，内容多高它就多高，于是 `overflow` 永远不会生效。

## 配方四：内容宽度与容器宽度解耦

博客正文的经典需求：外层容器要够宽（能放侧边栏），但正文行宽不能超过 70 个字符左右，否则眼睛找下一行会累。

```css
.article-body {
  display: grid;
  grid-template-columns:
    minmax(24px, 1fr)
    min(70ch, 100%)
    minmax(24px, 1fr);
}

.article-body > * { grid-column: 2; }
```

三列结构，中间列用 `min(70ch, 100%)` 限制最大宽度，两侧的 `minmax(24px, 1fr)` 负责把中间列挤到正中。想要「图片通栏、文字窄栏」的效果，给图片加一行：

```css
.article-body > .full-bleed { grid-column: 1 / -1; }
```

## 配方五：容器查询，真正的组件级响应式

媒体查询看的是**视口**宽度，但组件根本不知道自己在多宽的容器里。同一个卡片，放在主栏和放在侧边栏，需要的样式完全不同。

```css
.card-wrap { container-type: inline-size; }

@container (min-width: 420px) {
  .card { display: grid; grid-template-columns: 120px 1fr; gap: 16px; }
}
```

现在这个卡片会自己判断：「我所在的位置够宽吗？」够就横排，不够就竖排。这是媒体查询做不到的事。

## 配方六：粘性侧边栏

```css
.aside {
  position: sticky;
  top: 92px;                /* 顶栏高度 + 一点余量 */
  align-self: start;        /* 关键：不加的话在 Grid 里不生效 */
  max-height: calc(100vh - 120px);
  overflow-y: auto;
}
```

在 Grid 布局中，网格项默认会被拉伸到整行高度，`sticky` 就失去了滚动空间。`align-self: start` 让它只占自身高度，粘性才会生效。

## 几个顺手记下的细节

- `gap` 在 Flex 里已经全面可用，不用再给子元素写 `margin-right` 再 `:last-child` 清零
- `aspect-ratio: 16 / 9` 取代了 padding-top 百分比那套 hack
- `place-items: center` 是 `align-items` + `justify-items` 的缩写，做居中比 `margin: auto` 更省心
- `inset: 0` 代替 `top/right/bottom/left: 0`
- 逻辑属性 `margin-inline`、`padding-block` 在写国际化站点时能省掉很多 `[dir="rtl"]` 覆盖

## 我仍然会用绝对定位的场景

不是所有布局都该交给 Grid：

- 角标、关闭按钮这类**脱离文档流**的装饰元素
- 需要精确覆盖在某个元素上的浮层
- 动画里需要独立 `transform` 轨道的元素

判断标准很简单：**如果这个元素的存在会影响其他元素的排列，就不该用绝对定位。**

---

布局这件事，这些年最大的变化不是多了多少新属性，而是**思路从「计算位置」变成了「描述关系」**。描述清楚父子关系和尺寸约束，剩下的交给浏览器算，比手算一堆百分比可靠得多。
