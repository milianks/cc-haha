function isTimeoutError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'TimeoutError'
  }

  return error instanceof Error && error.name === 'TimeoutError'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function retryTelegramApi<T>(
  operation: () => Promise<T>,
  options: {
    retries?: number
    delayMs?: number
  } = {},
): Promise<T> {
  const retries = options.retries ?? 2
  const delayMs = options.delayMs ?? 1_000

  let attempt = 0
  while (true) {
    try {
      return await operation()
    } catch (error) {
      if (!isTimeoutError(error) || attempt >= retries) {
        throw error
      }
      attempt += 1
      if (delayMs > 0) {
        await sleep(delayMs)
      }
    }
  }
}
