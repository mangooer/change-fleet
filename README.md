# ChangeFleet

[简体中文](README.md) | [English](README.en.md)

> **一句话简介：** 一个本地优先的多 Agent 编程控制平面，在隔离 Git 工作空间中编排、比较和
> 审计不同 Agent，让一句任务目标持续推进为可审查的单仓库或多仓库变更。

ChangeFleet 是一个本地运行、规范优先的控制平面，用于协调一个或多个 Git 仓库中的变更，
并保留可审计的执行证据。

编程 Agent Runtime 负责分析仓库、制定计划、实现代码和选择任务检查。ChangeFleet 为这些工作
提供隔离工作空间，并维护必须可靠的控制事实：已授权的仓库和分支、精确 Git 主体、Runtime
证据、人类决定、审查、恢复和交付状态。

> **项目状态：** ChangeFleet 目前是尚未发布的本地原型。CLI、HTTP 接口、存储格式和操作流程
> 都还不是稳定的公共契约。

## 控制台预览

在一个本地控制台中管理多个任务，查看 Agent 对话、当前进度和审查状态。

![ChangeFleet 任务控制台，展示任务列表、Agent 对话、当前进度和候选变更审查](docs/assets/screenshots/task-console.png)

仅在需要时打开审计视图，检查每个工作步骤、执行结果、Runtime 用量、耗时、重试和返工次数。

![ChangeFleet 任务审计，展示 Runtime 用量和按时间排列的任务链路](docs/assets/screenshots/task-audit.png)

## 产品愿景

**管理一支编程 Agent 舰队，而不是守着一堆终端。**

ChangeFleet 希望成为一个不绑定 Provider 的多 Agent 控制平面：用户给出一个明确目标，系统就能
组织合适的 Agent、模型、仓库和质量 Gate，并持续推进到可以合入。简单任务应当无需看守即可
完成；复杂任务只在真正需要人类判断、授权或承担风险时才打断用户。

- **自由装配 Agent 和模型。** 规划、实现、审查和专项任务可以分别选择 Codex、Claude Code
  或未来 Runtime，不让整个任务被单一厂商绑定。
- **以并行为默认能力。** 多个独立任务在隔离工作空间中同时执行；同一个变更也可以由多个
  Agent 协作，而不会干扰其他工作。
- **多条 Candidate 竞争路线。** 把同一任务交给不同 Agent 或模型，保留每个精确结果，比较后
  选择最强 Candidate，而不是默认接受第一个答案。
- **用证据比较真实能力。** 对比不同 Agent、模型和上下文策略的产出质量、检查结果、耗时、
  Token 与成本覆盖、重试、返工次数和人类介入程度。
- **有边界的自主运行。** 让 Agent 自己规划、实现、验证、审查、修正，并在获得明确授权后
  完成合入；确定性控制只保护仓库范围、权限、预算和精确 Git 主体。
- **一个任务协调多个仓库。** 前端、后端、服务、迁移和文档可以作为一个完整变更推进，同时
  保留每个仓库独立的身份、证据和恢复路径。
- **根据历史效果智能选模型。** 常规任务选择足够便宜和快速的模型，高风险任务自动使用更强
  模型或增加 Reviewer，让质量和成本都可优化。
- **Agent 可以替换，责任链不能丢失。** 更换 Agent 或模型不会丢失任务历史、精确产物、人类
  决定、成本脉络和支撑结果的证据。

以上是产品目标，不代表这些能力已经全部实现。下面的内容描述当前原型实际具备的功能。

## 功能特性

- **一个任务，一个持续工作空间。** 一个 ChangeSet 可以关联一个或多个仓库工作空间，不会把
  每个仓库拆成独立的用户任务。
- **精确 Git 身份。** 每个仓库从冻结的 base SHA 开始；Candidate、检查、审查和交付始终绑定
  到精确 Git 主体。
- **隔离执行。** 可写操作发生在 ChangeFleet 管理的 Git worktree 中；规划和独立审查使用只读
  或一次性主体。
- **对话式任务流程。** 本地控制台可以创建任务，在同一对话中完成规划和反馈，并在后台推进
  已授权工作。
- **风险自适应验证。** Git 结构检查始终执行；项目原生语义检查和独立 Agent 审查只在任务及
  策略需要时执行。
- **有界多 Agent 质量检查。** 独立只读 Reviewer 可以审查精确 CandidateBundle，并返回通过
  建议、修改反馈或人类判断请求。
- **上下文外审计。** Runtime 用量、耗时、重试、证据和详细产物会被保留，但默认不会回放到
  后续 Agent 上下文。
- **仓库自有 Harness。** ChangeFleet 从精确基线读取目标仓库自己的说明和验证规则，不会发明
  或回写项目 Harness。
- **GitHub 交付。** 当前适配器把接受后的精确 Candidate 发布为 Ready PR，并观察人类合并结果。
- **精确集成授权。** 接受 Bundle 后，操作者可以授权一次完整展示的非强制 Git 发布或目标快进；
  ChangeFleet 独立观察远端 ref 后才承认结果，也可以明确选择“不由 ChangeFleet 集成”后结束任务。
- **本地化诊断。** 本地界面和类型化错误支持英文与简体中文。

## 工作流程

```text
任务目标
  -> 冻结仓库、分支和 base SHA
  -> 准备一个持续任务工作空间
  -> 由 Agent Runtime 规划和执行
  -> 验证精确的仓库 Candidate
  -> 按需执行独立审查和修正
  -> 审查一个精确的跨仓库 CandidateBundle
  -> 按配置发布 PR，或人工授权一个精确 Git 动作
  -> 独立观察结果，或明确结束而不声明托管集成
```

当前任务列表只展示六种简单状态：`running`、`needs_feedback`、`needs_review`、
`waiting_for_merge`、`complete` 和 `cancelled`。这些状态都由精确控制事实派生。

## 环境要求

- Node.js 24
- Git
- 已安装并登录的本地 Codex 环境，或者 OpenAI API Key
- 只有使用当前 GitHub 交付适配器时才需要登录 `gh`

第一个 Runtime 适配器使用 `@openai/codex-sdk`。凭据保留在用户选择的宿主环境中，不会复制到
ChangeFleet 状态里。

## 快速开始

### 1. 安装依赖

```powershell
npm install
```

### 2. 创建本地配置

将下面内容保存为 `changefleet.json`，并把 `codex_home` 和 `model` 替换为本机可用的值。
相对的控制目录和工作空间目录以配置文件所在目录为基准解析。

```json
{
  "schema_version": 1,
  "control_root": "./control",
  "workspace_root": "./workspaces",
  "locale": "zh-CN",
  "runtime": {
    "adapter": "codex-sdk",
    "credential_source": "local_codex_home",
    "codex_home": "C:/Users/example/.codex"
  },
  "agent_profile": {
    "profile_id": "local-codex-profile",
    "revision": 1,
    "provider": "openai",
    "runtime": "codex-sdk",
    "model": "gpt-5.4",
    "reasoning": "medium",
    "permissions": "operation_scoped",
    "network_access": false,
    "skills": [],
    "credential_profile_id": "local-codex-credentials"
  }
}
```

`operation_scoped` 是受限模式。对可信的本地工作空间，可以使用 `host_user` 并设置
`network_access: true`，此时 Agent 以当前本地账户权限运行；worktree 仍只隔离 Git 开发状态，
并不是操作系统安全边界。

### 3. 注册项目

创建 `register-project.json`：

```json
{
  "idempotency_key": "register-example-project-1",
  "project": {
    "project_id": "example-project",
    "repositories": [
      {
        "repository_id": "app",
        "locator": {
          "path": "C:/code/example-app"
        }
      }
    ]
  }
}
```

注册项目：

```powershell
node ./bin/changefleet.js project register --config changefleet.json --request register-project.json
```

一个 Project 可以只有一个仓库，也可以包含属于同一产品或同一变更边界的多个仓库。

### 4. 启动本地控制台

```powershell
node ./bin/changefleet.js serve --config changefleet.json --port 4311
```

打开 `http://127.0.0.1:4311`，为已经注册的 Project 创建任务，然后从任务列表查看对话和状态。

如果没有配置并确认 GitHub 交付绑定，接受 Bundle 后仍可选择一次精确的非强制 Git 发布或快进，
也可以明确结束任务而不声明 ChangeFleet 已完成交付或集成。真实远端写入仍需要操作者针对页面中
展示的完整 remote、ref 和 Candidate 单独授权。

## 常用命令

```powershell
# 读取一个任务
node ./bin/changefleet.js changeset show <change_set_id> --config changefleet.json

# 读取有界审计详情
node ./bin/changefleet.js debug audit changeset <change_set_id> --control-root ./control --locale zh-CN

# 运行本仓库开发检查
npm test
npm run test:integration
npm run test:acceptance
npm run test:ui
npm run check
```

低层生命周期命令是维护中的诊断和集成接口；普通任务流程以本地控制台为主。

## 当前限制

- GitHub 是唯一已实现的 PR 交付 Provider，并且 PR 由人类完成合并；另有 Provider 无关、人工
  逐次授权的精确 Git 发布与快进路径，但没有通用外部写权限。
- 远程 Worker、部署、Merge Queue、自动合并和托管多租户尚未实现。
- Codex Runtime 是当前唯一真实 Provider 适配器。
- 独立仓库 WorkUnit 的同时 Provider 派发尚未得到验证。
- 当前原型只接受当前版本的精确文件系统存储格式。

精确实现状态和已知缺口请查看[当前状态](docs/current-state.md)。

## 项目文档

- [产品规范](SPEC.md)
- [当前实现状态](docs/current-state.md)
- [架构](docs/architecture.md)
- [仓库 Harness](docs/harness.md)
- [验证策略](docs/validation.md)
- [术语表](docs/glossary.md)
- [已接受决策](docs/decisions/README.md)
- [设计提案索引](docs/proposals/INDEX.md)

Agent 接收任务时，应先应用 [AGENTS.md](AGENTS.md)，读取当前状态和活跃 WorkItem 或 Proposal，
检查 Git diff，再按需加载相关规范和决策章节。

## 开发

ChangeFleet 是一个私有 Node.js 24 ESM 包。应根据最终 diff 选择能够覆盖风险的最小验证范围；
[docs/validation.md](docs/validation.md) 定义了选择规则。真实 Provider 和外部 GitHub 检查是可选
Gate，`npm run check` 不会隐式执行它们。
