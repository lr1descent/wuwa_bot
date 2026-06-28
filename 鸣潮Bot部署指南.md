# 鸣潮 QQ 群机器人部署全流程(gsuid_core + WutheringWavesUID)

> 目标:在云服务器(VPS)上部署一个鸣潮(Wuthering Waves)数据查询机器人,实现群里发 `ww面板`、`ww抽卡记录`、`ww签到` 等指令查询游戏数据。
> 方案:**NapCat(协议端,挂 QQ 号)+ gsuid_core(早柚核心,游戏查询框架)+ WutheringWavesUID(鸣潮插件)**。

---

## 架构示意

```
QQ 小号 ──► NapCat(协议端,挂号)
              │ 装 napcat-plugin-gscore-adapter(桥接插件)
              │ 连 ws://gsuid_core:8765/ws/{bot_id}?token=xxx
              ▼
         gsuid_core(早柚核心)
              │
         WutheringWavesUID(鸣潮插件)
```

- **NapCat**:模拟 QQ 客户端登录,负责收发群消息(协议端)
- **napcat-plugin-gscore-adapter**:装在 NapCat 里的**桥接插件**,把 OneBot 协议翻译成早柚核心的原生协议
- **gsuid_core**:游戏数据查询核心框架,带网页控制台(原神/星铁/绝区零/鸣潮等都是它的插件)
- **WutheringWavesUID(WWUID)**:鸣潮专用插件,提供面板、抽卡、签到等功能

> ⚠️ **重要**:独立部署的 gsuid_core **只有 `/ws/{bot_id}` 一个连接端点,没有 `/onebot/v11/ws`**(那是 NoneBot 才有的路径)。所以必须用桥接插件接入,**不能**直接反向 WS 连 `/onebot/v11/ws`,否则一直 403。

---

## 这个 Bot 能做什么(常用指令)

| 功能 | 指令示例 | 说明 |
|---|---|---|
| **绑定账号** | `ww登录` | 扫码登录库街区,绑定 UID |
| **角色面板** | `ww面板`、`ww刷新面板` | 角色练度、声骸、伤害计算 |
| **抽卡分析** | `ww抽卡记录`、`ww导入抽卡` | 出货率、欧非统计 |
| **库街区签到** | `ww签到`、`ww开启自动签到` | 每日自动签到领奖励 |
| **体力/每日** | `ww体力`、`ww每日` | 结晶波片(体力)、数据坞、电台提醒 |
| **深境区** | `ww深塔`、`ww逆境深塔` | 深塔进度查询 |
| **群排行** | `ww排行` | 群内练度/伤害排行榜 |
| **角色攻略** | `ww<角色名>攻略` | 角色养成攻略图 |
| **帮助** | `ww帮助` | 查看完整指令列表 |

---

## 第 0 步:准备工作

| 项目 | 要求 |
|---|---|
| **VPS 系统** | Linux,推荐 Ubuntu 22.04 / Debian 12 |
| **配置** | 最低 1 核 2G(出图渲染吃内存,建议 2G 起) |
| **QQ 号** | ⚠️ **务必用小号**,非官方协议有封号风险 |
| **库街区账号** | 你自己的鸣潮账号(用于绑定查询) |
| **安全组/防火墙** | 放行端口 **6099**(NapCat WebUI)、**8765**(gsuid_core 控制台) |

---

## 第 1 步:安装 Docker

```bash
# 安装 Docker(官方一键脚本)
curl -fsSL https://get.docker.com | sh

# 启动并设置开机自启
systemctl enable --now docker

# 验证安装
docker --version
docker compose version
```

> 国内服务器慢可用:`curl -fsSL https://get.docker.com | sh -s -- --mirror Aliyun`

---

## 第 2 步:创建 docker-compose 配置

新建一个目录并写入配置文件:

```bash
mkdir -p ~/ww-bot && cd ~/ww-bot
```

把下面内容保存为 `~/ww-bot/docker-compose.yml`:

```yaml
services:
  # 协议端:挂 QQ 号
  napcat:
    image: mlikiowa/napcat-docker:v4.18.5   # ⚠️ 钉死 4.18.5!4.18.6+ 有插件白名单,装不了桥接插件
    container_name: napcat
    restart: always
    environment:
      - NAPCAT_UID=${NAPCAT_UID:-1000}
      - NAPCAT_GID=${NAPCAT_GID:-1000}
    ports:
      - "6099:6099"          # NapCat WebUI(扫码登录用)
    volumes:
      - ./napcat/config:/app/napcat/config
      - ./napcat/plugins:/app/napcat/plugins   # 桥接插件目录(必须,否则插件不加载)
      - ./ntqq:/app/.config/QQ
    networks:
      - ww_network

  # 游戏查询核心 + 鸣潮插件
  gsuid_core:
    image: docker.cnb.cool/gscore-mirror/gsuid_core:latest
    container_name: gsuid_core
    restart: always
    environment:
      - UV_HTTP_TIMEOUT=300
      - UV_HTTP_RETRIES=10
      - UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple   # 清华 pypi 镜像,装插件依赖快
    ports:
      - "8765:8765"          # gsuid_core 网页控制台 + WS
    volumes:
      - ./gscore/data:/gsuid_core/data
      - ./gscore/plugins:/gsuid_core/gsuid_core/plugins
      - gsuid_core_venv:/venv
    networks:
      - ww_network

networks:
  ww_network:
    driver: bridge

volumes:
  gsuid_core_venv:
```

> ⚠️ NapCat 镜像 **不要用 `:latest`**。4.18.6 起加了插件白名单(`not in official plugin whitelist`),第三方桥接插件一律被拒。v4.18.5 是最后一个能装第三方插件的版本。

> 两个容器在同一 `ww_network` 网络里,所以 NapCat 可用容器名 `gsuid_core` 直接连接,无需公网 IP。

---

## 第 3 步:启动容器

```bash
cd ~/ww-bot

# 传入当前用户 UID/GID 后启动
NAPCAT_UID=$(id -u) NAPCAT_GID=$(id -g) docker compose up -d

# 确认两个容器都是 Up
docker ps
```

---

## 第 4 步:NapCat 登录 QQ 小号

```bash
# 拿 WebUI 登录 token
docker logs napcat
```

日志里找到类似 `http://...:6099/webui?token=xxxxxx` 的地址,记下 **token**。

1. 浏览器打开:`http://你的VPS公网IP:6099/webui`
2. 输入 **token** 登录
3. 选择 **扫码登录** → 用 **QQ 小号手机客户端**扫码
4. 手机确认 → NapCat 显示已上线

---

## 第 5 步:用桥接插件连接 NapCat 和 gsuid_core

> ⚠️ **不要**用反向 WS 连 `/onebot/v11/ws`——独立部署的 gsuid_core 没这个端点,连了只会一直 403。正确方式是装桥接插件,它连的是 `/ws/{bot_id}`。

### 5.1 确认桥接插件就位

桥接插件 `napcat-plugin-gscore-adapter` 已包含在本仓库的 `./napcat/plugins/` 目录里(第 2 步已挂载进容器)。直接重启 NapCat 让它扫描加载:

```bash
docker restart napcat
docker logs napcat 2>&1 | grep -iE "plugin|gscore|Loaded"
# 看到 Loaded 1 plugins / napcat-plugin-gscore-adapter 即 OK
```

成功后在 NapCat WebUI(6099)里能看到「GScore 适配器」插件。

> 全新部署若没有这个插件,可从 NapCat 插件市场或插件作者发布页获取,整个文件夹放进 `./napcat/plugins/` 再重启。
> 若日志报 `not in official plugin whitelist`,说明 NapCat 版本 ≥ 4.18.6,回到第 2 步把镜像钉到 v4.18.5 并 `docker compose up -d --force-recreate napcat`。

### 5.2 设置连接 token(两边必须一致)

gsuid_core 默认拒绝非本机连接(桥接插件从容器内网 IP 连入),必须配 token。编辑 `~/ww-bot/gscore/data/config.json`:

```json
"WS_TOKEN": "改成你自己的一串随机字符",
```

重启核心:`docker restart gsuid_core`

### 5.3 配置插件

NapCat WebUI → 「GScore 适配器」插件 → 配置,填两项:

- **连接地址 `gscoreUrl`**:`ws://gsuid_core:8765`
  (⚠️ 用容器名 `gsuid_core`,**不能写 localhost**;只填到端口,**不要**加 `/ws/` 或 `?token=`,插件会自动拼)
- **连接 Token `gscoreToken`**:和上面 `WS_TOKEN` **一模一样**

保存后看日志确认握手:

```bash
docker logs gsuid_core 2>&1 | tail
# 出现 "/ws/napcat-xxxx ... [accepted]" + "connection open" 即连上
# 若是 403 / connection rejected:多半 token 不一致,或地址写成了 localhost
```

---

## 第 6 步:安装鸣潮插件 WutheringWavesUID

### 6.1 先把自己设成主人

装插件指令(`core安装插件`)需要**主人权限**(pm=0)。编辑 `~/ww-bot/gscore/data/config.json`,填你**自己的管理 QQ 号**(不是 bot 小号):

```json
"masters": ["你的QQ号"],
"superusers": ["你的QQ号"],
```

重启核心:`docker restart gsuid_core`

### 6.2 装插件(原版仓库已删,手动克隆活跃 fork)

> ⚠️ 原版 `tyql688/WutheringWavesUID` **已被作者删除(404)**,QQ 里发 `core安装插件WutheringWavesUID` 会克隆失败(超时/认证失败)。改用活跃 fork **`CM-Edelweiss/WutheringWavesUID`** 手动克隆,国内拉取套 `ghproxy.mihomo.me` 前缀加速:

```bash
docker exec gsuid_core git clone --depth 1 \
  https://ghproxy.mihomo.me/https://github.com/CM-Edelweiss/WutheringWavesUID.git \
  /gsuid_core/gsuid_core/plugins/WutheringWavesUID
```

> 若提示目录已存在(上次失败的残留),先删:`docker exec gsuid_core rm -rf /gsuid_core/gsuid_core/plugins/WutheringWavesUID`

让核心启动时自动装依赖——编辑 `config.json` 把 `AutoUpdateDep` 的 `data` 改成 `true`,然后重启:

```bash
docker restart gsuid_core
docker logs -f --tail 80 gsuid_core     # 看到 "插件WutheringWavesUID导入成功" / [鸣潮] 日志即成功
```

### 6.3 补全资源(首次必做,否则出图缺素材)

```
ww下载全部资源
```

---

## 第 7 步:绑定账号并测试

1. 用大号把 **机器人小号拉进 QQ 群**
2. 群里发:`ww登录`
3. 按提示**扫码登录库街区**(用你自己的鸣潮账号)
4. 绑定成功后测试:
   - `ww面板` → 出角色面板图 ✅
   - `ww每日` → 查体力/每日活跃
   - `ww签到` → 库街区签到

成功出图即部署完成!

---

## 第 8 步:对外开放给群友前的配置 & 安全检查

> 自己测通后要开放给群友使用,重点处理这几类。大部分配置在网页控制台 `http://你的公网IP:8765/app → 插件配置 → WutheringWavesUID` 里设。

### 🔴 必做(不配群友用不了)

1. **`WavesLoginUrl` = `http://你的公网IP:8765`**(必须带 `http://`,否则插件会自动套 `https://` 而你没 TLS,反而打不开)
   不配的话每个群友拿到的登录链接都是坏的 `0.0.0.0`。
2. **`WavesLoginUrlSelf` = `true`**(标题「强制【鸣潮登录url】为自己的域名」)
   ⚠️ **配了上面的自建地址就必须一起开这个!** 否则插件会把你的地址当成"外部官方登录服务",去 POST 一个你没有的 `/waves/token` 接口,报 `登录服务请求失败! 请稍后再试`。这俩是一对,缺一不可。
3. **公网放行 8765 端口**:登录链接要群友能打开。

### 🟠 强烈建议(否则群友常说"链接点不开")

QQ 会拦截/降权外部链接,下面三选一开启:

| 配置项 | 作用 |
|---|---|
| `WavesLoginForward` | 登录链接转成合并转发消息 |
| `WavesTencentWord` | 套腾讯文档跳转,绕过拦截 |
| `WavesQRLogin` | 变成二维码,手机直接扫(体验最好) |

### 🔒 安全(公网暴露,最易忽略也最危险)

- ⚠️ **6099(NapCat WebUI)绝对不要对公网开放!** 它能直接操控你的 QQ,暴露 = 号被接管。只在自己扫码登录时临时开,或防火墙限制到自己的 IP。
- 8765 必须公网(登录链接用),但控制台 `/app` 也在此端口——务必保证 **`REGISTER_CODE`、`WS_TOKEN` 是强随机串且不外泄**。
- 有域名的话,强烈建议 nginx 反代 + TLS。

### ⚙️ 防滥用 / 防风控(群人多了重要)

| 配置项 | 作用 |
|---|---|
| `RefreshInterval` | 面板刷新冷却,防群友狂刷把小号刷到风控 |
| `MaxBindNum` | 每人最多绑几个账号 |
| `AtCheck` | 是否需 @bot 才响应(防误触/刷屏) |

### 🙈 隐私

- `WavesOnlySelfCk`:所有查询只能用查询者自己的 ck(群友只能查自己绑的号)
- `HideUid`:出图隐藏 UID

### ✨ 可选

- **订阅公告**:开 `WavesAnnOpen`,群里发 `订阅公告`,游戏公告自动推送到群
- **自动签到**:群友各自发 `ww开启自动签到`(不用全局配),你保证核心在线即可

### 几个安心点

- **群功能默认开启**:bot 进群后群友直接发 `ww面板`/`ww帮助` 就能用,不需逐群开权限(要关某功能再单独关)。
- 群友用的是普通查询指令,不涉及主人权限。
- 人多并发出图更吃内存,建议 **2G 内存 + swap**。

**最小可用** = 改 `WavesLoginUrl` + 放行 8765 + 关闭 6099 公网;其余按群友反馈再逐步调。

---

## 常用维护命令

```bash
cd ~/ww-bot

docker compose ps            # 查看状态
docker compose logs -f       # 实时日志(排错)
docker compose restart       # 重启
docker compose down          # 停止删除容器(数据保留在 ./gscore、./napcat)

# 更新到最新版
docker compose pull && \
  NAPCAT_UID=$(id -u) NAPCAT_GID=$(id -g) docker compose up -d
```

插件相关指令(在 QQ 里发给 bot):

```
core更新插件WutheringWavesUID    # 更新鸣潮插件
core重启                         # 重启核心
ww下载全部资源                    # 补全/更新资源
ww帮助                           # 查看全部指令
```

---

## 常见排错速查

| 现象 | 原因 / 解决 |
|---|---|
| 控制台/WebUI 打不开 | 安全组没放行 6099/8765;`docker ps` 看容器是否 Up |
| NapCat 插件不显示 / `not in official plugin whitelist` | NapCat 4.18.6+ 的插件白名单。把镜像钉到 **v4.18.5** 并 `docker compose up -d --force-recreate napcat`(第 2 步) |
| gsuid_core 日志刷 `WebSocket /onebot/v11/ws ... 403` | 接法错了。独立 gsuid_core 没这个端点,删掉反向 WS,改用桥接插件连 `/ws/`(第 5 步) |
| 连接 403 / `connection rejected` | token 没对上。两边 `WS_TOKEN` 与 `gscoreToken` 要一致;插件地址别写 localhost,要用容器名 `gsuid_core` |
| `core安装插件` 没反应 | 没主人权限。把你的 QQ 填进 `config.json` 的 `masters`(第 6.1) |
| 插件克隆失败(404/认证失败/超时) | 原版 `tyql688` 仓库已删。改用 `CM-Edelweiss` fork 手动克隆(第 6.2);拉取慢套 `ghproxy.mihomo.me` 前缀 |
| QQ 扫码一直 `Login Error ErrCode:3` | 二维码超时没扫,或小号 VPS 异地登录被风控;先用手机正常登录养几天号 |
| `ww面板` 不出图/缺素材 | 先执行 `ww下载全部资源` |
| 出图很慢/容器 OOM | 内存不足,升级到 2G+ 内存 |
| 机器人频繁掉线 | QQ 小号被风控,换号或降低频率 |

---

## 进阶:同时要 AI 聊天 + 鸣潮查询?

一个 NapCat 支持**多个反向 WS 连接**,所以同一个 QQ 小号可以同时服务两个框架:

```
                    ┌──► AstrBot(AI 聊天)         ws://astrbot:6199/ws
QQ 小号 ──► NapCat ──┤
                    └──► gsuid_core(鸣潮查询)     ws://gsuid_core:8765/onebot/v11/ws
```

在 NapCat WebUI 里加两条反向 WS 客户端配置即可,群里 @它走 AI、发 `ww面板` 走鸣潮,互不冲突。
(AI 聊天部分见同目录《QQ机器人部署指南.md》。)

---

## 参考链接

- [gsuid_core(早柚核心)仓库](https://github.com/Genshin-bots/gsuid_core)
- [gsuid_core 官方文档](https://docs.sayu-bot.com/Started/DockerCore.html)
- ~~WutheringWavesUID 原版(tyql688)~~ —— **已被作者删除,勿用**
- [WutheringWavesUID 仓库(活跃 fork,实际使用)](https://github.com/CM-Edelweiss/WutheringWavesUID)
- [NapCat 仓库](https://github.com/NapNeko/NapCatQQ)

> ⚠️ 风险提示:NapCat 使用非官方协议登录 QQ,存在封号风险,请使用小号。库街区登录信息仅用于查询你自己的账号数据,请勿绑定他人账号。
