import { describe, expect, it } from 'bun:test'
import { retryTelegramApi } from '../bot-api.js'

describe('retryTelegramApi', () => {
  it('retries once when Telegram API call fails with TimeoutError', async () => {
    let attempts = 0

    const result = await retryTelegramApi(async () => {
      attempts += 1
      if (attempts === 1) {
        throw new DOMException('The operation timed out.', 'TimeoutError')
      }
      return 'ok'
    }, {
      retries: 1,
      delayMs: 0,
    })

    expect(result).toBe('ok')
    expect(attempts).toBe(2)
  })
})
