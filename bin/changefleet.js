#!/usr/bin/env node

import { runChangeFleetCommand } from "../src/cli/changefleet-command.js";

// 可执行文件只转交进程参数和标准流；所有权限、路由和错误语义由可测试模块统一处理。
process.exitCode = await runChangeFleetCommand(process.argv.slice(2));
