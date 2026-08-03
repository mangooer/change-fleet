export const REQUIRED_NODE_MAJOR = 24;

// 版本守卫返回结构化结果，让检查入口和单元测试共享同一条错误语义。
export function unsupportedNodeVersionDiagnostic(
  nodeVersion,
  requiredMajor = REQUIRED_NODE_MAJOR,
) {
  const normalizedVersion =
    typeof nodeVersion === "string" ? nodeVersion : "unknown";
  const match = /^(\d+)\./.exec(normalizedVersion);
  const actualMajor = match === null ? null : Number(match[1]);
  if (actualMajor === requiredMajor) return null;

  return {
    code: "UNSUPPORTED_NODE_VERSION",
    required_major: requiredMajor,
    actual_version: normalizedVersion,
    message:
      `npm run check 需要 Node.js ${requiredMajor}；当前版本是 ${normalizedVersion}。` +
      `请将 Node.js ${requiredMajor} 放在 PATH 首位。`,
  };
}
