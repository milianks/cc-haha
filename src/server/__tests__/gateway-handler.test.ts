import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { gatewayRunHandler, type GatewayOptions } from '../../cli/handlers/gateway.js'

describe('gatewayRunHandler adapter autostart', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.SERVER_PORT
    delete process.env.SERVER_HOST
    delete process.env.SERVER_AUTH_REQUIRED
    delete process.env.CLAUDE_CLI_PATH
  })

  it('starts the gateway server and auto-starts configured adapters with the gateway ws url', async () => {
    const startServer = mock(() => {})
    const startAdapter = mock(() => {})

    await gatewayRunHandler(
      {
        port: '4567',
        host: '127.0.0.1',
      } satisfies GatewayOptions,
      {
        startServer,
        startAdapter,
        loadAdapterConfig: () => ({
          telegram: { botToken: 'tg-token' },
          feishu: { appId: 'app-id', appSecret: 'app-secret' },
          wechat: { accountId: '', botToken: '', userId: '' },
          dingtalk: { clientId: '', clientSecret: '' },
        }),
      },
    )

    expect(startServer).toHaveBeenCalledWith(4567, '127.0.0.1')
    expect(startAdapter).toHaveBeenCalledTimes(2)
    expect(startAdapter).toHaveBeenNthCalledWith(1, 'telegram', {
      serverUrl: 'ws://127.0.0.1:4567',
    })
    expect(startAdapter).toHaveBeenNthCalledWith(2, 'feishu', {
      serverUrl: 'ws://127.0.0.1:4567',
    })
  })

  it('skips adapters without required credentials', async () => {
    const startServer = mock(() => {})
    const startAdapter = mock(() => {})

    await gatewayRunHandler(
      {},
      {
        startServer,
        startAdapter,
        loadAdapterConfig: () => ({
          telegram: { botToken: '' },
          feishu: { appId: 'only-app-id', appSecret: '' },
          wechat: { accountId: 'acc', botToken: '', userId: 'uid' },
          dingtalk: { clientId: 'cid', clientSecret: '' },
        }),
      },
    )

    expect(startServer).toHaveBeenCalledWith(3456, '127.0.0.1')
    expect(startAdapter).not.toHaveBeenCalled()
  })

  it('force mode stops an existing local gateway before starting a new one', async () => {
    const stopExistingGateway = mock(async () => true)
    const stopExistingAdapter = mock(async () => true)
    const startServer = mock(() => {})
    const startAdapter = mock(() => {})

    await gatewayRunHandler(
      {
        port: '4567',
        host: '127.0.0.1',
        force: true,
      } satisfies GatewayOptions,
      {
        stopExistingGateway,
        stopExistingAdapter,
        startServer,
        startAdapter,
        loadAdapterConfig: () => ({
          telegram: { botToken: 'tg-token' },
        }),
      },
    )

    expect(stopExistingGateway).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 4567,
    })
    expect(stopExistingAdapter).toHaveBeenCalledWith('telegram')
    expect(startServer).toHaveBeenCalledWith(4567, '127.0.0.1')
    expect(startAdapter).toHaveBeenCalledWith('telegram', {
      serverUrl: 'ws://127.0.0.1:4567',
    })
  })
})
