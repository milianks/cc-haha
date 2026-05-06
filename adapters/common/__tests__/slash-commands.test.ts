import { describe, expect, it } from 'bun:test'
import {
  buildFeishuSlashCommandMenu,
  buildTelegramSlashCommands,
  buildTelegramMenuCommands,
  buildWechatMenu,
  fitTelegramCommandsWithinTextBudget,
  hashCommandList,
  isBotCommandsTooMuchError,
  normalizeSlashCommands,
  syncTelegramMenuCommands,
  BUILTIN_TELEGRAM_COMMANDS,
  TELEGRAM_TOTAL_COMMAND_TEXT_BUDGET,
} from '../slash-commands.js'

describe('slash command helpers', () => {
  it('normalizes strings and command objects into safe command metadata', () => {
    expect(normalizeSlashCommands([
      'help',
      '/new',
      { name: 'bad command', description: 'ignored' },
      { command: '/status', description: 'Show status' },
      { name: 'tool-long-description', description: 'x'.repeat(200) },
      { name: 'help', description: 'duplicate ignored' },
    ])).toEqual([
      { name: 'help', description: '' },
      { name: 'new', description: '' },
      { name: 'status', description: 'Show status' },
      { name: 'tool-long-description', description: 'x'.repeat(120) },
    ])
  })

  it('builds Telegram command payloads with fallback descriptions', () => {
    expect(buildTelegramSlashCommands([
      { name: 'help', description: 'Show help' },
      { name: 'new', description: '' },
    ])).toEqual([
      { command: 'help', description: 'Show help' },
      { command: 'new', description: 'Run /new' },
    ])
  })

  it('builds a Feishu chat menu tree from slash commands', () => {
    expect(buildFeishuSlashCommandMenu([
      { name: 'help', description: 'Show help' },
      { name: 'new', description: 'New session' },
    ])).toEqual({
      menu_tree: {
        chat_menu_top_levels: [
          {
            chat_menu_item: {
              action_type: 'NONE',
              name: 'Yuanclaw',
              i18n_names: { zh_cn: 'Yuanclaw', en_us: 'Yuanclaw' },
            },
            children: [
              {
                chat_menu_item: {
                  action_type: 'NONE',
                  name: '/help',
                  i18n_names: { zh_cn: '/help', en_us: '/help' },
                },
              },
              {
                chat_menu_item: {
                  action_type: 'NONE',
                  name: '/new',
                  i18n_names: { zh_cn: '/new', en_us: '/new' },
                },
              },
            ],
          },
        ],
      },
    })
  })

  it('builds a WeChat custom menu payload from slash commands', () => {
    expect(buildWechatMenu([
      { name: 'help', description: 'Show help' },
      { name: 'new', description: 'New session' },
    ])).toEqual({
      button: [
        {
          name: 'Yuanclaw',
          sub_button: [
            { type: 'click', name: '/help', key: 'slash_help' },
            { type: 'click', name: '/new', key: 'slash_new' },
          ],
        },
      ],
    })
  })

  it('buildTelegramMenuCommands merges builtins with dynamic commands', () => {
    const result = buildTelegramMenuCommands([
      { name: 'deploy', description: 'Deploy project' },
      { name: 'help', description: 'Should not override builtin' },
    ])
    const commands = result.map((c) => c.command)
    // Builtins come first
    expect(commands.slice(0, BUILTIN_TELEGRAM_COMMANDS.length)).toEqual(
      BUILTIN_TELEGRAM_COMMANDS.map((c) => c.command),
    )
    // Dynamic 'deploy' added after builtins
    expect(commands).toContain('deploy')
    // Duplicate 'help' from dynamic input is dropped (builtin wins)
    const helpCount = commands.filter((c) => c === 'help').length
    expect(helpCount).toBe(1)
  })

  it('buildTelegramMenuCommands returns only builtins when no dynamic input', () => {
    const result = buildTelegramMenuCommands(null)
    expect(result).toEqual(BUILTIN_TELEGRAM_COMMANDS)
  })

  it('hashCommandList is stable for same commands regardless of input order', () => {
    const a = [
      { command: 'start', description: 'a' },
      { command: 'help', description: 'b' },
    ]
    const b = [
      { command: 'help', description: 'b' },
      { command: 'start', description: 'a' },
    ]
    expect(hashCommandList(a)).toBe(hashCommandList(b))
  })

  it('hashCommandList changes when commands differ', () => {
    const a = [{ command: 'start', description: 'a' }]
    const b = [{ command: 'start', description: 'b' }]
    expect(hashCommandList(a)).not.toBe(hashCommandList(b))
  })

  it('fitTelegramCommandsWithinTextBudget returns all commands when within budget', () => {
    const commands = BUILTIN_TELEGRAM_COMMANDS
    const result = fitTelegramCommandsWithinTextBudget(commands, TELEGRAM_TOTAL_COMMAND_TEXT_BUDGET)
    expect(result.commands.length).toBe(commands.length)
    expect(result.descriptionTrimmed).toBe(false)
    expect(result.textBudgetDropCount).toBe(0)
  })

  it('fitTelegramCommandsWithinTextBudget trims descriptions when budget is tight', () => {
    const commands = [
      { command: 'a', description: 'long description here' },
      { command: 'b', description: 'another long description' },
    ]
    const result = fitTelegramCommandsWithinTextBudget(commands, 10)
    expect(result.commands.length).toBe(2)
    expect(result.descriptionTrimmed).toBe(true)
  })

  it('fitTelegramCommandsWithinTextBudget drops commands when budget is too small', () => {
    const commands = [
      { command: 'longcommand', description: 'desc' },
      { command: 'short', description: 'x' },
    ]
    const result = fitTelegramCommandsWithinTextBudget(commands, 5)
    expect(result.textBudgetDropCount).toBeGreaterThan(0)
  })

  it('isBotCommandsTooMuchError detects the error pattern', () => {
    expect(isBotCommandsTooMuchError(new Error('BOT_COMMANDS_TOO_MUCH'))).toBe(true)
    expect(isBotCommandsTooMuchError(new Error('bot_commands_too_much'))).toBe(true)
    expect(isBotCommandsTooMuchError({ description: 'BOT_COMMANDS_TOO_MUCH: too many' })).toBe(true)
    expect(isBotCommandsTooMuchError({ message: 'got BOT_COMMANDS_TOO_MUCH' })).toBe(true)
    expect(isBotCommandsTooMuchError(new Error('Some other error'))).toBe(false)
    expect(isBotCommandsTooMuchError(null)).toBe(false)
    expect(isBotCommandsTooMuchError('')).toBe(false)
  })

  it('syncTelegramMenuCommands calls setMyCommands with dual scopes', async () => {
    const calls: string[] = []
    const api = {
      deleteMyCommands: async (_scope?: { type: 'all_group_chats' }) => {
        calls.push('delete')
      },
      setMyCommands: async (
        _commands: Array<{ command: string; description: string }>,
        scope?: { type: 'all_group_chats' },
      ) => {
        calls.push(scope ? `set:${scope.type}` : 'set:default')
      },
    }
    const commands = [{ command: 'test', description: 'Test command' }]
    syncTelegramMenuCommands({ api, commandsToRegister: commands })
    // Allow async sync to complete
    await new Promise((r) => setTimeout(r, 50))
    // delete for default + group scope, then set for default + group scope
    expect(calls).toEqual(['delete', 'delete', 'set:default', 'set:all_group_chats'])
  })

  it('syncTelegramMenuCommands skips sync when hash unchanged', async () => {
    const calls: string[] = []
    const api = {
      deleteMyCommands: async (_scope?: { type: 'all_group_chats' }) => { calls.push('delete') },
      setMyCommands: async (
        _commands: Array<{ command: string; description: string }>,
        scope?: { type: 'all_group_chats' },
      ) => { calls.push(scope ? `set:${scope.type}` : 'set:default') },
    }
    const commands = [{ command: 'test', description: 'Test command' }]
    // First sync
    syncTelegramMenuCommands({ api, commandsToRegister: commands, cacheKey: 'skip-test' })
    await new Promise((r) => setTimeout(r, 50))
    calls.length = 0
    // Second sync with same commands should be skipped
    syncTelegramMenuCommands({ api, commandsToRegister: commands, cacheKey: 'skip-test' })
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toEqual([])
  })
})
