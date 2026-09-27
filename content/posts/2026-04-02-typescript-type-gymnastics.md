---
title: TypeScript 类型体操：该练什么，该停在哪
date: 2026-04-02
tags: [TypeScript, 类型系统, 前端]
category: 技术笔记
summary: 条件类型、映射类型、模板字面量类型确实强大，但强大不等于该用。分享几个真正提升过开发体验的模式，以及我给自己划的三条停止线。
---

我见过两种极端。

一种是**完全不用泛型**：到处 `any`，类型系统形同虚设，IDE 提示全是 `any`，等于花钱买了个语法检查器。

另一种是**类型体操上瘾**：为了一个只有自己看得懂的类型推导写了四十行，同事改代码时得先花半小时读懂类型定义。

这两种都跑偏了。这篇笔记想理清楚：**哪些类型技巧是真正在解决实际问题的。**

## 一、真正值得掌握的基础

先说结论：下面这几个是**投入产出比最高**的，值得花时间吃透。

### 1. `keyof` + 索引访问类型

```ts
interface User {
  id: number;
  name: string;
  email: string;
}

type UserKey = keyof User;              // 'id' | 'name' | 'email'
type UserValue = User[UserKey];         // number | string

// 实用场景：类型安全的取值函数
function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) result[key] = obj[key];
  return result;
}

const partial = pick(user, ['id', 'name']);  // 类型：{ id: number; name: string }
```

这个模式在日常业务里出现频率极高，尤其是做数据筛选、表单取值、表格列配置。

### 2. 映射类型 + 修饰符

```ts
// 全部变可选
type Partial<T> = { [K in keyof T]?: T[K] };

// 全部变只读
type Readonly<T> = { readonly [K in keyof T]: T[K] };

// 去掉可选修饰符（- 是移除的意思）
type Required<T> = { [K in keyof T]-?: T[K] };
```

理解了 `+` / `-` 修饰符，就能自己造出比内置工具类型更贴合业务的类型：

```ts
// 把某些字段变成必填，其余保持原样
type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };

type DraftPost = {
  title?: string;
  slug?: string;
  body?: string;
};

// 发布时 title 和 slug 必须有，body 可以没有
type PublishedPost = WithRequired<DraftPost, 'title' | 'slug'>;
```

### 3. 条件类型 + `infer`

```ts
// 提取 Promise 的解析类型
type Awaited<T> = T extends Promise<infer U> ? Awaited<U> : T;

// 提取数组元素类型
type ElementOf<T> = T extends (infer U)[] ? U : never;

// 提取函数返回值
type ReturnOf<T> = T extends (...args: any[]) => infer R ? R : never;
```

`infer` 的价值在于：**从已有类型里"拆"出信息，而不是重复声明一遍。**

一个真实用例——从 API 层自动推导出组件 props：

```ts
const api = {
  getUser: (id: number) => Promise.resolve({ id, name: 'Alice' } as User),
  listPosts: (page: number) => Promise.resolve([] as Post[]),
};

type ApiResult<K extends keyof typeof api> = Awaited<ReturnType<typeof api[K]>>;

type UserResult = ApiResult<'getUser'>;   // User
type PostList = ApiResult<'listPosts'>;   // Post[]
```

这样接口返回结构变了，前端类型自动跟着变，不需要手动同步两处。

### 4. 模板字面量类型

```ts
type EventName = 'click' | 'focus' | 'blur';
type Handler = `on${Capitalize<EventName>}`;  // 'onClick' | 'onFocus' | 'onBlur'
```

在前端项目里，这个特性最实用的场景是**事件名、CSS 变量名、路由参数**这类字符串约束：

```ts
type Route = `/post/${string}` | `/tag/${string}` | '/about';

function navigate(route: Route) { /* ... */ }

navigate('/post/hello');   // ✅
navigate('/nope');         // ❌ 编译期就报错
```

## 二、我给自己划的三条停止线

练了两年之后，我总结出三条规则。**违反任何一条，我就会把类型简化掉。**

### 停止线一：类型定义比实现代码还长

如果一个函数的实现是 5 行，类型签名是 25 行，那这个类型在**增加**维护成本，而不是降低。

```ts
// ❌ 过度设计
type DeepPartialDeepReadonly<T> = T extends (infer U)[]
  ? DeepPartialDeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]?: DeepPartialDeepReadonly<T[K]> }
    : T;

// ✅ 够用就好
type Draft<T> = { [K in keyof T]?: T[K] };
```

### 停止线二：需要写注释才能读懂

类型系统的目标是**让代码更自解释**。如果类型本身需要一段注释来解释它在干什么，那它就没有达成目标。

```ts
// ❌ 读的人需要先理解这段类型，才能理解业务
type R<T extends Record<string, unknown>> =
  T extends infer U extends Record<string, unknown>
    ? { [K in keyof U as U[K] extends never ? never : K]: U[K] }
    : never;
```

### 停止线三：报错信息无法理解

这是最实用的一条判断标准。

写完一个复杂类型后，**故意传一个错误的参数进去，看看报错长什么样**。

```ts
// 好的类型：报错清晰
// Argument of type 'string' is not assignable to parameter of type 'number'.

// 差的类型：报错是一屏红色的类型展开
// Type '{ a: string; }' is not assignable to type
// 'DeepReadonly<DeepPartial<Omit<Config, "x" | "y">>> & { ... }'
// ... 接下来 40 行
```

**类型系统的用户是未来的自己。** 报错看不懂，等于这个类型在帮倒忙。

## 三、几个常见的反模式

**用类型做运行时校验。**

```ts
// ❌ 类型只在编译期存在，运行时什么都不做
function parse(input: string): User {
  return JSON.parse(input) as User;   // 骗过了编译器，但没防住脏数据
}
```

外部数据（API 响应、localStorage、URL 参数）必须用运行时校验库（zod、valibot 之类），类型只负责描述校验之后的形状。

**类型断言掩盖真实问题。**

```ts
// ❌ as 是「闭嘴」的语法糖
const el = document.getElementById('app') as HTMLDivElement;

// ✅ 显式处理 null
const el = document.getElementById('app');
if (!el) throw new Error('#app 不存在');
```

`as` 每次出现都应该被质疑一次：**这里为什么编译器判断不了？是不是我的设计有问题？**

**过度使用 `any` 和 `unknown` 的混淆。**

- `any`：放弃类型检查，且会**污染**所有与它交互的类型
- `unknown`：安全的顶类型，必须先收窄才能用

在必须接收任意输入的地方（比如反序列化、错误捕获），**优先 `unknown`**：

```ts
function handleError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '未知错误';
}
```

## 四、一个实用的判断流程

遇到需要类型设计的场景，我现在按这个顺序想：

```text
1. 能直接用内置工具类型解决吗？
   （Partial / Pick / Omit / Record / ReturnType / Parameters）
   → 能，就用。不要重造轮子

2. 能通过「从已有类型推导」而不是「重新声明」得到吗？
   → 能，就用 typeof / keyof / infer

3. 推导出来的类型，报错信息读得懂吗？
   → 读不懂，退回到第 1 步，用更笨但更清晰的方式

4. 类型定义的长度是否超过实现代码？
   → 超过，考虑用 interface 手写一遍，可能更省心
```

第 3 和第 4 步是大多数类型体操文章的盲区。它们只讲"能不能做到"，不讲"值不值得做"。

## 最后

TypeScript 的类型系统确实图灵完备，理论上可以在类型层面实现一个计算器。

但**能力不等于义务**。

我现在的原则很简单：**类型是用来防止 bug 的，不是用来炫技的。** 如果一个类型技巧不能让未来的自己少写一个 bug、少查一次文档、少 debug 半小时，那它就不该出现在代码里。

> 判断一段类型代码写得好不好，不看它多聪明，看**改需求的时候它挡不挡路**。
