# 鸣潮 QQ 群机器人部署全流程(gsuid_core + WutheringWavesUID)

> 目标:在云服务器(VPS)上部署一个鸣潮(Wuthering Waves)数据查询机器人,实现群里发 `ww面板`、`ww抽卡记录`、`ww签到` 等指令查询游戏数据。
> 方案:**NapCat(协议端,挂 QQ 号)+ gsuid_core(早柚核心,游戏查询框架)+ WutheringWavesUID(鸣潮插件)**。

---

## 架构示意

```
QQ 小号 ──► NapCat(协议端,挂号) ──OneBot v11 / 反向WS──► gsuid_core(早柚核心)
                                                              │
                                                    WutheringWavesUID(鸣潮插件)
```

- **NapCat**:模拟 QQ 客户端登录,负责收发群消息(协议端)
- **gsuid_core**:游戏数据查询核心框架,带网页控制台(原神/星铁/绝区零/鸣潮等都是它的插件)
- **WutheringWavesUID(WWUID)**:鸣潮专用插件,提供面板、抽卡、签到等功能

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
    image: mlikiowa/napcat-docker:latest
    container_name: napcat
    restart: always
    environment:
      - NAPCAT_UID=${NAPCAT_UID:-1000}
      - NAPCAT_GID=${NAPCAT_GID:-1000}
    ports:
      - "6099:6099"          # NapCat WebUI(扫码登录用)
    volumes:
      - ./napcat/config:/app/napcat/config
      - ./ntqq:/app/.config/QQ
    networks:
      - ww_network

  # 游戏查询核心 + 鸣潮插件
  gsuid_core:
    image: docker.cnb.cool/gscore-mirror/gsuid_core:latest
    container_name: gsuid_core
    restart: always
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

## 第 5 步:NapCat 配置反向 WS 连接 gsuid_core

在 NapCat WebUI 里:

1. 进入 **「网络配置」 / 「新增」**
2. 类型选 **「WebSocket 客户端」(反向 WS)**
3. **URL 填**:
   ```
   ws://gsuid_core:8765/onebot/v11/ws
   ```
   > 因为两容器在同一网络,直接用容器名 `gsuid_core`。
   > 如果 NapCat 不在同一 compose 里,改成 `ws://<VPS内网IP>:8765/onebot/v11/ws`。
4. **消息格式**:选 `array`
5. 保存并 **启用**

回到 gsuid_core 控制台日志确认连上:

```bash
docker logs gsuid_core
# 出现 OneBot v11 / bot 连接成功的日志即 OK
```

---

## 第 6 步:安装鸣潮插件 WutheringWavesUID

直接在 QQ 里**给 bot 发指令**(私聊 bot,或在群里 @bot):

```
core安装插件WutheringWavesUID
```

> 等价英文指令:`core install WutheringWavesUID`

安装完成后重启核心生效:

```
core重启
```

> 也可以在 gsuid_core 网页控制台(`http://你的VPS公网IP:8765/app`)的「插件管理」里图形化安装。

补全资源文件(首次必做,否则出图缺素材):

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
| NapCat 连不上 gsuid_core | 检查反向 WS 地址 `ws://gsuid_core:8765/onebot/v11/ws`、消息格式选 `array`;看 `docker logs gsuid_core` |
| 403 错误 | gsuid_core 配了 token,NapCat 的 WS 地址要带 `?access_token=xxx` |
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
- [WutheringWavesUID 仓库(原版)](https://github.com/tyql688/WutheringWavesUID)
- [WutheringWavesUID 仓库(活跃 fork)](https://github.com/CM-Edelweiss/WutheringWavesUID)
- [NapCat 仓库](https://github.com/NapNeko/NapCatQQ)

> ⚠️ 风险提示:NapCat 使用非官方协议登录 QQ,存在封号风险,请使用小号。库街区登录信息仅用于查询你自己的账号数据,请勿绑定他人账号。
