# 社区家电维修预约与上门证据平台

## 原始需求

> 设计城市社区家电维修预约与上门证据页面，可使用 Vue 3、TypeScript 和 Pinia。居民提交冰箱、洗衣机、空调、热水器等设备的品牌、型号、故障、购买年限、楼层和可上门时段后，页面根据师傅技能、距离、配件库存和安全风险推荐预约。师傅到场后，需要上传设备外观、旧损、故障检测、报价项目和用户确认。维修过程中，页面记录更换配件、拆机照片、试机结果和收费明细。若用户临时增加项目、师傅发现高空作业风险、配件不匹配、报价争议或维修后故障复发，页面要让用户、师傅、客服和配件仓库围绕同一订单处理。维修完成后，质保期限、付款、评价、返修和配件追溯进入档案，帮助社区平台判断师傅可靠性和常见故障。社区平台还要按师傅、品类和配件统计返修率，判断哪些故障适合社区快修，哪些应转品牌售后。返修统计会影响师傅准入。平台还要把配件仓库和师傅日程联动，避免配件未到却安排上门。页面还要把上门证据、报价确认、配件追溯和质保返修连接起来，社区平台处理师傅纠纷或用户投诉时能还原维修全过程。

## 技术栈

- **前端**：Vue 3 + TypeScript + Pinia + Vue Router + Element Plus + ECharts（`web/`）
- **后端**：Node.js + Express + TypeScript（`server/`）
- **数据库**：PostgreSQL 16（compose 内部服务，不发布到宿主）
- **部署**：根目录多阶段 `Dockerfile`（前端构建 → 后端构建 → 非 root 运行时 + HEALTHCHECK），`docker-compose.yml` 一键启动

## 一键启动（验证方式 = 宿主 docker compose up）

```bash
cp .env.example .env   # 可选；评审环境 CC_PUBLISH_PORT 已由环境变量注入
docker compose up -d --build
docker compose ps      # 等待 app 健康（healthy）
docker compose port app 8080   # 查看实际映射端口，浏览器访问 http://localhost:<端口>
```

- 只有 **app** 服务发布到宿主（`${CC_PUBLISH_PORT}:8080`）；PostgreSQL 仅在 compose 内部网络，app 通过服务名 `db` 访问。
- 首次启动自动建表并写入演示数据（账号、配件库存、9 条完整归档订单、6 条进行中订单、返修与异常样例）。
- 端到端自测（可选）：栈启动后执行 `node scripts/smoke.mjs`（默认打 `http://host.docker.internal:3054`，可用 `BASE=http://host.docker.internal:<端口>` 覆盖），覆盖登录、推荐、配件联动拦截、签到取证、报价确认、维修完成、支付评价归档、质保返修、异常协同、统计准入、档案追溯共 51 项断言。
- 验证结束：`docker compose down`（加 `-v` 可同时清空数据卷）。

## 演示账号（逐角色）

| 角色 | 用户名 | 密码 | 权限说明 |
| --- | --- | --- | --- |
| 居民 | `user01` | `user123456` | 提交报修、查看推荐、预约师傅、确认/争议报价、支付、评价、申请返修 |
| 居民 | `user02` | `user123456` | 同上（另有进行中工单） |
| 维修师傅 | `tech01`（王师傅） | `tech123456` | 日程、到场签到、上传证据、提交报价、登记配件、完成维修；持高空作业证（空调/冰箱） |
| 维修师傅 | `tech02`（李师傅） | `tech123456` | 同上（洗衣机/热水器/冰箱） |
| 维修师傅 | `tech03`（赵师傅） | `tech123456` | 同上（全品类，返修率偏高，用于演示准入预警） |
| 客服 | `cs01` | `cs123456` | 异常处理中心：报价争议协调（要求重新报价/取消订单）、各类异常闭环 |
| 配件仓库 | `wh01` | `wh123456` | 配件库存、补货、出库、批次追溯；处理"配件不匹配"异常 |
| 社区平台 | `admin` | `admin123` | 统计看板（按师傅/品类/配件返修率）、师傅准入管理、订单档案库、异常总览 |

## 核心业务流程（建议演示路径）

1. **报修与智能推荐**：`user01` 登录 →「发起报修」填写品牌/型号/故障/购买年限/楼层/可上门时段 → 订单详情页展示推荐师傅（技能+距离+配件库存+安全风险+档期五项评分）。空调且楼层 ≥4 自动标记**高空作业风险**，无高空证师傅被扣分并警示。
2. **配件-日程联动**：若故障适配配件缺货（如"空调遥控接收板"库存为 0），预约会被拦截并提示"配件尚未到货，暂不能安排上门"；预约成功则自动**预留配件**并占用师傅档期。
3. **上门取证**：师傅（`tech01`）在工单工作台签到 → 上传设备外观/旧损/故障检测照片 → 提交报价 → 居民确认（或发起争议转客服）。
4. **维修过程**：报价确认后师傅开始维修 → 登记更换配件（批次号留痕）→ 上传拆机照片 → 填写试机结果与收费明细 → 完成自动生成 90 天质保。
5. **异常协同**：居民可"临时增加项目"；师傅可上报"高空作业风险/配件不匹配"；报价争议由客服处理（可要求重新报价）；配件不匹配由仓库处理；质保期内"故障复发"由居民发起，自动生成**返修单**（免费）并关联原单。
6. **档案与统计**：支付 → 评价 → 自动归档。`admin` 在「统计看板」查看按师傅/品类/配件的返修率与"社区快修 vs 转品牌售后"建议；「师傅准入」按返修率给出暂停/恢复建议；「订单档案库」可进入任一工单，通过时间线+证据+报价版本+配件追溯+异常记录**还原维修全过程**。

## 目录结构

```
├── Dockerfile             # 多阶段：web 构建 → server 构建 → 非 root 运行时（HEALTHCHECK）
├── docker-compose.yml     # app + db（db 不发布端口）
├── .env.example
├── server/                # Express + TS：认证/订单状态机/推荐算法/证据/报价/异常/配件/统计/种子数据
└── web/                   # Vue3 + TS + Pinia：五角色页面与共享订单详情（证据链视图）
```

## 主要接口（/api 前缀）

- 认证：`POST /auth/login`、`GET /auth/me`
- 工单：`POST /orders`、`GET /orders`、`GET /orders/:id`（完整档案）、`GET /orders/:id/recommendations`、`POST /orders/:id/schedule|checkin|quotes|start-repair|use-part|complete|pay|review|rework|cancel`、`POST /orders/:id/evidence`（multipart）
- 报价：`POST /orders/:id/quotes/:qid/confirm|dispute`
- 协同：`GET /exceptions`、`POST /orders/:id/exceptions`、`POST /exceptions/:id/resolve`
- 配件：`GET/POST /parts`、`POST /parts/:id/restock`、`GET /parts/:id/trace`、`GET /order-parts`、`POST /order-parts/:id/outbound`
- 平台：`GET /stats/overview`、`GET /stats/rework?group=technician|category|part`、`GET /technicians`、`PATCH /technicians/:id`、`GET /archives`

## 本地开发（可选）

```bash
# 后端（需本地 PostgreSQL，或先 docker compose up -d db）
cd server && npm install && DATABASE_URL=postgres://repair:repair123@localhost:5432/repair npm run dev
# 前端（代理 /api 与 /uploads 到 8080）
cd web && npm install && npm run dev
```
