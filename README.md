# Model Viewer

一个基于 `Vue 3 + Three.js` 的本地模型预览器，支持 `.glb/.gltf` 拖拽上传、离线解码器、可交互预览以及扩展信息查看。

## 功能特性

- 支持拖拽或点击选择文件（中心空态区、右下角按钮均可触发文件选择）。
- 支持 `.glb` 与 `.gltf`，并可同时选择关联的 `.bin` / 纹理文件。
- 内置离线解码能力：`DRACO`、`KTX2/Basis`、`Meshopt`。
- 左上角信息面板支持拖动、收起/展开（收起后仍可拖动）。
- 面板展示当前模型声明的：
  - `extensionsRequired`（加载必须支持）
  - `extensionsUsed`（模型声明使用）
- 使用 `OrbitControls` 进行旋转/缩放/平移，模型加载后自动取景。

## 技术栈

- `Vue 3.5` + `TypeScript`
- `Three.js 0.183`
- `Vite 7`
- `UnoCSS`（布局）+ `SCSS`（视觉样式）
- `Vitest`
- `Bun`（项目依赖管理）

## 环境要求

- Node.js: `^20.19.0 || >=22.12.0`
- Bun: `1.3+`
- 建议使用 `mise` 运行命令（与仓库规范一致）

## 快速开始

```sh
mise x -- bun install
mise x -- bun run dev
```

启动后访问终端输出中的本地地址（默认 `5173`）。

## 常用命令

```sh
# 开发
mise x -- bun run dev

# 构建（含类型检查）
mise x -- bun run build

# 单元测试
mise x -- bun run test:unit

# 代码检查与格式化
mise x -- bun run lint
mise x -- bun run format
```

## 使用说明

1. 将模型文件拖入页面，或点击中心区域 / 右下角 `选择文件`。
2. 如果是 `.gltf`，请把该模型引用的 `.bin` 与贴图文件一次性一起选择。
3. 加载成功后：
   - 可用鼠标进行视角交互。
   - 左上角面板查看扩展信息。

## 离线解码器资源

项目使用本地静态资源，不依赖在线 CDN：

- `public/draco/gltf/`
- `public/basis/`

对应加载路径在 `src/views/HomeView.vue` 中配置：

- `dracoLoader.setDecoderPath('/draco/gltf/')`
- `ktx2Loader.setTranscoderPath('/basis/')`

## 关键目录

```text
src/
  views/HomeView.vue        # 模型预览核心逻辑与界面
  main.ts                   # 应用入口
  assets/main.css           # 全局基础样式
public/
  draco/gltf/               # Draco 解码器文件
  basis/                    # Basis/KTX2 转码器文件
vite.config.ts              # Vite 配置（含 viteRestart 与构建输出策略）
```

## 常见问题

### 1) `Failed to load buffer "xxx.bin"`

通常是 `.gltf` 的依赖文件没一起选中，或文件名与引用不一致。

建议：
- 选择 `.gltf` 时同时选择其关联 `.bin` 与贴图文件。
- 确认引用路径与文件名一致（包含大小写）。

### 2) `extensionsRequired` 与 `extensionsUsed` 区别

- `extensionsRequired`: 模型加载必须支持的扩展。
- `extensionsUsed`: 模型声明使用过的扩展（不一定是强制）。
