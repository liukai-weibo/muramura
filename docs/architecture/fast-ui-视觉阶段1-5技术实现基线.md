# fast-ui 视觉阶段 1-5 技术实现基线

> 状态：已封板的展示层技术基线
>
> 适用：`fast-ui` 分支当前客户端；后续展示层实现必须优先复用本文定义的边界。

## 技术结论

本阶段使用既有 Taro + React + Sass + Vite + Tauri 2 技术栈完成，未增加动画、样式或状态管理依赖。视觉状态保持在客户端展示层，数据读取仍由现有 API Client 与页面层处理；本阶段没有触及 Contracts、Application、Repository、MySQL、迁移或备份格式。

## 已使用的技术与框架

| 层级 | 已使用技术 | 本阶段职责 |
| --- | --- | --- |
| 页面框架 | Taro 4、React 18、TypeScript | 在桌面端和 H5 复用页面与组件结构。 |
| 样式 | Sass、CSS 自定义属性、媒体查询 | 主题 Token、深色覆盖、响应式布局、玻璃和兼容样式。 |
| 构建 | Vite、Taro H5 构建 | 生成静态 H5 资源；不需要新增前端构建链。 |
| 桌面壳 | Tauri 2、`@tauri-apps/api` | 标题栏、窗口控制、托盘既有能力与开发版运行。 |
| 本地偏好 | 浏览器 `localStorage` | 存储当前设备的主题和显示效果选择。 |
| 动效 | 原生 CSS `transform`、`transition`、`cubic-bezier` | 普通控件悬停、列表选中和卡片微动效。 |
| 性能降级 | `prefers-reduced-motion`、`data-display-effect` | 降低动态效果；兼容模式关闭页面模糊滤镜。 |
| 插画与桌宠 | 本地 PNG、现有 Rive 资源 | 静态猫咪线稿指南插图；Rive 只服务既有桌宠与 AI 页面。 |

## 代码职责与复用入口

| 文件或目录 | 责任 | 后续使用方式 |
| --- | --- | --- |
| `apps/client/src/pages/index/cream-ui-theme.scss` | 全局视觉 Token、浅深主题、表面、交互、兼容模式覆盖 | 新页面先使用本文件的变量和既有类；不要复制新的颜色体系。 |
| `apps/client/src/pages/index/index.scss` | 已有页面的结构布局与历史样式 | 仅处理组件自身布局；全局视觉覆盖仍进入 `cream-ui-theme.scss`。 |
| `apps/client/src/pages/index/display-effect-preference.ts` | `ColorTheme`、`DisplayEffectMode` 与安全本地读写 | 新展示层只读取类型和函数，不将偏好写入账户或业务数据。 |
| `apps/client/src/pages/index/home-dashboard/` | 首页行动主控台的展示组件 | 保持事项和 `DashboardReport.backlog` 由页面层传入。 |
| `apps/client/src/desktop/desktop-title-bar.tsx` | 桌面顶轨、主题按钮、窗口控制桥接 | 新增顶轨普通操作可复用控制类，但不能影响窗口控制。 |
| `apps/client/src/assets/home/guides/` | 三张已裁切的透明指南猫咪插图 | 仅作为指南和同画风展示复用的本地资源。 |
| `apps/client/src/assets/brand/` | 品牌猫资源 | 品牌识别使用；不替换功能性图标。 |

## 视觉状态模型

```text
应用根 .app-shell
├─ data-color-theme = light | dark
└─ data-display-effect = glass | compatible

ColorTheme
├─ 读取：readColorTheme()
├─ 写入：saveColorTheme()
└─ 键：marumaru.color-theme

DisplayEffectMode
├─ 读取：readDisplayEffectMode()
├─ 写入：saveDisplayEffectMode()
└─ 键：marumaru.display-effect
```

两种偏好均在初次渲染时安全读取。`localStorage` 不可用、读取异常或值非法时回退到浅色主题和玻璃效果；偏好异常不得阻止工作台渲染。

## CSS 复用约束

### Token

页面应优先使用以下变量，不在新增组件中复制浅色十六进制值：

- 画布与表面：`--cream-canvas`、`--cream-sidebar`、`--cream-surface`、`--cream-soft-surface`
- 文字与边界：`--cream-ink`、`--cream-body`、`--cream-hint`、`--cream-line`
- 选中态：`--cream-selection-start`、`--cream-selection-end`、`--cream-selection-line`、`--cream-selection-border`
- 阴影与动效：`--cream-shadow`、`--cream-shadow-pop`、`--cream-shadow-modal`、`--cream-transition`

### 交互类

- `card-transition`：普通信息卡；悬停时轻微上浮、缩放与暖调阴影。
- `control-transition`：普通按钮、页签、设置入口；仅用于不危险、不编辑、不拖拽的控件。
- `navigation-transition`：侧栏导航；横向小幅移动，不扩大相邻菜单。
- 已选中列表行使用暖粉渐变、左侧强调线和小幅位移；不可再以纯白悬停覆盖选中信息。

所有缩放类均包含 `will-change: transform` 和 `backface-visibility: hidden`。`prefers-reduced-motion: reduce` 下必须关闭新增的 transition、transform 与 will-change。

### 毛玻璃和兼容模式

- `soft-glass` 仅用于需要顶层感的指南卡，使用 `blur(12px)`。
- `soft-glass-fallback` 使用高不透明暖白表面和铅笔描边，并强制关闭模糊。
- 根元素为 `data-display-effect='compatible'` 时，所有后代的 `backdrop-filter` 与 `-webkit-backdrop-filter` 均必须为 `none !important`。
- 不把玻璃效果扩展到密集列表、输入区或默认 Hero；毛玻璃不是全局背景效果。

## 明确排除的实现方式

- 不引入 Tailwind、Framer Motion、react-spring、Lottie、Three.js 或新的 CSS 框架。
- 不以 JavaScript 逐帧驱动普通悬停动效；既有 Rive 和 AI 流式所需运行逻辑不在此限制内。
- 不新建全局主题状态库，不把视觉偏好同步到服务器、账户、备份或导出内容。
- 不在前端从时间、标题或计数猜测业务关系；首页焦点只基于真实 `doing` 事项的 `updatedAt` 排序。

## 验证基线

展示层变更完成后按风险执行：

1. `corepack pnpm typecheck`
2. `corepack pnpm --filter @knowledge-base/client build:h5`
3. `git diff --check`
4. 在 Tauri 开发版和 H5 复验浅/深、玻璃/兼容、窄屏、低动态效果及新增交互的可读性。

工程验证或 H5 人工验收完成后，按“增加项、修复项、未完成项”追加 `docs/daily-contributions/YYYY-MM-DD.md`。仅构建通过不等同于产品验收。
