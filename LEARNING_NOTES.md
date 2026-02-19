# ModelViewer 开发学习记录（提问与纠错）

本文档整理了本次开发中你提出的关键问题、过程中出现的误判/错误，以及最终修正方案，便于后续复盘。

## 1. 交互失效与布局错位

### 问题
- 拖拽无效、上传按钮不可点，页面看起来“光秃秃”。

### 过程中的错误/偏差
- 只从逻辑层排查，未第一时间确认 DOM 层级与点击命中。
- UnoCSS attributify 写法不规范（如 `absolute="~ top-4 left-4"`），导致定位没有按预期生效。

### 根因与修正
- 根因 1：`canvas` 覆盖了 UI 层，按钮命中被挡。
  - 修正：明确分层（canvas 0 层、信息/状态/按钮更高层），保证可点击。
- 根因 2：attributify 用法错误。
  - 修正：改成语义明确的属性化写法（如 `absolute` + `top-4` + `left-4` / `inset-0`）。

---

## 2. UnoCSS 与 SCSS 的边界

### 你的要求
- UnoCSS 用于布局/尺寸/盒子/定位。
- 字体、颜色、背景等视觉样式放在 SCSS。

### 纠偏结果
- 模板中布局统一为 attributify。
- 视觉细节（背景渐变、颜色、字号、阴影、圆角）集中在 `scoped lang="scss"`。

---

## 3. Vue 3.5 写法

### 你的要求
- 使用 Vue 3.5 推荐语法。

### 修正
- 模板引用改为 `useTemplateRef`，避免旧式模板 ref 写法混用。

---

## 4. 离线解码器支持（DRACO / KTX2 / Meshopt）

### 问题
- 在线 CDN 解码路径不可用。

### 修正
- 将解码器资源放到本地静态目录：
  - `public/draco/gltf/`
  - `public/basis/`
- 代码改为本地路径：
  - `dracoLoader.setDecoderPath('/draco/gltf/')`
  - `ktx2Loader.setTranscoderPath('/basis/')`

---

## 5. `.gltf + .bin` 同时拖拽仍报错

### 现象
- `THREE.GLTFLoader: Failed to load buffer "robot_data.bin"`

### 过程中的错误
- `resolveAssetUrl` 对 `http(s)` URL 过早放行，未进入本地文件映射。
- 路径标准化对 query/hash 处理不完整，匹配不稳定。

### 修正
- 增加统一路径标准化：
  - 去掉 `?query`、`#hash`
  - 统一斜杠
  - 兼容 `./`、`/`、`blob:`
- 增加 `findAssetFileByUrl`：同时尝试
  - 原始 URL
  - `new URL(url, window.location.href).pathname`
  - basename
- 匹配到文件后动态生成 blob URL，加载后回收。

---

## 6. `setURLModifier` 与 `onLoad` 的作用

你提到的代码：

```ts
loadingManager.setURLModifier((url) => resolveAssetUrl(url))
loadingManager.onLoad = () => {
  window.setTimeout(() => revokeTransientResourceUrls(), 0)
}
```

### 解释
- `setURLModifier`：拦截 GLTFLoader 每个外部资源请求（bin/纹理），把模型里引用的路径重写到本地文件 blob URL。
- `onLoad`：本轮资源全部加载结束后统一回收临时 URL，避免内存泄漏。
- `setTimeout(..., 0)`：让回收动作在当前加载调用栈结束后执行，避免过早释放。

---

## 7. `FileReader` vs `URL.createObjectURL`

### 区别
- `FileReader`：把文件内容读进 JS 内存（ArrayBuffer/Text/DataURL）。
- `createObjectURL`：给文件生成临时 URL，交给加载器按 URL 机制处理。

### 本项目为什么选 URL
- GLTFLoader 天然按 URL 请求资源。
- `.gltf` 多文件依赖（`.bin`/纹理）更适合用 URL 映射链路处理。
- 内存压力更可控，管理上更贴合 loader 生态。

---

## 8. `extensionsRequired` / `extensionsUsed` 展示逻辑

### 你的纠正
- 必需扩展不应只限压缩扩展，不能用固定白名单过滤。

### 修正
- 面板改为展示模型原始声明：
  - `extensionsRequired`（加载必须支持）
  - `extensionsUsed`（声明使用）
- 去掉压缩扩展固定过滤。

---

## 9. 面板与空态交互增强

### 新能力
- 左上 panel 可拖动、可收起，收起后仍可拖动。
- 中央拖拽区支持点击触发文件选择（同时支持 Enter/Space）。

---

## 10. 工程规范与工具链

### 规范落地
- Bun-only 依赖管理规则写入 `AGENTS.MD`。
- Vite 配置迁移：仅迁入 `vite-plugin-restart`，其余按项目需要选择。

### 一次命令错误的教训
- 把多条 git 命令混在同一 command 字符串里执行，导致参数串扰（出现 `unknown switch 'M'`）。
- 改进：命令串行用 `&&`，且每条命令语义保持单一。

---

## 11. 排查与修复方法论（复用）

1. 先确认现象：UI 命中、层级、事件是否触发。  
2. 再看路径链路：模型 URI -> URL 重写 -> 本地文件映射。  
3. 最后看资源生命周期：创建 URL 与回收 URL 是否成对。  
4. 每次改动都做最小验证：`lsp_diagnostics` + `build` + `test` + 浏览器交互验证。

---

## 12. 你这轮提问带来的关键收益

- 从“能加载”升级为“可维护的本地多文件模型加载链路”。
- 从“功能可用”升级为“交互可靠 + 语义清晰 + 文档完整”。
- 对 Three.js 资源加载机制（URL 重写、扩展声明、解码器本地化）形成可复用认知。
