#!/usr/bin/env node

import { runLocalAuditCommand } from "../src/cli/local-audit-command.js";

// 可执行文件只转交参数和标准流；所有查询边界由可测试的命令模块统一处理。
process.exitCode = await runLocalAuditCommand(process.argv.slice(2));
