import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export type RecentProject = {
  projectPath: string
  realPath: string
  projectName: string
  isGit: boolean
  repoName: string | null
  branch: string | null
  modifiedAt: string
  sessionCount: number
}

export type GitInfo = {
  branch: string | null
  repoName: string | null
  workDir: string
  changedFiles: number
}

export type SessionTask = {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type ApiModelInfo = {
  id: string
  name: string
  description: string
  context: string
}

export type ApiModelList = {
  models: ApiModelInfo[]
  provider: { id: string; name: string } | null
}

export type ProviderModelMapping = {
  main: string
  haiku: string
  sonnet: string
  opus: string
}

export type AdapterProvider = {
  id: string
  name: string
  models: ProviderModelMapping
}

export type ProviderList = {
  providers: AdapterProvider[]
  activeId: string | null
}

export type RuntimeModelOption = {
  providerId: string | null
  providerName: string
  modelId: string
  modelName: string
  description: string
  context: string
  activeProvider: boolean
}

export class AdapterHttpClient {
  readonly httpBaseUrl: string
  private readonly allowedProjectRoots: string[]
  /** Default timeout for HTTP requests (30 seconds) */
  private static readonly DEFAULT_TIMEOUT_MS = 30_000

  constructor(wsUrl: string, options?: { allowedProjectRoots?: string[] }) {
    this.httpBaseUrl = wsUrl
      .replace(/^ws:/, 'http:')
      .replace(/^wss:/, 'https:')
      .replace(/\/$/, '')
    this.allowedProjectRoots = (options?.allowedProjectRoots ?? [])
      .map(resolveExistingProjectPath)
      .filter((value): value is string => Boolean(value))
  }

  /** Create an AbortController with timeout */
  private createTimeoutController(timeoutMs = AdapterHttpClient.DEFAULT_TIMEOUT_MS): {
    controller: AbortController
    timer: ReturnType<typeof setTimeout>
  } {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    return { controller, timer }
  }

  async createSession(workDir: string): Promise<string> {
    const { controller, timer } = this.createTimeoutController()
    try {
      const res = await fetch(`${this.httpBaseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDir }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }))
        throw new Error(`Failed to create session: ${(err as any).message}`)
      }
      const data = (await res.json()) as { sessionId: string }
      return data.sessionId
    } finally {
      clearTimeout(timer)
    }
  }

  async listRecentProjects(): Promise<RecentProject[]> {
    const { controller, timer } = this.createTimeoutController()
    try {
      const res = await fetch(`${this.httpBaseUrl}/api/sessions/recent-projects`, {
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`Failed to list projects: ${res.statusText}`)
      }
      const data = (await res.json()) as { projects: RecentProject[] }
      return data.projects
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Match a project by index (1-based) or fuzzy name from recent projects.
   * Returns { project, ambiguous[] } — ambiguous is set when multiple projects match.
   */
  async matchProject(query: string): Promise<{ project?: RecentProject; ambiguous?: RecentProject[] }> {
    const directPath = resolveExistingProjectPath(query)
    if (directPath) {
      if (!isPathWithinAllowedRoots(directPath, this.allowedProjectRoots)) {
        return {}
      }

      return {
        project: {
          projectPath: directPath,
          realPath: directPath,
          projectName: path.basename(directPath) || directPath,
          isGit: fs.existsSync(path.join(directPath, '.git')),
          repoName: null,
          branch: null,
          modifiedAt: new Date().toISOString(),
          sessionCount: 0,
        },
      }
    }

    const projects = await this.listRecentProjects()

    // Try as 1-based index
    const num = parseInt(query, 10)
    if (!isNaN(num) && num >= 1 && num <= projects.length && String(num) === query.trim()) {
      return { project: projects[num - 1] }
    }

    const q = query.toLowerCase()

    // Exact project name match
    const exact = projects.find(p => p.projectName.toLowerCase() === q)
    if (exact) return { project: exact }

    // Fuzzy: name or path contains query
    const matches = projects.filter(p =>
      p.projectName.toLowerCase().includes(q) ||
      p.realPath.toLowerCase().includes(q)
    )
    if (matches.length === 1) return { project: matches[0] }
    if (matches.length > 1) return { ambiguous: matches }

    return {}
  }

  async getGitInfo(sessionId: string): Promise<GitInfo> {
    const { controller, timer } = this.createTimeoutController()
    try {
      const res = await fetch(`${this.httpBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/git-info`, {
        signal: controller.signal,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }))
        throw new Error(`Failed to load git info: ${(err as any).message}`)
      }
      return (await res.json()) as GitInfo
    } finally {
      clearTimeout(timer)
    }
  }

  async getSessionSlashCommands(sessionId: string): Promise<Array<{ name: string; description: string }>> {
    const { controller, timer } = this.createTimeoutController()
    try {
      const res = await fetch(`${this.httpBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/slash-commands`, {
        signal: controller.signal,
      })
      if (!res.ok) {
        if (res.status === 404) return []
        const err = await res.json().catch(() => ({ message: res.statusText }))
        throw new Error(`Failed to load slash commands: ${(err as any).message}`)
      }
      const data = (await res.json()) as { commands?: Array<{ name: string; description?: string }> }
      return Array.isArray(data.commands)
        ? data.commands.map((command) => ({
            name: String(command.name ?? ''),
            description: String(command.description ?? ''),
          })).filter((command) => command.name.trim().length > 0)
        : []
    } finally {
      clearTimeout(timer)
    }
  }

  async getTasksForSession(sessionId: string): Promise<SessionTask[]> {
    const { controller, timer } = this.createTimeoutController()
    try {
      const res = await fetch(`${this.httpBaseUrl}/api/tasks/lists/${encodeURIComponent(sessionId)}`, {
        signal: controller.signal,
      })
      if (!res.ok) {
        if (res.status === 404) return []
        const err = await res.json().catch(() => ({ message: res.statusText }))
        throw new Error(`Failed to load tasks: ${(err as any).message}`)
      }
      const data = (await res.json()) as { tasks?: SessionTask[] }
      return Array.isArray(data.tasks) ? data.tasks : []
    } finally {
      clearTimeout(timer)
    }
  }

  async listModels(): Promise<ApiModelList> {
    const { controller, timer } = this.createTimeoutController()
    try {
      const res = await fetch(`${this.httpBaseUrl}/api/models`, {
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`Failed to list models: ${res.statusText}`)
      }
      return (await res.json()) as ApiModelList
    } finally {
      clearTimeout(timer)
    }
  }

  async listProviders(): Promise<ProviderList> {
    const { controller, timer } = this.createTimeoutController()
    try {
      const res = await fetch(`${this.httpBaseUrl}/api/providers`, {
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`Failed to list providers: ${res.statusText}`)
      }
      return (await res.json()) as ProviderList
    } finally {
      clearTimeout(timer)
    }
  }

  async listRuntimeModelOptions(): Promise<RuntimeModelOption[]> {
    const [providerList, activeModels] = await Promise.all([
      this.listProviders(),
      this.listModels(),
    ])
    const options: RuntimeModelOption[] = []
    const seen = new Set<string>()

    const addOption = (option: RuntimeModelOption) => {
      const key = `${option.providerId ?? 'official'}:${option.modelId}`
      if (seen.has(key) || !option.modelId.trim()) return
      seen.add(key)
      options.push(option)
    }

    for (const provider of providerList.providers) {
      for (const model of buildProviderModelEntries(provider.models)) {
        addOption({
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          modelName: model.name,
          description: model.description,
          context: '',
          activeProvider: providerList.activeId === provider.id,
        })
      }
    }

    if (providerList.providers.length === 0 || activeModels.provider === null) {
      for (const model of activeModels.models) {
        addOption({
          providerId: null,
          providerName: 'Official / Default',
          modelId: model.id,
          modelName: model.name || model.id,
          description: model.description || 'Model',
          context: model.context || '',
          activeProvider: providerList.activeId === null,
        })
      }
    }

    return options
  }
}

function buildProviderModelEntries(models: ProviderModelMapping): ApiModelInfo[] {
  const entries: ApiModelInfo[] = []
  addProviderModel(entries, models.main, 'Main model')
  addProviderModel(entries, models.haiku, 'Haiku model')
  addProviderModel(entries, models.sonnet, 'Sonnet model')
  addProviderModel(entries, models.opus, 'Opus model')
  return entries
}

function addProviderModel(entries: ApiModelInfo[], id: string, description: string): void {
  const modelId = id.trim()
  if (!modelId || entries.some((entry) => entry.id === modelId)) return
  entries.push({
    id: modelId,
    name: modelId,
    description,
    context: '',
  })
}

function isPathWithinAllowedRoots(target: string, roots: string[]): boolean {
  if (roots.length === 0) return false

  for (const root of roots) {
    const relative = path.relative(root, target)
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      return true
    }
  }

  return false
}

function resolveExistingProjectPath(query: string): string | null {
  const trimmed = query.trim()
  if (!trimmed) return null

  const expanded = trimmed === '~'
    ? os.homedir()
    : trimmed.startsWith('~/')
      ? path.join(os.homedir(), trimmed.slice(2))
      : trimmed

  if (!path.isAbsolute(expanded)) return null

  try {
    const realPath = fs.realpathSync(expanded)
    return fs.statSync(realPath).isDirectory() ? realPath : null
  } catch {
    return null
  }
}
