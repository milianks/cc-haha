import { createHash } from 'node:crypto'

export type SlashCommand = {
  name: string
  description: string
}

export type TelegramBotCommand = {
  command: string
  description: string
}

const MAX_TELEGRAM_COMMANDS = 100
const MAX_TELEGRAM_DESCRIPTION = 256
const MAX_SHARED_DESCRIPTION = 120
const MAX_FEISHU_CHILDREN = 5
const MAX_WECHAT_CHILDREN = 5

/** Conservative total character budget for Telegram setMyCommands payloads. */
export const TELEGRAM_TOTAL_COMMAND_TEXT_BUDGET = 5700

/** Command menu scopes to register for (private chat + groups). */
export const TELEGRAM_COMMAND_MENU_SCOPES = [
  { label: 'default' as const },
  { label: 'all_group_chats' as const, scope: { type: 'all_group_chats' as const } },
]

/** Builtin commands that the Telegram adapter always has handlers for. */
export const BUILTIN_TELEGRAM_COMMANDS: TelegramBotCommand[] = [
  { command: 'start', description: '开始使用 / 查看帮助' },
  { command: 'help', description: '查看帮助信息' },
  { command: 'new', description: '新建会话（可接项目编号/路径）' },
  { command: 'projects', description: '查看最近项目列表' },
  { command: 'stop', description: '停止当前生成' },
  { command: 'status', description: '查看当前会话状态' },
  { command: 'llm', description: '查看/切换模型' },
  { command: 'clear', description: '清空当前会话上下文' },
]

export function normalizeSlashCommands(input: unknown): SlashCommand[] {
  if (!Array.isArray(input)) return []

  const commands: SlashCommand[] = []
  const seen = new Set<string>()

  for (const item of input) {
    const rawName = typeof item === 'string'
      ? item
      : item && typeof item === 'object'
        ? String((item as Record<string, unknown>).name ?? (item as Record<string, unknown>).command ?? '')
        : ''
    const name = normalizeCommandName(rawName)
    if (!name || seen.has(name)) continue

    const rawDescription = typeof item === 'string'
      ? ''
      : item && typeof item === 'object'
        ? String((item as Record<string, unknown>).description ?? '')
        : ''
    commands.push({
      name,
      description: rawDescription.trim().slice(0, MAX_SHARED_DESCRIPTION),
    })
    seen.add(name)
  }

  return commands
}

export function buildTelegramSlashCommands(input: unknown): TelegramBotCommand[] {
  return normalizeSlashCommands(input)
    .filter((cmd) => /^[a-z][a-z0-9_]{0,31}$/.test(cmd.name))
    .slice(0, MAX_TELEGRAM_COMMANDS)
    .map((cmd) => ({
      command: cmd.name,
      description: (cmd.description || `Run /${cmd.name}`).slice(0, MAX_TELEGRAM_DESCRIPTION),
    }))
}

export function buildFeishuSlashCommandMenu(input: unknown): Record<string, unknown> | null {
  const children = normalizeSlashCommands(input)
    .slice(0, MAX_FEISHU_CHILDREN)
    .map((cmd) => ({
      chat_menu_item: {
        action_type: 'NONE',
        name: `/${cmd.name}`,
        i18n_names: { zh_cn: `/${cmd.name}`, en_us: `/${cmd.name}` },
      },
    }))

  if (children.length === 0) return null

  return {
    menu_tree: {
      chat_menu_top_levels: [
        {
          chat_menu_item: {
            action_type: 'NONE',
            name: 'Yuanclaw',
            i18n_names: { zh_cn: 'Yuanclaw', en_us: 'Yuanclaw' },
          },
          children,
        },
      ],
    },
  }
}

export function buildWechatMenu(input: unknown): Record<string, unknown> | null {
  const subButton = normalizeSlashCommands(input)
    .slice(0, MAX_WECHAT_CHILDREN)
    .map((cmd) => ({
      type: 'click',
      name: `/${cmd.name}`,
      key: `slash_${cmd.name}`.slice(0, 128),
    }))

  if (subButton.length === 0) return null

  return {
    button: [
      {
        name: 'Yuanclaw',
        sub_button: subButton,
      },
    ],
  }
}

/** Builtin command names that the adapter always owns handlers for. */
const BUILTIN_COMMAND_NAMES = new Set(BUILTIN_TELEGRAM_COMMANDS.map((c) => c.command))

function countCommandText(value: string): number {
  return Array.from(value).length
}

function truncateCommandText(value: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  const chars = Array.from(value)
  if (chars.length <= maxLength) return value
  if (maxLength === 1) return chars[0] ?? ''
  return `${chars.slice(0, maxLength - 1).join('')}…`
}

export function fitTelegramCommandsWithinTextBudget(
  commands: TelegramBotCommand[],
  maxTotalChars: number,
): {
  commands: TelegramBotCommand[]
  descriptionTrimmed: boolean
  textBudgetDropCount: number
} {
  let candidateCommands = [...commands]
  while (candidateCommands.length > 0) {
    const commandNameChars = candidateCommands.reduce(
      (total, cmd) => total + countCommandText(cmd.command),
      0,
    )
    const descriptionBudget = maxTotalChars - commandNameChars
    const minDescriptionBudget = candidateCommands.length
    if (descriptionBudget < minDescriptionBudget) {
      candidateCommands = candidateCommands.slice(0, -1)
      continue
    }

    const descriptionCap = Math.max(1, Math.floor(descriptionBudget / candidateCommands.length))
    let descriptionTrimmed = false
    const fittedCommands = candidateCommands.map((cmd) => {
      const description = truncateCommandText(cmd.description, descriptionCap)
      if (description !== cmd.description) {
        descriptionTrimmed = true
        return { ...cmd, description }
      }
      return cmd
    })
    return {
      commands: fittedCommands,
      descriptionTrimmed,
      textBudgetDropCount: commands.length - fittedCommands.length,
    }
  }

  return { commands: [], descriptionTrimmed: false, textBudgetDropCount: commands.length }
}

export function hashCommandList(commands: TelegramBotCommand[]): string {
  const sorted = [...commands].sort((a, b) => a.command.localeCompare(b.command))
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16)
}

export function buildTelegramMenuCommands(dynamicInput: unknown): TelegramBotCommand[] {
  const dynamic = buildTelegramSlashCommands(dynamicInput)
  const seen = new Set<string>(BUILTIN_COMMAND_NAMES)
  const unique: TelegramBotCommand[] = [...BUILTIN_TELEGRAM_COMMANDS]
  for (const cmd of dynamic) {
    if (!seen.has(cmd.command)) {
      seen.add(cmd.command)
      unique.push(cmd)
    }
  }
  return unique
}

export function isBotCommandsTooMuchError(err: unknown): boolean {
  if (!err) return false
  const pattern = /\bBOT_COMMANDS_TOO_MUCH\b/i
  if (typeof err === 'string') return pattern.test(err)
  if (err instanceof Error) return pattern.test(err.message)
  const obj = err as Record<string, unknown>
  for (const key of ['description', 'message'] as const) {
    const val = obj[key]
    if (typeof val === 'string' && pattern.test(val)) return true
  }
  return false
}

export interface TelegramSyncApi {
  deleteMyCommands: (scope?: { type: 'all_group_chats' }) => Promise<unknown>
  setMyCommands: (
    commands: TelegramBotCommand[],
    scope?: { type: 'all_group_chats' },
  ) => Promise<unknown>
}

const COMMAND_RETRY_RATIO = 0.8

/** Process-local cache so restarts always re-register. */
const syncedCommandHashes = new Map<string, string>()

export function syncTelegramMenuCommands(params: {
  api: TelegramSyncApi
  commandsToRegister: TelegramBotCommand[]
  cacheKey?: string
  onLog?: (msg: string) => void
  onError?: (msg: string) => void
}): void {
  const { api, commandsToRegister, cacheKey = 'default', onLog, onError } = params
  const sync = async () => {
    const currentHash = hashCommandList(commandsToRegister)
    const cachedHash = syncedCommandHashes.get(cacheKey)
    if (cachedHash === currentHash) {
      onLog?.('[Telegram] Command menu unchanged; skipping sync')
      return
    }

    // Delete → set ordering avoids stale deletions racing after fresh registrations.
    for (const scope of TELEGRAM_COMMAND_MENU_SCOPES) {
      try {
        await (scope.scope
          ? api.deleteMyCommands(scope.scope)
          : api.deleteMyCommands())
      } catch {
        // Best-effort delete; stale commands get overwritten by setMyCommands anyway.
      }
    }

    if (commandsToRegister.length === 0) {
      syncedCommandHashes.set(cacheKey, currentHash)
      return
    }

    let retryCommands = commandsToRegister
    const initialCount = commandsToRegister.length
    while (retryCommands.length > 0) {
      try {
        for (const scope of TELEGRAM_COMMAND_MENU_SCOPES) {
          await (scope.scope
            ? api.setMyCommands(retryCommands, scope.scope)
            : api.setMyCommands(retryCommands))
        }
        if (retryCommands.length < initialCount) {
          onLog?.(
            `[Telegram] Registered ${retryCommands.length} commands after BOT_COMMANDS_TOO_MUCH (started with ${initialCount})`,
          )
        } else {
          onLog?.(`[Telegram] Registered ${retryCommands.length} slash command(s)`)
        }
        syncedCommandHashes.set(cacheKey, currentHash)
        return
      } catch (err) {
        if (!isBotCommandsTooMuchError(err)) throw err
        const nextCount = Math.floor(retryCommands.length * COMMAND_RETRY_RATIO)
        const reducedCount = nextCount < retryCommands.length ? nextCount : retryCommands.length - 1
        if (reducedCount <= 0) {
          onError?.(
            '[Telegram] BOT_COMMANDS_TOO_MUCH rejected all commands; leaving menu empty',
          )
          return
        }
        onLog?.(
          `[Telegram] BOT_COMMANDS_TOO_MUCH with ${retryCommands.length} commands; retrying with ${reducedCount}`,
        )
        retryCommands = retryCommands.slice(0, reducedCount)
      }
    }
  }

  void sync().catch((err) => {
    onError?.(`[Telegram] Command sync failed: ${String(err)}`)
  })
}

function normalizeCommandName(rawName: string): string {
  const withoutSlash = rawName.trim().replace(/^\/+/, '')
  if (!withoutSlash || /\s/.test(withoutSlash)) return ''
  return withoutSlash.slice(0, 64)
}
