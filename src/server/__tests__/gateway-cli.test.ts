import { describe, expect, it } from 'bun:test'

async function runCli(args: string[]) {
  const proc = Bun.spawn(['bun', '--env-file=/dev/null', './src/entrypoints/cli.tsx', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      YUANCLAW_SKIP_DOTENV: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return { stdout, stderr, exitCode }
}

describe('gateway CLI command', () => {
  it('exposes an OpenClaw-style gateway command with a foreground run alias', async () => {
    const gatewayHelp = await runCli(['gateway', '--help'])

    expect(gatewayHelp.exitCode).toBe(0)
    expect(gatewayHelp.stdout).toContain('Start the local yuanclaw gateway')
    expect(gatewayHelp.stdout).toContain('run')

    const runHelp = await runCli(['gateway', 'run', '--help'])

    expect(runHelp.exitCode).toBe(0)
    expect(runHelp.stdout).toContain('Start the local yuanclaw gateway in the foreground')
    expect(runHelp.stdout).toContain('--port <number>')
    expect(runHelp.stdout).toContain('--host <string>')
    expect(runHelp.stdout).toContain('--force')
  })
})
