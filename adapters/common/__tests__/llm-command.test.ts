import { describe, it, expect } from 'bun:test'
import {
  formatRuntimeModelList,
  selectRuntimeModelOption,
} from '../llm-command.js'
import type { RuntimeModelOption } from '../http-client.js'

const options: RuntimeModelOption[] = [
  {
    providerId: 'provider-openai',
    providerName: 'OpenAI Responses',
    modelId: 'gpt-5.5',
    modelName: 'gpt-5.5',
    description: 'Main model',
    context: '',
    activeProvider: true,
  },
  {
    providerId: 'provider-openrouter',
    providerName: 'OpenRouter',
    modelId: 'anthropic/claude-sonnet-4.6',
    modelName: 'anthropic/claude-sonnet-4.6',
    description: 'Main model',
    context: '',
    activeProvider: false,
  },
]

describe('llm command helpers', () => {
  it('formats selectable runtime models', () => {
    const text = formatRuntimeModelList(options)

    expect(text).toContain('可用模型')
    expect(text).toContain('1. [OpenAI Responses] gpt-5.5 *')
    expect(text).toContain('2. [OpenRouter] anthropic/claude-sonnet-4.6')
    expect(text).toContain('/llm <编号或模型名>')
  })

  it('selects models by 1-based index', () => {
    expect(selectRuntimeModelOption(options, '2')?.option.modelId).toBe('anthropic/claude-sonnet-4.6')
  })

  it('selects models by exact id', () => {
    expect(selectRuntimeModelOption(options, 'gpt-5.5')?.option.providerId).toBe('provider-openai')
  })

  it('reports ambiguous fuzzy matches', () => {
    const selected = selectRuntimeModelOption([
      ...options,
      {
        providerId: 'provider-crs',
        providerName: 'CRS',
        modelId: 'claude-opus-4.7',
        modelName: 'claude-opus-4.7',
        description: 'Main model',
        context: '',
        activeProvider: false,
      },
    ], 'claude')

    expect(selected?.ambiguous).toHaveLength(2)
    expect(selected?.option.providerId).toBe('provider-openrouter')
  })

  it('returns null for an unknown model', () => {
    expect(selectRuntimeModelOption(options, 'missing-model')).toBeNull()
  })
})
