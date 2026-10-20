/**
 * Agent Presets — Host half.
 *
 * Serves a small authenticated bridge on the web server so the Web UI can
 * create, duplicate, edit and delete named agent presets.
 *
 * Presets are ordinary `@deepseek-ai/dsh-agent-preset` declarations carried by
 * a single managed "data bundle" (`<profile>/web-agent-presets/data`): one
 * marker-delimited section per preset inside its `cordis.patch.yml`. Every
 * save rewrites that one small file and pushes it back through the plugin
 * manager's HMR reload by toggling the bundle layer — no `pnpm install` per
 * operation — so save stays fast even on modest machines.
 *
 * The one genuinely slow Host read (`agentPresets.remoteExportList`, which
 * waits on every fiber in every preset tree) is memoized with a short TTL and
 * invalidated on every write, so opening the page and re-listing after a save
 * are both fast.
 *
 * Only public Host services are used (webServer, pluginManager, agentPresets).
 */
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, writeFile, readFile, cp, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { parse } from 'yaml'

export const name = 'web-agent-presets'
export const inject = []

const PRESET_PACKAGE = '@deepseek-ai/dsh-agent-preset'
const DATA_PACKAGE = '@local/dsh-web-agent-preset-data'
const BRIDGE_PREFIX = '/api/web-agent-presets'
const MAX_BODY_BYTES = 512 * 1024

const JS_TAG = { tag: 'tag:yaml.org,2002:js', resolve: (value) => value }

const DOC_HEADER =
  '# Managed by web-agent-presets (Settings > Preset manager).\n' +
  '# One section per preset sits between its markers and round-trips verbatim.'

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SECTION_RE = /# >>> preset:([A-Za-z0-9.-]+) kind=(insert|override)\n/g

// remoteExportList waits on every preset fiber (~seconds on a large profile).
// Memoize it briefly and invalidate on every write so repeated lists are fast.
let rosterCache = { at: 0, value: null }
const ROSTER_TTL_MS = 60_000

/** Error carrying a stable machine-readable code for the bridge response. */
class BridgeError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export function apply(ctx) {
  ctx.inject(['webServer', 'pluginManager', 'agentPresets'], (sctx) => {
    sctx.effect(() => {
      const routes = makeRoutes(sctx)
      const disposers = routes.map((route) => sctx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'web-agent-presets: bridge')
  })
}

/** @param {import('@deepseek-ai/cordis').Context} sctx */
function makeRoutes(sctx) {
  const { pluginManager, agentPresets } = sctx

  const profileDir = () => sctx.get?.('profileContext')?.dir ?? join(homedir(), '.dsh')
  const dataDir = () => join(profileDir(), 'web-agent-presets', 'data')
  const patchPath = () => join(dataDir(), 'cordis.patch.yml')

  /** Ensure the managed data-bundle package exists and return its facts. */
  async function ensureDataBundle() {
    const dir = dataDir()
    await mkdir(dir, { recursive: true })
    const pkgPath = join(dir, 'package.json')
    let name = DATA_PACKAGE
    if (existsSync(pkgPath)) {
      try {
        const existing = JSON.parse(await readFile(pkgPath, 'utf8'))
        if (existing && typeof existing.name === 'string') name = existing.name
      } catch {
        throw new BridgeError('data-corrupt', 'The preset data bundle manifest cannot be read; restore it from the Plugin Manager page.')
      }
    } else {
      await writeFile(
        pkgPath,
        JSON.stringify(
          {
            name: DATA_PACKAGE,
            version: '1.0.0',
            private: true,
            type: 'module',
            dsh: { bundle: { patch: './cordis.patch.yml' } },
          },
          null,
          2,
        ) + '\n',
      )
    }
    return { dir, name, patchPath: join(dir, 'cordis.patch.yml') }
  }

  /** Read the managed patch: preamble header + marker-delimited sections. */
  async function readDoc() {
    const path = patchPath()
    if (!existsSync(path)) return { header: DOC_HEADER, sections: [] }
    const text = await readFile(path, 'utf8')
    const lines = text.split('\n')
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (line.startsWith('# >>>') || (line.trim() !== '' && !line.startsWith('#'))) break
      i++
    }
    const header = lines.slice(0, i).join('\n')
    const rest = lines.slice(i).join('\n')
    const sections = []
    let lastEnd = -1
    let match
    while ((match = SECTION_RE.exec(rest)) !== null) {
      const closeMarker = `# <<< preset:${match[1]}`
      const close = rest.indexOf('\n' + closeMarker, match.index)
      if (close === -1) throw new BridgeError('data-corrupt', `the managed patch lost its closing marker for preset ${match[1]}`)
      const body = rest.slice(SECTION_RE.lastIndex, close)
      if (match.index > lastEnd + 1) {
        const stray = rest.slice(lastEnd + 1, match.index).trim()
        if (stray && stray !== '[]') throw new BridgeError('data-corrupt', 'the managed patch has content outside its markers')
      }
      sections.push({ id: match[1], kind: match[2], body })
      lastEnd = close + closeMarker.length + 1
    }
    if (lastEnd >= 0) {
      const tail = rest.slice(lastEnd).trim()
      if (tail && tail !== '[]') throw new BridgeError('data-corrupt', 'the managed patch has content after its last section')
    } else if (rest.trim() !== '[]' && rest.trim() !== '') {
      throw new BridgeError('data-corrupt', 'the managed patch was hand-edited outside its markers')
    }
    return { header, sections }
  }

  /** Write the managed patch with a best-effort .bak, atomically. */
  async function writeDoc(sections, header) {
    const path = patchPath()
    const body = sections.length === 0
      ? '[]'
      : sections.map((s) => `# >>> preset:${s.id} kind=${s.kind}\n${s.body}\n# <<< preset:${s.id}`).join('\n')
    const text = `${header || DOC_HEADER}\n\n${body}\n`
    if (existsSync(path)) await cp(path, path + '.bak').catch(() => {})
    const tmp = path + '.tmp'
    await writeFile(tmp, text)
    await rename(tmp, path)
  }

  // ------------------------------------------------------------ yaml emission

  function yamlScalar(value) {
    if (value === undefined || value === null || value === '') return undefined
    const flat = String(value).replace(/\s+/g, ' ').trim()
    if (flat === '') return undefined
    return `'${flat.replace(/'/g, "''")}'`
  }

  function indentLines(text, spaces) {
    const pad = ' '.repeat(spaces)
    return text
      .split('\n')
      .map((line) => (line.length > 0 ? pad + line : line))
      .join('\n')
  }

  function configLines(fields, pad) {
    const p = ' '.repeat(pad)
    const lines = [`${p}id: ${fields.id}`]
    const name = yamlScalar(fields.name)
    if (name !== undefined) lines.push(`${p}name: ${name}`)
    const description = yamlScalar(fields.description)
    if (description !== undefined) lines.push(`${p}description: ${description}`)
    if (fields.order !== undefined && fields.order !== null && fields.order !== '' && Number.isFinite(Number(fields.order))) {
      lines.push(`${p}order: ${Number(fields.order)}`)
    }
    lines.push(`${p}plugins:`)
    const plugins = typeof fields.pluginsYaml === 'string' ? fields.pluginsYaml.trim() : ''
    if (plugins) lines.push(indentLines(plugins, pad + 2))
    else lines.push(`${' '.repeat(pad + 2)}[]`)
    return lines.join('\n')
  }

  function insertSection(fields) {
    const pad = 8
    const lines = [
      '- insert:',
      `    - id: preset-${fields.id}`,
      `      name: '${PRESET_PACKAGE}'`,
      '      config:',
      configLines(fields, pad),
    ]
    return lines.join('\n')
  }

  // ------------------------------------------------------------------- roster

  async function invalidateCaches() {
    rosterCache = { at: 0, value: null }
  }

  async function cachedRoster() {
    const now = Date.now()
    if (rosterCache.value !== null && now - rosterCache.at < ROSTER_TTL_MS) return rosterCache.value
    const value = await agentPresets.remoteExportList()
    rosterCache = { at: now, value }
    return value
  }

  /** Weak helper: which presets does this page manage (cheap patch read). */
  async function managedIds() {
    try {
      const doc = await readDoc()
      return new Set(doc.sections.map((section) => section.id))
    } catch {
      // a corrupt patch must not block the roster page; writes will surface it
      return new Set()
    }
  }

  // -------------------------------------------------------------- validation

  function assertNewId(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw new BridgeError(
        'invalid-id',
        'Preset id must only contain lowercase letters, digits and hyphens (e.g. "code-reviewer").',
      )
    }
  }

  function assertName(name) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new BridgeError('invalid-name', 'A display name is required.')
    }
  }

  function presetFields(request) {
    const fields = {}
    const name = typeof request?.name === 'string' ? request.name.trim() : ''
    if (name !== '') fields.name = name
    const description = typeof request?.description === 'string' ? request.description.trim() : ''
    if (description !== '') fields.description = description
    if (request?.order !== undefined && request.order !== null && request.order !== '' && Number.isFinite(Number(request.order))) {
      fields.order = Number(request.order)
    }
    return fields
  }

  function parsePlugins(pluginsYaml) {
    if (typeof pluginsYaml !== 'string' || pluginsYaml.trim().length === 0) {
      throw new BridgeError('invalid-plugins', 'A plugin list is required.')
    }
    let rows
    try {
      rows = parse(pluginsYaml, { customTags: [JS_TAG] })
    } catch (error) {
      throw new BridgeError('invalid-yaml', `Could not parse the plugin list: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!Array.isArray(rows)) {
      throw new BridgeError('invalid-plugins', 'The plugin list must be a YAML list of plugin rows.')
    }
    for (const row of rows) {
      if (row === null || typeof row !== 'object' || Array.isArray(row) || typeof row.name !== 'string' || row.name.length === 0) {
        throw new BridgeError('invalid-plugins', 'Every plugin row needs a non-empty "name".')
      }
    }
    if (rows.length === 0) {
      throw new BridgeError('invalid-plugins', 'A preset needs at least one plugin row.')
    }
    return rows
  }

  // ---------------------------------------------------------------- persistence

  /** Push the rewritten data bundle through the manager's HMR reload. */
  async function applyDataBundle() {
    const { dir, name } = await ensureDataBundle()
    let result = await pluginManager.installBundle(dir, { enabled: true })
    if (result?.application === 'failed' && result?.error?.code === 'already-installed') {
      // Already a profile dependency: installBundle short-circuits, but a
      // single setBundleEnabled(name, true) on an already-selected bundle still
      // publishes and reconciles the profile — re-reading every patch from
      // disk — so the just-rewritten data-bundle patch is applied with one
      // recomposition (no off/on pair needed, saving a whole reload).
      result = await pluginManager.setBundleEnabled(name, true)
    }
    return summarize(result, name)
  }

  function summarize(result, target) {
    return {
      changed: result?.changed === true,
      application: result?.application,
      stage: result?.stage,
      target,
      bundle: result?.bundle,
      version: result?.version,
      warnings: result?.warnings ?? [],
      error: result?.error ? { code: result.error.code, diagnostic: result.error.diagnostic } : undefined,
    }
  }

  async function ensureNewId(id) {
    // Targeted duplicate probe: resolve() identifies one preset without the
    // expensive full-roster diagnostic.
    try {
      await agentPresets.resolve(id)
      throw new BridgeError('duplicate', `A preset named "${id}" already exists.`)
    } catch (error) {
      if (error instanceof BridgeError) throw error
      // unknown id → safe to create
    }
  }

  const handlers = {
    async list() {
      const [managed, { name: dataName }, roster] = await Promise.all([managedIds(), ensureDataBundle(), cachedRoster()])
      const presets = (roster?.presets ?? []).map((preset) => {
        const custom = managed.has(preset.id)
        return {
          id: preset.id,
          name: preset.name,
          description: preset.description,
          isDefault: preset.isDefault === true,
          broken: preset.broken,
          custom,
          bundle: custom ? dataName : undefined,
        }
      })
      return { ok: true, value: { presets } }
    },
    async read(request) {
      const id = request?.id
      if (typeof id !== 'string' || id.length === 0) {
        throw new BridgeError('invalid-id', 'A preset id is required.')
      }
      const document = await agentPresets.readDocument(id)
      return { ok: true, value: { id, name: document.name, description: document.description, content: document.content } }
    },
    async create(request) {
      const id = request?.id
      assertNewId(id)
      assertName(request?.name)
      const fields = presetFields(request)
      const pluginsYaml = typeof request?.pluginsYaml === 'string' ? request.pluginsYaml : ''
      parsePlugins(pluginsYaml)
      await ensureNewId(id)
      const doc = await readDoc()
      if (doc.sections.some((section) => section.id === id)) {
        throw new BridgeError('duplicate', `A preset named "${id}" already exists.`)
      }
      doc.sections.push({ id, kind: 'insert', body: insertSection({ id, ...fields, pluginsYaml }) })
      await writeDoc(doc.sections, doc.header)
      const result = await applyDataBundle()
      invalidateCaches()
      return { ...result, ok: true, id }
    },
    async update(request) {
      const id = request?.id
      assertNewId(id)
      assertName(request?.name)
      const fields = presetFields(request)
      const pluginsYaml = typeof request?.pluginsYaml === 'string' ? request.pluginsYaml : ''
      if (/\b!!js\b/.test(pluginsYaml)) {
        throw new BridgeError(
          'js-unsupported',
          'Editing a preset with `!!js` expressions is not supported from this view yet. Create a fresh preset, or hand-edit the profile patch for that row.',
        )
      }
      parsePlugins(pluginsYaml)
      const doc = await readDoc()
      const section = doc.sections.find((s) => s.id === id && s.kind === 'insert')
      if (section === undefined) {
        throw new BridgeError(
          'not-live',
          `Preset "${id}" is not managed by this page (it may be shipped or declared by another bundle); delete and recreate it instead.`,
        )
      }
      section.body = insertSection({ id, ...fields, pluginsYaml })
      await writeDoc(doc.sections, doc.header)
      const result = await applyDataBundle()
      invalidateCaches()
      return { ...result, ok: true, id, changed: true, application: 'applied' }
    },
    async remove(request) {
      const id = request?.id
      assertNewId(id)
      const doc = await readDoc()
      const index = doc.sections.findIndex((section) => section.id === id)
      if (index === -1) {
        throw new BridgeError(
          'not-deletable',
          `Preset "${id}" is not managed by this page and cannot be deleted here — duplicate it to make an editable copy.`,
        )
      }
      doc.sections.splice(index, 1)
      await writeDoc(doc.sections, doc.header)
      const result = await applyDataBundle()
      invalidateCaches()
      // best-effort: drop a stale per-preset source dir left by older versions
      try { await rm(join(profileDir(), 'web-agent-presets', id), { recursive: true, force: true }) } catch { /* harmless */ }
      return { ...result, ok: true, id }
    },
  }

  /** Loopback + POST guard for the small browser bridge. */
  function isLoopbackRequest(request) {
    const address = request.socket?.remoteAddress
    if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
    const host = request.headers?.host
    if (typeof host !== 'string') return false
    let hostUrl
    try {
      hostUrl = new URL('http://' + host)
    } catch {
      return false
    }
    if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
    if (request.headers?.['sec-fetch-site'] === 'cross-site') return false
    const origin = request.headers?.origin
    if (origin === undefined) return true
    try {
      return new URL(origin).host === hostUrl.host
    } catch {
      return false
    }
  }

  function writeJson(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
    response.end(JSON.stringify(body))
  }

  async function readJsonBody(request) {
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) return undefined
      chunks.push(chunk)
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return undefined
    }
  }

  const guard = (request, response) => {
    if (!isLoopbackRequest(request)) {
      writeJson(response, 403, { error: 'loopback requests only' })
      return false
    }
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: 'method not allowed: ' + (request.method ?? '') })
      return false
    }
    return true
  }

  const route = (path, handler) => ({
    kind: 'exact',
    path,
    handler: async (request, response) => {
      if (!guard(request, response)) return
      const body = (await readJsonBody(request)) ?? {}
      let result
      try {
        result = await handler(body)
      } catch (error) {
        const code = error instanceof BridgeError ? error.code : 'internal'
        const message = error instanceof Error ? error.message : String(error)
        result = { ok: false, code, message }
      }
      writeJson(response, 200, result)
    },
  })

  return [
    route(`${BRIDGE_PREFIX}/list`, handlers.list),
    route(`${BRIDGE_PREFIX}/read`, handlers.read),
    route(`${BRIDGE_PREFIX}/create`, handlers.create),
    route(`${BRIDGE_PREFIX}/update`, handlers.update),
    route(`${BRIDGE_PREFIX}/remove`, handlers.remove),
  ]
}
