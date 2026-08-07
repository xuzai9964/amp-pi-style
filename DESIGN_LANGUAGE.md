# Grok-informed Agent TUI 设计语言

> **一句话定义：** 把终端设计成一份会实时更新的工程工作记录：默认平静，执行过程可感知，细节按需展开，重要状态永远靠近注意力中心。

本文不是 xAI 或 Amp 官方发布的 Design System，而是根据 Grok Build 开源实现、Amp 文档和本仓库实现蒸馏出的设计模型。具体颜色、符号和组件可能随上游变化；本文关注的是更稳定、可迁移的设计原则。

## 证据边界

文中的结论分为四类：

- **上游事实**：Grok Build 源码或 Amp 文档直接确认的行为。
- **视觉观察**：官方界面录像中反复出现的模式。
- **设计推断**：多个行为共同指向的原则。
- **复用规范**：适合用于其他 CLI 的建议，不代表 xAI 或 Amp 官方标准。

主要来源：

- [xai-org/grok-build](https://github.com/xai-org/grok-build)
- [Amp Owner's Manual](https://ampcode.com/manual)
- [Look Ma, No Flicker](https://ampcode.com/news/look-ma-no-flicker)
- [Command Palette, Not Slash Commands](https://ampcode.com/news/command-palette)
- [Towards a New CLI](https://ampcode.com/news/towards-a-new-cli)
- [Frequently Ignored Feedback](https://ampcode.com/notes/fif)
- [Command Line Interface Guidelines](https://clig.dev/)
- 本仓库的 `extensions/amp-style.ts` 与两套主题

---

## 一、Agent TUI 真正设计的是注意力

Grok Build 的深色背景、`❯`、Braille spinner、`◆`、`✗` 和紧凑工具行只是表层。真正需要设计的是用户在一次长时间 Agent 运行中的注意力分配：

```text
第一层：现在发生了什么？
Thinking / Running / Editing / Failed

第二层：发生在什么对象上？
command / path / file count / diff stats

第三层：结果是否值得查看？
completed / ✗ failure / +N -M

第四层：具体发生了什么？
展开后才显示日志、推理、diff 和完整输出
```

用户通常只需要前三层。第四层存在，但不应持续占据屏幕。因此，核心不是单纯的 minimalism，而是：

> 以最低视觉成本，维持用户对系统状态的正确理解。

---

## 二、九条根原则

### 1. Transcript First：屏幕首先是一份工作记录

Amp 不把对话渲染成聊天软件里左右对齐的气泡，而更接近工程日志、编辑记录、命令历史和可展开的执行报告。

这让界面能够：

- 自然使用完整终端宽度；
- 让代码、diff、命令和自然语言处于同一阅读流；
- 在长线程中保持线性可扫描性；
- 减少复制内容时混入的视觉噪声；
- 让用户关注“工作发生了什么”，而不是“谁说了什么”。

**复用规则：**

- 默认使用单列线性信息流。
- 不给每条消息都添加背景、边框、圆角和头像。
- 只有需要交互、状态隔离或错误强调的内容才成为卡片。
- 容器数量越少，真正出现的容器越有意义。

### 2. Quiet by Default：默认状态必须安静

模型、目录、上下文、费用、连接状态等信息可以存在，但不应同时抢夺注意力。它们适合出现在边界、底部、dim 色阶、短标签或按需弹层中。

信息应至少分为三档视觉响度：

| 响度 | 用途 | 表现 |
|---|---|---|
| Primary | 用户输入、最终结论、失败 | 正常或高亮前景色 |
| Secondary | 工具活动、路径、状态、元数据 | muted |
| Tertiary | 快捷键、URL、边界、统计 | dim |

信息存在，不等于信息必须持续抢夺注意力。如果大多数文字都使用强调色，就等于没有强调色。

### 3. Progressive Disclosure：先给结论，再给证据

最嘈杂的信息——工具调用、推理、命令输出和 diff——应默认折叠为摘要：

```text
◆ Read src/config.ts
◆ Edit src/config.ts +5 -1
✗ Run npm test
```

一张合格的工具摘要应在不展开的情况下回答：

1. 成功还是失败；
2. 做了什么；
3. 对什么做；
4. 影响有多大；
5. 是否可以查看更多（`ctrl+o` 展开）。

完整日志和参数仍应保留，但只在用户主动展开时出现。

### 4. Semantic Compression：压缩重复，而不是隐藏意义

Agent 一次任务可能连续读取或编辑许多文件。逐条保留会让用户失去整体感，同类连续动作应提升为工作摘要：

```text
◆ Read 8 files
◆ Ran 5 commands
◆ Ran 15 commands · 2 failed
◆ Edited 4 files +83 -17
```

语义压缩不是简单地“少显示”，而是把事件序列提升为工作摘要。

```text
不够好：Done
更好：  ◆ Read 4 files
```

摘要不能丢失动作类型、对象规模和失败数量。

### 5. State Has a Home：每类状态只有一个固定住所

| 状态 | 推荐位置 |
|---|---|
| 用户正在输入什么 | Composer |
| Agent 当前阶段 | Composer 附近或固定状态栏 |
| 某个工具是否成功 | 对应工具卡片 |
| 全局运行状态 | 固定底栏或输入框边界 |
| 模型、上下文、费用 | 低响度边界区域 |
| 完整日志 | 展开详情 |
| 命令与功能发现 | Command Palette |
| 多线程状态 | 可显隐侧栏 |

对每一项信息都应询问：如果删除这里，用户还能否在另一个稳定位置看到它？如果答案是能，通常应该删除一处。

### 6. No Flicker：空间稳定性就是视觉质量

Amp 官方把 no flicker 单独作为 TUI 的产品里程碑。对实时 Agent 界面来说，布局稳定不是实现细节，而是核心视觉品质。

**稳定性规则：**

- 固定区域的高度尽量固定。
- 状态变化尽量替换字符，而不是插入整行。
- Spinner 必须等宽。
- 运行态与完成态尽量保持相同高度。
- 内容流式进入时不要抢走用户的滚动位置。
- Popup 应覆盖内容，而不是把主内容挤开。
- 长状态文本必须截断，不能推坏边界。
- 即使隐藏状态文本，也可保留其布局高度，避免界面上下跳动。

动得流畅，不如不乱动。

### 7. Motion Means Activity：动画只表达系统仍然活着

Grok 风格中的活动动画很小且等宽：

```text
⠋ → ⠙ → ⠹ → ⠸ → ⠼ → ⠴ → ⠦ → ⠧
```

它们没有面积变化，也不会重排布局，只表示 Agent 仍在思考、工具仍在运行或请求没有卡死。

**动画规范：**

- 动画字符尽量等宽。
- 一种动画只代表一种状态类别。
- 完成后移除 spinner，失败后收敛为 `✗`。
- 不要让多个 spinner 同时竞争注意力。
- 动画频率应可感知，但不能成为视觉噪声。
- 声音只用于任务完成或需要用户输入等关键时刻。

### 8. Keyboard First, Discoverable Always：效率与可发现性并不冲突

Amp 把 `Ctrl+O` 作为最重要的快捷键，用来打开全局 Command Palette。Palette 取代 slash commands 后：

- 执行命令不需要修改当前 prompt；
- 即使 editor 没打开也能访问；
- 可以从任意界面状态调用；
- 输入 `/` 仍可打开 Palette，保留旧习惯。

成熟的 Palette 应：

- 居中覆盖，而不是改变原布局；
- 降低背景响度，让 Palette 成为唯一焦点；
- 打开后立即获得搜索焦点；
- 输入时实时过滤；
- 用高对比状态显示当前选择；
- 将快捷键右对齐；
- 以领域前缀组织命令，例如 `thread:`、`plugins:`；
- 快速出现和消失，不使用冗长转场。

不要在主界面永久摆放几十个按钮。把低频动作放进统一、可搜索的空间。

### 9. Opinionated Defaults：减少控制项也是界面设计

Amp 不要求用户先知道哪个模型适合哪个任务，而是询问更贴近用户目标的问题：这项任务有多难？底层的模型、provider、prompt、tools 和 reasoning 被映射为少量任务模式。

好的默认值会直接减少：

- 设置面板；
- 状态标签；
- onboarding 文案；
- 错误路径；
- 用户焦虑；
- 视觉噪声。

如果用户不具备做出正确选择所需的信息，就不要把选择直接暴露给他。

---

## 三、视觉语法

### 1. 画布：fullscreen 接管终态，所有普通内容共享一种底色

这套插件的第一视觉签名不是卡片，而是一整块连续的冷黑哑光工作面。fullscreen 模式下，扩展在 TUI 最终帧统一绘制 `vars.canvas`：每个被改写的 cell、ANSI reset 后的片段和行尾剩余宽度都重新落回同一底色。这样即使终端透明、模糊或使用异色主题，transcript、prompt 与 footer 之间也不会出现壁纸渗漏或终端默认色“破洞”。

普通内容不建立独立 surface：

- 用户消息、assistant 正文、thinking、工具摘要、live status、composer 内部和 footer 共用 canvas；
- selection、overlay、视觉选择和语义 diff 是少数允许抬升的表面；
- focus 不切换背景，只把中性 prompt border 从 `#323237` 提升到 `#505058`；
- inline 模式继续继承终端，避免向 shell scrollback 写入整行底色；
- `AMP_PI_CANVAS=#…` 覆盖 canvas，`AMP_PI_CANVAS=0` 恢复终端继承。

统一画布不是把所有内容压成同一层。层级改由前景灰阶、字重、符号、缩进和稳定空白承担。品牌也主要通过这些要素表达，而不是通过一堆略有不同的黑色矩形。

### 2. 色彩：角色优先于色值

先定义颜色角色，再选择具体色值：

```text
foreground      主文本
muted           次要说明
dim             元数据、快捷键、边界说明
border          普通边界
border-active   当前焦点
accent          用户输入、选择、品牌
success         完成
warning         高负载、风险、特别状态
error           失败
diff-add        新增
diff-remove     删除
```

颜色使用纪律：

- Accent：当前焦点、用户输入、选择和少量品牌标记。
- Green：成功或增长，不用于普通装饰。
- Red：失败、删除和危险。
- Yellow/Orange：活动、警告或特殊模式。
- Blue/Cyan：链接、类型和辅助代码语义。
- Dim gray：有用但不紧急的信息。

建议的视觉占比：

```text
普通文本       60–75%
muted/dim      20–35%
accent/status   5–10%
error           仅异常时
```

### 3. 排版：依靠角色差异，而不是字号差异

终端通常不能自由控制字号，因此应依靠以下手段建立层级：

- normal / dim；
- regular / bold；
- normal / italic；
- 前缀符号；
- 缩进；
- 空行；
- 边界；
- 颜色。

例如用户消息可以呈现为：

```text
❯ 帮我修复认证状态竞争问题
```

`❯` 建立输入身份，垂直节奏建立任务边界，不再需要气泡、头像、`YOU` 标签或另一块背景；换行继续与正文起始列对齐。

### 4. 空间：紧凑不等于拥挤

推荐的稳定节奏：

```text
用户消息
空一行
Agent 正文
空一行
工具摘要
空一行
下一段正文
```

- fullscreen 根布局统一保留左右各 2 列 gutter，transcript 与 dock 共用基线；
- 同一语义块内部不留多余空行。
- 不同语义块之间固定留一行。
- 展开详情内部使用缩进，而不是继续堆空白。
- 列表、代码和 diff 保留各自结构。
- Renderer 只能压缩视觉，无法修复模型本身的啰嗦。

### 5. 图标：符号必须像语法，而不是插画

| 符号 | 语义 |
|---|---|
| `❯` | 用户输入 |
| `⠋` / `⠙` / `⠹` | 正在思考或执行 |
| `◆` | 已完成的一组工具或一个已聚合的工作摘要 |
| `┃` | 展开中的思考正文（`ctrl+t` 切换可见性） |
| `✗` | 失败 |
| `+N` | 新增 |
| `-N` | 删除 |
| `…` | 截断或省略路径 |
| `↑ N more` | 上方还有内容 |
| `↓ N more` | 下方还有内容 |

核心状态不应依赖 Emoji。Emoji 的宽度、颜色和平台渲染不可控。`ctrl+o` 是展开工具详情的统一手势，不需要在每个摘要行上常驻 `▸` 提示符。

---

## 四、组件系统

### 1. User Prompt Echo

```text
❯ 检查一下这个模块为什么会死锁
```

职责：建立任务边界。

- 使用 `❯` prompt arrow 和上下留白，不使用独立消息底色；
- 正文使用常规字形；
- 自动换行时使用两列对齐缩进；
- 与 assistant output 保留一个空行。

### 2. Assistant Prose

```text
死锁来自两个并行任务以相反顺序获取锁。
```

职责：承载解释和结论。

- 接近纯 Markdown；
- 正文使用普通前景色；
- 标题、列表和代码只做必要强调；
- 不添加 `Assistant` 标签；
- 不给每段套容器；
- 最终结论应比过程更容易扫描。

### 3. Activity Line

```text
⠋ Searching 2 patterns…
⠋ Running 3 commands…
⠋ Reading 1 file…
⠋ Editing 2 files…
```

职责：回答“现在正在做什么”。Activity 文案应使用“动词 + 对象 + 数量”，而不是泄漏内部工具名。运行时它出现在编辑器上方的 turn-status 行，空闲时该行保持一个稳定的空行，避免编辑器上下跳动。

```text
不够好：Running finder
更好：  Exploring 2 searches
```

### 4. Tool Summary Card

```text
◆ Read src/auth.ts
◆ Edit src/auth.ts +12 -4
✗ Run npm test
```

职责：压缩执行历史。

```text
Pending → Running → Completed
                  └→ Failed  ✗
```

运行态、成功态和失败态应尽量保持相同高度。`◆` 标记已完成行，运行行使用静态圆点，把唯一的 Braille spinner 留给 turn-status 行；失败保留 `✗`。`ctrl+o` 统一展开为完整诊断详情。

### 5. Composer

Composer 是用户注意力的重置点，但只保留最低响度的状态带。运行状态和位置不占用输入边框——活动移到 turn-status 行，cwd/git 移到 footer，边框只保留模型与思考模式：

```text
⠋ Editing 2 files…
╭────────────────────────────────────────╮
│ ❯ 下一条指令……                          │
╰─ claude-sonnet-4 ─ high ───────────────╯
~/repo/app ⭠ main           18%  ext status
```

关键规则：

- 中心始终是输入，`❯` 标识输入行；
- 边框空闲时使用 `#323237`，聚焦时只提升到中性 `#505058`，不调用 accent；
- 下边界只承载模型/模式信息；
- 运行状态有且只有一个住所：编辑器上方的 turn-status 行；
- 空间不足时低优先级信息先消失，footer 从右侧逐项丢弃。

### 6. Command Palette

```text
╭─ Command Palette ─────────────────────╮
│ > thread                              │
│                                      │
│ thread: archive              Ctrl+…  │
│ thread: new                  Ctrl+…  │
│ thread: set visibility               │
╰──────────────────────────────────────╯
```

职责：全局动作搜索、快捷键发现、设置入口和低频功能收纳。它不是另一个菜单，而是整个 TUI 的动作索引。

### 7. Sidebar

线程侧栏等持久面板应：

- 默认可隐藏；
- 不破坏主 transcript；
- 打开后获得独立焦点；
- 显示多线程或持久任务状态；
- 不把主界面永久变成 dashboard。

### 8. Notifications

通知适合两个关键时刻：

1. 工作完成，用户可能已离开终端；
2. Agent 被阻塞，需要用户输入。

运行过程中的每一步都通知，会让系统显得焦虑。在 SSH 等环境中可以退化为 terminal bell：保留语义，不依赖特定平台表现。

---

## 五、交互模型：把终端变成可操作文档

Amp 的完整 TUI 让 transcript 可以：

- 滚动；
- 选择；
- 点击；
- 展开；
- 复制；
- 搜索；
- 恢复历史；
- 编辑旧消息；
- 切换线程。

它既不是传统 shell，也不是聊天网页，而是 **keyboard-first interactive document**。它同时保留：

- 终端文本的可复制性；
- GUI 弹层的可发现性；
- IDE 的状态反馈；
- Shell 的直接性和组合能力；
- 对话的连续上下文。

---

## 六、工程约束也是设计语言的一部分

### 1. 正确计算可见列宽

终端中的 `string.length` 不等于显示宽度。必须处理：

- ANSI escape sequence：宽度 0；
- 零宽字符：宽度 0；
- CJK 字符：通常宽度 2；
- Emoji：可能宽度 2，且跨终端不同；
- combining marks；
- OSC semantic prompt sequence；
- 终端最右列的 hard wrap。

宽度计算错误会导致右边框错位、CJK 文本穿透、最后一列意外换行、spinner 抖动和截断错误。

### 2. 不要破坏 OSC 语义标记

Ghostty、iTerm2 等终端支持 OSC 133 semantic prompt。某些控制序列必须位于行首，视觉前缀应插在这些序列之后。

看不见的兼容性问题不应泄漏到视觉层。

### 3. 响应式降级必须有优先级

空间不足时按顺序删除或缩短：

1. 冗余分隔符；
2. 低价值统计；
3. 模型全名；
4. 中间路径段；
5. 低优先级右侧标签；
6. 最后才缩短主要动作和对象。

路径适合中间省略：

```text
~/Library/Application Support/project/src/auth
→ ~/Library/…/project/src/auth
→ ~/…/src/auth
```

保留路径开头和结尾，比只保留前 N 个字符更有定位价值。

### 4. 失败时退化，而不是崩溃

视觉增强层不应因为内部 API 改名而让 Agent 无法启动：

- API 存在才 patch；
- patch 保持幂等；
- 失败时恢复 stock UI；
- degraded state 只提示一次。

装饰层失败，功能层仍应可用。

---

## 七、常见错误

### 1. 只复制橙色、圆角和 `∴`

这只能得到 Amp cosplay。真正需要复制的是信息优先级、状态归位、工具压缩、渐进披露、布局稳定和决策简化。

### 2. 给所有内容加边框

边框越多，边框的语义越弱。边框应保留给当前输入焦点、Modal、diff、代码块、可交互区域和错误隔离。普通 assistant prose 不需要边框。

### 3. 同时展示所有实时数据

模型、token、费用、耗时、context、git、cwd、branch、模式、工具和网络状态全部常亮，会让界面退化为监控面板。重要状态应位于边界、弱化显示，并只在变化或异常时提高响度。

### 4. 为了简洁隐藏错误

成功可以压缩，失败必须保留可诊断性。失败摘要至少应显示命令和失败状态，展开后应看到 command、exit code、stdout/stderr、超时或终止原因，以及可复制的完整错误。

### 5. 用颜色承担全部语义

颜色可能因为主题、色盲、256 色映射、SSH、`NO_COLOR` 或输出重定向而失效。状态必须同时由符号和文字表达。

### 6. 动画导致布局变化

运行状态不应因为文本长度变化而推挤边框和相邻信息。优先使用定宽、短文本和等宽 spinner。

### 7. 模型输出啰嗦，却试图靠 Renderer 修复

Amp 风格需要模型行为配合：

- 不重复用户任务；
- 不宣布每一个工具调用；
- commentary 只报告重要发现；
- final 像工程交接；
- 列表只在提高扫描效率时使用；
- 不重新复述工具的原始输出。

---

## 八、从零实现

### 第一步：先定义事件模型

```ts
type UIEvent =
	| { type: "user-message"; text: string }
	| { type: "assistant-text"; text: string }
	| { type: "tool-start"; id: string; action: string; target?: string }
	| { type: "tool-end"; id: string; ok: boolean; summary: string }
	| { type: "diff"; files: number; added: number; removed: number }
	| { type: "agent-state"; phase: "thinking" | "running" | "idle" }
	| { type: "notice"; severity: "info" | "warning" | "error" };
```

视觉系统应是事件语义的投影，而不是先有外观再寻找内容。

### 第二步：建立信息优先级

| 信息 | 优先级 |
|---|---:|
| Agent 最终结论 | P0 |
| 工具失败 | P0 |
| 当前活动 | P1 |
| 修改文件和统计 | P1 |
| 完整命令输出 | P2 |
| 内部 tool arguments | P2 |
| 原始事件 JSON | P3 |

### 第三步：先做单色版本

关闭所有颜色后，界面仍应能依靠空间、缩进、符号、文案、边界和顺序表达清楚。随后依次添加 accent、success、error、warning 和 syntax colors。

### 第四步：实现折叠与摘要

```text
read    → Read <path>
edit    → Edit <path> +N -M
write   → Write <path> +N -M
bash    → Run <first command line>
search  → Search <query>
other   → <tool> <short description>
```

然后实现相邻同类事件聚合。

### 第五步：固定 Composer 和状态区

确保以下状态切换时布局不跳：

```text
idle
→ thinking
→ running one tool
→ running multiple tools
→ streaming
→ success
→ failure
→ retrying
→ compacting
```

录屏逐帧观察通常比截图更容易发现空间抖动。

### 第六步：加入 Command Palette

将 thread、mode、settings、plugins、editor、visibility、diagnostics 和 help 等低频动作统一放入 Palette，并支持 fuzzy search、分类、快捷键提示、禁用原因、全局调用和焦点恢复。

### 第七步：测试终端边界

至少覆盖：

- 24、40、80、120、200 列；
- 中文、日文、韩文路径；
- 超长命令和模型名；
- 256 色和 `NO_COLOR`；
- tmux 和 SSH；
- Ghostty、iTerm2、Kitty、WezTerm；
- 输出重定向；
- 不支持鼠标的终端。

---

## 九、实现检查清单

### 信息架构

- [ ] 主界面是否首先是一条清晰的 transcript？
- [ ] 用户输入、Agent 输出和工具动作能否一眼区分？
- [ ] 每类状态是否只有一个固定住所？
- [ ] 是否存在重复的模型、路径或 working 状态？
- [ ] 失败是否比成功更容易被发现？

### 密度

- [ ] 工具详情是否默认折叠？
- [ ] 同类连续动作是否可聚合？
- [ ] 摘要是否保留动作、对象、状态和规模？
- [ ] 块之间是否只有稳定的一层空白？
- [ ] 模型输出本身是否足够简洁？

### 视觉

- [ ] 关闭颜色后，层级是否仍然清楚？
- [ ] 是否有至少三档文字响度？
- [ ] Accent 是否只用于焦点和关键状态？
- [ ] 是否使用符号补充颜色语义？
- [ ] 边框是否只包围真正需要隔离的区域？

### 交互

- [ ] 所有动作是否可以通过统一 Palette 发现？
- [ ] 高频动作是否有快捷键？
- [ ] 旧习惯是否能平滑映射到新交互？
- [ ] Tool、thinking 和 diff 是否可展开？
- [ ] Sidebar 和辅助面板是否可以隐藏？

### 动态行为

- [ ] 流式输出时能否稳定滚动？
- [ ] Composer 是否始终留在固定位置？
- [ ] 状态变化是否会导致高度抖动？
- [ ] Spinner 是否等宽、低干扰？
- [ ] Popup 是否覆盖而不是推挤主布局？

### 工程质量

- [ ] 是否正确计算 ANSI 和 Unicode 显示宽度？
- [ ] CJK 路径是否不会破坏边框？
- [ ] 超长内容是否按优先级降级？
- [ ] `NO_COLOR` 下是否仍然可理解？
- [ ] 视觉增强失败时是否能回退到可用界面？

---

## 十、最终心法

如果只记住五句话：

1. **不要设计更多元素，要设计更少的注意力竞争。**
2. **默认展示摘要，细节永远可达。**
3. **实时系统的第一视觉品质是稳定，而不是动画。**
4. **颜色负责强化语义，不能创造语义。**
5. **真正高级的极简，是让用户少做错误决定。**

Amp CLI 之所以漂亮，并不是因为它“看起来像未来”，而是因为它让一个本来嘈杂、异步、不可预测的 Agent 工作过程显得有秩序、可理解、可控制、不焦虑且值得信任。

它最终形成的是：

> **编辑排版的阅读感 + IDE 的反馈能力 + Shell 的直接性 + Agent 的时间感。**
