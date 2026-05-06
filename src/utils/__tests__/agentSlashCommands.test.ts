import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getCwdState, setCwdState } from '../../bootstrap/state.js'
import {
  clearCommandsCache,
  filterCommandsForRemoteMode,
  getCommands,
} from '../../commands.js'
import { clearAgentDefinitionsCache } from '../../tools/AgentTool/loadAgentsDir.js'

let tmpHome: string
let originalHome: string | undefined
let originalUserProfile: string | undefined
let originalClaudeConfigDir: string | undefined
let originalAnthropicApiKey: string | undefined
let originalCwdState: string

async function writeAgent(
  rootDir: string,
  agentName: string,
  description: string,
): Promise<void> {
  await fs.mkdir(rootDir, { recursive: true })
  await fs.writeFile(
    path.join(rootDir, `${agentName}.md`),
    [
      '---',
      `name: ${agentName}`,
      `description: ${description}`,
      '---',
      '',
      `You are the ${agentName} agent.`,
    ].join('\n'),
    'utf-8',
  )
}

describe('agent slash commands', () => {
  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(
      path.join(os.tmpdir(), 'yuanclaw-agent-slash-test-'),
    )
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY
    originalCwdState = getCwdState()

    process.env.HOME = tmpHome
    process.env.USERPROFILE = tmpHome
    process.env.CLAUDE_CONFIG_DIR = path.join(tmpHome, '.claude')
    process.env.ANTHROPIC_API_KEY = 'test-key'
    setCwdState(tmpHome)
  })

  afterEach(async () => {
    clearCommandsCache()
    clearAgentDefinitionsCache()

    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE
    } else {
      process.env.USERPROFILE = originalUserProfile
    }

    if (originalClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
    }

    if (originalAnthropicApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey
    }

    setCwdState(originalCwdState)
    await fs.rm(tmpHome, { recursive: true, force: true })
  })

  it('adds forked slash commands for active agents and keeps them in remote mode', async () => {
    const projectRoot = path.join(tmpHome, 'workspace')
    await writeAgent(
      path.join(projectRoot, '.claude', 'agents'),
      'security-auditor',
      'Review security-sensitive changes',
    )

    clearCommandsCache()
    clearAgentDefinitionsCache()

    const commands = await getCommands(projectRoot)

    expect(commands).toContainEqual(
      expect.objectContaining({
        name: 'agent:general-purpose',
        type: 'prompt',
        context: 'fork',
        agent: 'general-purpose',
        disableModelInvocation: true,
        userInvocable: true,
      }),
    )

    expect(commands).toContainEqual(
      expect.objectContaining({
        name: 'agent:security-auditor',
        type: 'prompt',
        context: 'fork',
        agent: 'security-auditor',
        disableModelInvocation: true,
        userInvocable: true,
      }),
    )

    const remoteCommands = filterCommandsForRemoteMode(commands)
    expect(remoteCommands).toContainEqual(
      expect.objectContaining({
        name: 'agent:security-auditor',
      }),
    )
  })
})
