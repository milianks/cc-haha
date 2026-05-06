import type { RuntimeModelOption } from './http-client.js'

export type RuntimeModelSelection = {
  option: RuntimeModelOption
  ambiguous?: RuntimeModelOption[]
}

export function formatRuntimeModelList(options: RuntimeModelOption[]): string {
  if (options.length === 0) {
    return '没有可用模型。请先在 yuanclaw 中配置 provider。'
  }

  const lines = ['可用模型：']
  for (const [index, option] of options.entries()) {
    const activeMark = option.activeProvider ? ' *' : ''
    lines.push(
      `${index + 1}. [${option.providerName}] ${option.modelName}${activeMark}`,
    )
    if (option.modelId !== option.modelName) {
      lines.push(`   ${option.modelId}`)
    }
  }
  lines.push('')
  lines.push('发送 /llm <编号或模型名> 切换当前会话。')
  return lines.join('\n')
}

export function selectRuntimeModelOption(
  options: RuntimeModelOption[],
  query: string,
): RuntimeModelSelection | null {
  const trimmed = query.trim()
  if (!trimmed) return null

  const numeric = Number.parseInt(trimmed, 10)
  if (
    String(numeric) === trimmed &&
    numeric >= 1 &&
    numeric <= options.length
  ) {
    return { option: options[numeric - 1]! }
  }

  const normalized = trimmed.toLowerCase()
  const exact = options.find((option) =>
    option.modelId.toLowerCase() === normalized ||
    option.modelName.toLowerCase() === normalized ||
    `${option.providerName}/${option.modelId}`.toLowerCase() === normalized
  )
  if (exact) return { option: exact }

  const matches = options.filter((option) =>
    option.modelId.toLowerCase().includes(normalized) ||
    option.modelName.toLowerCase().includes(normalized) ||
    option.providerName.toLowerCase().includes(normalized)
  )
  if (matches.length === 1) return { option: matches[0]! }
  if (matches.length > 1) return { option: matches[0]!, ambiguous: matches }
  return null
}
