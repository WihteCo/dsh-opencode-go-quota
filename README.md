# dsh-opencode-go-quota

**English** — OpenCode Go quota in the DeepSeek Harness sidebar foot, directly under the workspace/session list. One 42px cell shows the most constrained window; hovering or clicking opens a popover with the rolling 5-hour, weekly and monthly windows, each carrying a usage bar, an elapsed-time marker (so you can tell whether you are burning faster than the clock), the remaining share and a reset countdown. A Host half serves `GET /api/opencode-go-quota` from OpenCode's official usage endpoint (`https://opencode.ai/zen/go/v1/usage`) using the key already in the DSH credential store, so the key never reaches the browser. The collapsed 56px rail shows the percentage as a number.

---

在 DeepSeek Harness 网页版**左侧边栏最底部**（「工作区 / 会话列表」下方、与「设置」同排）显示
**OpenCode Go 订阅额度**的 DSH 插件。

## 显示内容

| 区域 | 内容 |
| --- | --- |
| 展开的侧边栏 | **一行 42px 的单元格**：`◯ OpenCode Go ………… 本月 18%`。左边的小圆环本身就是进度指示，右边是最紧张那一档的已用百分比 |
| 收起的侧边栏（56px 竖条） | 一个 36px 圆形按钮，直接显示百分比数字 |
| 悬停 / 点击 | 弹出一个 320px 浮层：每一档一行，含 6px 用量条、**时间进度标记**（窗口已经过去多少，用来判断你是用得比时间快还是慢）、剩余百分比与重置倒计时 |
| 浮层里的「刷新」 | 立即重新拉取（绕过 Host 端 30 秒缓存） |

浮层里每档的三行含义：

```
5 小时窗口                        已用 8%
▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   ← 填充=已用；竖线=时间进度
剩余 92%            时间已过 46%      2 小时 12 分钟后重置
```

* 竖线在填充右边 → 你比时间用得慢，安全；竖线在填充左边 → 比时间快，要收着点。
* `本月` 的时间进度带 `≈`，因为计费周期的起点不在接口里，是按「重置时间往前推一个自然月」估算的；`5 小时窗口` 和 `本周` 是精确值（5 小时 / 7 天）。

颜色：`< 70%` 品牌蓝，`70%–89%` 黄色，`≥ 90%` 红色，取不到数据显示为灰色 `--`。

## 数据来源

* Host 半边 `GET /api/opencode-go-quota`（同源、拒绝跨站调用）。
* 上游是 OpenCode Go 官方额度接口 `https://opencode.ai/zen/go/v1/usage`，
  响应形如：

  ```json
  {"usage":{
    "rolling":{"status":"ok","percent":5,"resetsAt":"2026-10-07T06:00:12.000Z"},
    "weekly":{"status":"ok","percent":5,"resetsAt":"2026-10-12T00:00:00.000Z"},
    "monthly":{"status":"ok","percent":17,"resetsAt":"2026-10-28T11:29:15.000Z"}}}
  ```

* 鉴权用你**已经存好**的凭据 `OPENCODE_GO_API_KEY`（就是 `opencode-go`
  provider 在 `cordis.patch.yml` 里 `apiKeyEnv` 指向的那一个）。
  **API Key 只留在 Host 进程，永远不会下发到浏览器。**
* 页面每 **60 秒**自动刷新一次；Host 端另有 30 秒缓存，点击卡片可立即强制刷新。
* 上游返回 `cache-control: no-store`，即接口本身不做缓存；数字会随着你（或任何其他机器）正在使用 OpenCode Go 而实时上涨。
* 三档的官方含义（与 OpenCode 面板一致）：`rolling` = 滚动 5 小时窗口、`weekly` = 本周（周一 UTC 重置）、`monthly` = 当前计费周期。接口数字是**全账号**口径，包含其他机器的用量。

## 目录结构

```
dsh-opencode-go-quota/
├── package.json        # dsh.bundle.patch + dsh.client（platform: web, immediately）
├── cordis.patch.yml    # 插入 id: opencode-go-quota 的 loader 行
├── index.js            # Host 半边：/api/opencode-go-quota 路由
├── client.js           # Client 半边：window.__ModuleLoader__ 工厂，注册进 sidebar.footer.action
├── locale/{en,zh}.json # 插件列表里显示的标题与说明
├── icon.svg            # 插件卡片图标
└── README.md
```

## 安装 / 卸载

安装（已在本机 desktop profile 装好）：

```
plugin_manager  action=install_bundle  target=<本目录或 file:/绝对路径>
```

卸载：

```
plugin_manager  action=remove_bundle   target=dsh-opencode-go-quota
```

临时停用：`plugin_manager action=set_plugin target=opencode-go-quota enabled=false`。

安装后无需重启即可生效；若浏览器页面没有立刻出现，刷新一次页面即可。

## 排查

* 卡片显示红色错误文字：把鼠标停在上面看完整信息。
* `凭据 OPENCODE_GO_API_KEY 未配置` → 在「设置 → 模型」里给 `opencode-go` 填 API Key。
* `额度接口返回 401` → Key 失效或已轮换，重新填一次。
* 直接验证 Host 半边：

  ```bash
  curl -s http://127.0.0.1:19387/api/opencode-go-quota
  ```
