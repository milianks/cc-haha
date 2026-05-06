import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Subprocess } from 'bun'
import type { AdapterFileConfig } from '../../server/services/adapterService.js'

export type GatewayOptions = {
  port?: string
  host?: string
  authRequired?: boolean
  cliPath?: string
  force?: boolean
}

type AdapterPlatform = 'telegram' | 'feishu' | 'wechat' | 'dingtalk'

type AdapterStartOptions = {
  serverUrl: string
}

type GatewayDeps = {
  startServer?: (port: number, host: string) => unknown
  loadAdapterConfig?: () => Promise<Partial<AdapterFileConfig>> | Partial<AdapterFileConfig>
  startAdapter?: (platform: AdapterPlatform, options: AdapterStartOptions) => unknown
  stopExistingGateway?: (options: { port: number; host: string }) => Promise<boolean> | boolean
  stopExistingAdapter?: (platform: AdapterPlatform) => Promise<boolean> | boolean
}

const ADAPTERS_DIR = fileURLToPath(new URL('../../../adapters', import.meta.url))
const AUTO_START_PLATFORMS: AdapterPlatform[] = ['telegram', 'feishu', 'wechat', 'dingtalk']
const spawnedAdapters = new Set<Subprocess<'ignore', 'inherit', 'inherit'>>()
let adapterCleanupRegistered = false

function toGatewayServerUrl(host: string, port: number): string {
  return `ws://${host}:${port}`
}

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

function shouldAutoStartAdapter(
  platform: AdapterPlatform,
  config: Partial<AdapterFileConfig>,
): boolean {
  switch (platform) {
    case 'telegram':
      return hasText(config.telegram?.botToken)
    case 'feishu':
      return hasText(config.feishu?.appId) && hasText(config.feishu?.appSecret)
    case 'wechat':
      return hasText(config.wechat?.accountId) &&
        hasText(config.wechat?.botToken) &&
        hasText(config.wechat?.userId)
    case 'dingtalk':
      return hasText(config.dingtalk?.clientId) && hasText(config.dingtalk?.clientSecret)
  }
}

function defaultStartAdapter(
  platform: AdapterPlatform,
  options: AdapterStartOptions,
): Subprocess<'ignore', 'inherit', 'inherit'> {
  console.log(`[Gateway] Auto-starting ${platform} adapter`)
  const proc = Bun.spawn(['bun', 'run', platform], {
    cwd: ADAPTERS_DIR,
    env: {
      ...process.env,
      ADAPTER_SERVER_URL: options.serverUrl,
    },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  spawnedAdapters.add(proc)

  void proc.exited.then((code) => {
    spawnedAdapters.delete(proc)
    if (code === 0) return
    console.warn(`[Gateway] ${platform} adapter exited with code ${code}`)
  })

  return proc
}

function stopSpawnedAdapters(): void {
  for (const proc of spawnedAdapters) {
    const pid = proc.pid
    if (!pid || pid === process.pid) continue
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // ignore dead processes
    }
  }
}

async function gracefulStopAdapters(): Promise<void> {
  if (spawnedAdapters.size === 0) return
  stopSpawnedAdapters()

  // Wait up to 5s for adapters to exit
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && spawnedAdapters.size > 0) {
    await Bun.sleep(100)
  }

  // Force-kill stragglers
  for (const proc of spawnedAdapters) {
    const pid = proc.pid
    if (!pid || pid === process.pid) continue
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}

let shuttingDown = false

function registerAdapterCleanup(): void {
  if (adapterCleanupRegistered) return
  adapterCleanupRegistered = true

  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    await gracefulStopAdapters()
    process.exit(0)
  }

  process.once('SIGTERM', () => void shutdown())
  process.once('SIGINT', () => void shutdown())
}

async function defaultLoadAdapterConfig(): Promise<Partial<AdapterFileConfig>> {
  const { adapterService } = await import('../../server/services/adapterService.js')
  return await adapterService.getRawConfig()
}

async function defaultStartServer(port: number, host: string): Promise<void> {
  const { startServer } = await import('../../server/index.js')
  startServer(port, host)
}

function parsePort(rawPort: string | undefined): number {
  const port = Number.parseInt(rawPort || process.env.SERVER_PORT || '3456', 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid gateway port: ${rawPort}`)
  }
  return port
}

async function runCommand(args: string[]): Promise<string> {
  let proc: Subprocess<'ignore', 'pipe', 'ignore'>
  try {
    proc = Bun.spawn(args, {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
    })
  } catch {
    return ''
  }

  const [stdout] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited.catch(() => 1),
  ])

  return stdout.trim()
}

async function findListeningPids(port: number): Promise<number[]> {
  const pidTexts = [
    await runCommand(['lsof', '-tiTCP:' + String(port), '-sTCP:LISTEN']),
    await runCommand(['fuser', '-n', 'tcp', String(port)]),
  ]

  return Array.from(
    new Set(
      pidTexts
        .flatMap((text) => text.split(/\s+/))
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid),
    ),
  )
}

async function findMatchingPids(patterns: string[]): Promise<number[]> {
  const text = await runCommand(['ps', '-eo', 'pid=,args='])
  if (!text) return []

  return Array.from(
    new Set(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          const match = line.match(/^(\d+)\s+(.*)$/)
          if (!match) return []
          const pid = Number.parseInt(match[1]!, 10)
          const command = match[2]!
          if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return []
          return patterns.some((pattern) => command.includes(pattern)) ? [pid] : []
        }),
    ),
  )
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
      await Bun.sleep(100)
    } catch {
      return true
    }
  }

  return false
}

async function defaultStopExistingGateway(options: { port: number; host: string }): Promise<boolean> {
  const probeHost =
    options.host === '0.0.0.0' || options.host === 'localhost'
      ? '127.0.0.1'
      : options.host
  const baseUrl = `http://${probeHost}:${options.port}`

  try {
    const response = await fetch(`${baseUrl}/api/agent-runtime/gateway`, {
      signal: AbortSignal.timeout(1000),
    })
    if (!response.ok) return false

    const body = await response.json() as { gateway?: { status?: string } }
    if (body.gateway?.status !== 'running') return false
  } catch {
    return false
  }

  const pids = await findListeningPids(options.port)
  if (pids.length === 0) return false

  console.log(`[Gateway] Force restart requested, stopping existing gateway on ${options.host}:${options.port}`)

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      continue
    }
  }

  const stillRunning: number[] = []
  for (const pid of pids) {
    const exited = await waitForExit(pid, 3000)
    if (!exited) stillRunning.push(pid)
  }

  for (const pid of stillRunning) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      continue
    }
    await waitForExit(pid, 1000)
  }

  return true
}

async function stopProcesses(pids: number[], label: string): Promise<boolean> {
  if (pids.length === 0) return false

  console.log(`[Gateway] Force restart requested, stopping existing ${label}`)

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      continue
    }
  }

  const stillRunning: number[] = []
  for (const pid of pids) {
    const exited = await waitForExit(pid, 3000)
    if (!exited) stillRunning.push(pid)
  }

  for (const pid of stillRunning) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      continue
    }
    await waitForExit(pid, 1000)
  }

  return true
}

async function defaultStopExistingAdapter(platform: AdapterPlatform): Promise<boolean> {
  const patterns: Record<AdapterPlatform, string[]> = {
    telegram: ['bun run telegram', 'telegram/index.ts'],
    feishu: ['bun run feishu', 'feishu/index.ts'],
    wechat: ['bun run wechat', 'wechat/index.ts'],
    dingtalk: ['bun run dingtalk', 'dingtalk/index.ts'],
  }

  const pids = await findMatchingPids(patterns[platform])
  return await stopProcesses(pids, `${platform} adapter`)
}

export async function gatewayRunHandler(options: GatewayOptions = {}, deps: GatewayDeps = {}) {
  const port = parsePort(options.port)
  const host = options.host || process.env.SERVER_HOST || '127.0.0.1'
  const serverUrl = toGatewayServerUrl(host, port)

  process.env.SERVER_PORT = String(port)
  process.env.SERVER_HOST = host
  process.env.ADAPTER_SERVER_URL = serverUrl
  process.env.GATEWAY_MODE = '1'

  if (options.authRequired) {
    process.env.SERVER_AUTH_REQUIRED = '1'
  }

  if (options.cliPath) {
    process.env.CLAUDE_CLI_PATH = options.cliPath
  }

  const startServer = deps.startServer ?? defaultStartServer
  const loadAdapterConfig = deps.loadAdapterConfig ?? defaultLoadAdapterConfig
  const startAdapter = deps.startAdapter ?? defaultStartAdapter
  const stopExistingGateway = deps.stopExistingGateway ?? defaultStopExistingGateway
  const stopExistingAdapter = deps.stopExistingAdapter ?? defaultStopExistingAdapter

  registerAdapterCleanup()

  const adapterConfig = await loadAdapterConfig()

  if (options.force) {
    await stopExistingGateway({ port, host })
    for (const platform of AUTO_START_PLATFORMS) {
      if (!shouldAutoStartAdapter(platform, adapterConfig)) continue
      await stopExistingAdapter(platform)
    }
  }

  await startServer(port, host)

  for (const platform of AUTO_START_PLATFORMS) {
    if (!shouldAutoStartAdapter(platform, adapterConfig)) continue
    startAdapter(platform, { serverUrl })
  }
}
