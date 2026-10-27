---
title: Git使用流程
date: '2026-10-27'
tags:
  - GIt
category: 嵌入式开发
draft: false
pinned: true
---
# Git 使用流程（Windows + Dev-C++ + GitHub SSH）

这份笔记对应当前项目：`D:\AIUSE\week01_c_project`，GitHub 用户名为 `kiki-github1`。远程仓库名称请以你在 GitHub 上实际创建的仓库为准。

## 一、先区分三个概念

- **工作区**：你在 Dev-C++ 里编辑的 `main.c`、`calc.c`、`calc.h` 等文件。
- **本地仓库**：Git 在项目的 `.git` 目录里保存的提交历史。
- **远程仓库**：GitHub 上保存的仓库。执行 `git commit` 不会自动上传；需要 `git push`。

## 二、一次性设置

### 1. 检查 Git

在 Git Bash 执行：

```bash
git --version
```

### 2. 设置提交者信息（通常一台电脑配置一次）

```bash
git config --global user.name "用户名"
git config --global user.email "邮箱"
```

检查：

```bash
git config --global user.name
git config --global user.email
```

这两个值用于 Git 提交记录，不是 GitHub 密码或 SSH 密钥。若不希望公开真实邮箱，可在 GitHub 设置中使用其提供的私有提交邮箱。

### 3. 配置 SSH（只有尚未配置时才需要）

检查是否已有密钥：

```bash
ls ~/.ssh
```

如果没有可用的 SSH 公钥，可以生成一对密钥：

```bash
ssh-keygen -t ed25519 -C "2860011250@qq.com"
```

按提示保存；私钥文件不要发给任何人。打开并复制公钥内容：

```bash
cat ~/.ssh/id_ed25519.pub
```

在 GitHub：**头像 → Settings → SSH and GPG keys → New SSH key**，把公钥粘贴进去。随后测试：

```bash
ssh -T git@github.com
```

若提示已成功认证，即可使用 SSH 推送。若 SSH 已经配置并可用，不要重复生成密钥。

## 三、当前项目已经有本地提交，怎样连接 GitHub

### 1. 先在 GitHub 创建空仓库

在 GitHub 点击 **New repository**。建议仓库名 `week01_c_project`。对于已有本地提交的项目，创建时先不要勾选自动创建 README、`.gitignore` 或 License，避免初次推送时出现无关的历史冲突。

复制仓库页面显示的 **SSH 地址**，一般类似：

```text
git@github.com:kiki-github1/week01_c_project.git
```

请以 GitHub 实际显示的地址为准。

### 2. 在项目目录打开 Git Bash

进入：

```text
D:\AIUSE\week01_c_project
```

查看当前状态和远程地址：

```bash
git status
git remote -v
git branch --show-current
```

### 3. 添加远程地址

如果 `git remote -v` 没有输出，执行（将地址替换为自己的 SSH 地址）：

```bash
git branch -M main
git remote add origin git@github.com:kiki-github1/week01_c_project.git
git remote -v
```

如果已经存在名为 `origin` 的远程地址，不要再执行 `git remote add`。需要更改地址时使用：

```bash
git remote set-url origin git@github.com:kiki-github1/week01_c_project.git
```

### 4. 第一次推送

```bash
git push -u origin main
```

成功后刷新 GitHub 仓库页面，就能看到文件和提交记录。`-u` 会把本地 `main` 与远程 `origin/main` 关联起来，之后通常直接执行 `git push` 即可。

> 如果你还没有成功创建 GitHub 远程仓库、SSH 测试失败，或远程地址不是 `main` 对应的空仓库，先查看报错，不要反复执行初始化命令。

## 四、以后每天开发的常规流程

每次修改代码后，在项目目录执行：

### 1. 查看状态

```bash
git status
```

### 2. 检查修改内容（推荐）

```bash
git diff
```

### 3. 把修改放入暂存区

```bash
git add main.c calc.c calc.h README.md
```

也可以用 `git add .` 添加当前目录下所有未被忽略的更改；提交前建议先运行 `git status` 检查，避免把可执行文件、临时文件或密钥加入仓库。

### 4. 创建本地提交

```bash
git commit -m "Explain what changed"
```

例如：

```bash
git commit -m "Add UART frame parser"
```

### 5. 上传到 GitHub

```bash
git push
```

记忆顺序：**编辑代码 → `git status` → `git diff` → `git add` → `git commit` → `git push`**。

## 五、查看历史与排错

```bash
git log --oneline
git status
git remote -v
git branch --show-current
```

- `git log --oneline`：查看本地提交历史。
- `git status`：查看尚未提交的修改。
- `git remote -v`：查看远程仓库地址。
- `git branch --show-current`：查看当前分支。

常见提示：

- `nothing to commit, working tree clean`：当前没有尚未提交的修改，不代表已推送到 GitHub。
- `Permission denied (publickey)`：SSH 公钥未配置到账号、密钥未被 SSH 使用，或地址有误。
- `remote origin already exists`：已经有 `origin`，先用 `git remote -v` 查看，不要重复添加。
- `src refspec main does not match any`：检查当前分支名以及是否已经有至少一次提交。

## 六、C 语言项目建议加入 `.gitignore`

在项目目录创建 `.gitignore`，可加入：

```text
*.exe
*.o
*.obj
*.layout
*.depend
*.bak
```

这些通常是编译输出或 IDE 临时文件。若某个生成文件已经被 Git 跟踪，后来加入 `.gitignore` 不会自动取消跟踪；需要另行处理。

## 七、每周学习结束前的提交习惯

每完成一个可以运行的小功能，就提交一次，例如：

```bash
git add .
git commit -m "Add bit-field example"
git push
```

提交说明尽量写清楚做了什么，不要总写 `update`。项目 README 可以记录用途、文件说明、编译方法和测试结果。
