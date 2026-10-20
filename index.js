/**
 * Agent Presets — Host half.
 *
 * Serves a small authenticated bridge on the web server so the Web UI can
 * create, duplicate, edit and delete named agent presets. Presets are ordinary
 * `@deepseek-ai/dsh-agent-preset` declarations:
 *   - create  → a generated patch-only bundle is installed with pluginManager (the
 *               same mechanism the Plugins page and Creator mode use);
 *   - edit    → configEditor rewrites the preset row's declaration and hot-reloads it;
 *   - delete  → the generated bundle is removed with pluginManager, and any stale
 *               configEditor override row is cleaned out of the profile patch.
 *
 * Only public Host services are used (webServer, pluginManager, configEditor,
 * agentPresets); no dsh-internal packages are imported.
 */
import { join } from 'node:path'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { parseDocument, parse } from 'yaml'

export const name = 'web-agent-presets'
export const inject = []

const PRESET_PACKAGE = '@deepseek-ai/dsh-agent-preset'
const GENERATED_PREFIX = '@local/web-agent-preset-'
const BRIDGE_PREFIX = '/api/web-agent-presets'
const MAX_BODY_BYTES = 512 * 1024

const JS_TAG = { tag: 'tag:yaml.org,2002:js', resolve: (value) => value }

/** Error carrying a stable machine-readable code for the bridge response. */
class BridgeError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function apply(ctx) {
  ctx.inject(['webServer', 'pluginManager', 'configEditor', 'agentPresets'], (sctx) => {
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
  const { pluginManager, configEditor, agentPresets } = sctx

  /** Generated preset bundles live inside the profile directory so pnpm's
   * `file:` dependency stays inside the workspace it installs into. */
  const generatedDir = () =>
    join(sctx.get?.('profileContext')?.dir ?? join(homedir(), '.dsh'), 'web-agent-presets')

  /** Roster merged with which presets we generated (editable / deletable here). */
  async function listRoster() {
    const roster = (await agentPresets.remoteExportList()).presets
    const bundleByPreset = new Map()
    try {
      const bundles = await pluginManager.listBundles()
      for (const bundle of bundles) {
        if (typeof bundle.name !== 'string' || !bundle.name.startsWith(GENERATED_PREFIX)) continue
        for (const row of bundle.rows ?? []) {
          if (
            typeof row.rowId === 'string' &&
            row.rowId.startsWith('preset-') &&
            row.moduleName === PRESET_PACKAGE
          ) {
            bundleByPreset.set(row.rowId.slice('preset-'.length), bundle.name)
          }
        }
      }
    } catch {
      // a bundle-list failure must not block the roster
    }
    return roster.map((preset) => ({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      isDefault: preset.isDefault,
      broken: preset.broken,
      custom: bundleByPreset.has(preset.id),
      bundle: bundleByPreset.get(preset.id),
    }))
  }

  function assertNewId(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw new BridgeError(
        'invalid-id',
        'Preset id must only contain lowercase letters, digits and hyphens (e.g. "code-reviewer").'
      )
    }
  }

  function assertName(name) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new BridgeError('invalid-name', 'A display name is required.')
    }
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

  function declarationFields({ name, description, order }) {
    const fields = {}
    if (typeof name === 'string') fields.name = name
    if (typeof description === 'string') fields.description = description
    if (order !== undefined && order !== null && order !== '' && Number.isFinite(Number(order))) {
      fields.order = Number(order)
    }
    return fields
  }

  /** Serialize the plugins list back to YAML (keeping `!!js` tags) and build the insert patch. */
  function buildPatch(id, { name, description, order, pluginsYaml }) {
    const document = parseDocument(pluginsYaml, { customTags: [JS_TAG] })
    if (document.contents === null || document.errors.length > 0) {
      throw new BridgeError('invalid-yaml', document.errors[0]?.message ?? 'The plugin list is empty.')
    }
    const pluginsText = document.toString().trimEnd()
    const indent = (text, spaces) =>
      text.split('\n').map((line) => (line.length > 0 ? ' '.repeat(spaces) + line : line)).join('\n')
    const fields = declarationFields({ name, description, order })
    let config = `        id: ${JSON.stringify(id)}`
    if (fields.name !== undefined) config += `\n        name: ${JSON.stringify(fields.name)}`
    if (fields.description !== undefined) config += `\n        description: ${JSON.stringify(fields.description)}`
    if (fields.order !== undefined) config += `\n        order: ${JSON.stringify(fields.order)}`
    return [
      '- insert:',
      `    - id: preset-${id}`,
      `      name: '${PRESET_PACKAGE}'`,
      '      config:',
      config,
      '        plugins:',
      indent(pluginsText, 8),
      '',
    ].join('\n')
  }

  async function writeGeneratedBundle(id, declaration) {
    const dir = join(generatedDir(), id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'cordis.patch.yml'), buildPatch(id, declaration), 'utf8')
    await writeFile(join(dir, 'index.js'), 'export function apply() {}\n', 'utf8')
    const manifest = {
      name: GENERATED_PREFIX + id,
      version: '1.0.0',
      private: true,
      type: 'module',
      exports: { '.': './index.js' },
      files: ['index.js', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    return dir
  }

  /** Drop a stale configEditor override row for a preset from the profile patch file. */
  async function removeOverrideRow(id) {
    const profile = sctx.get?.('profileContext')
    if (!profile?.patchPath) return
    const rowId = `preset-${id}`
    try {
      const before = await readFile(profile.patchPath, 'utf8')
      const document = parseDocument(before, { customTags: [JS_TAG] })
      if (document.contents === null || document.errors.length > 0) return
      const seq = document.contents.items?.[0]
      if (!seq) return
      let changed = false
      for (let index = seq.items.length - 1; index >= 0; index--) {
        const item = seq.items[index]
        if (typeof item?.get !== 'function') continue
        const idValue = item.get('id')
        const hasInsert = item.has('insert')
        const nameValue = item.get('name')
        if (!hasInsert && idValue === rowId && (nameValue === undefined || nameValue === PRESET_PACKAGE)) {
          seq.deleteIn([index])
          changed = true
        }
      }
      if (changed) await writeFile(profile.patchPath, String(document), 'utf8')
    } catch {
      // leaving a stale override row behind is harmless (the loader skips it)
    }
  }

  function summarize(result) {
    return {
      changed: result.changed ?? false,
      application: result.application,
      stage: result.stage,
      target: result.target,
      bundle: result.bundle,
      version: result.version,
      restartReason: result.restartReason,
      warnings: result.warnings ?? [],
      error: result.error ?? undefined,
    }
  }

  const handlers = {
    async list() {
      const presets = await listRoster()
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
      const { name, description, order, pluginsYaml } = request
      const roster = await listRoster()
      if (roster.some((preset) => preset.id === id)) {
        throw new BridgeError('duplicate', `A preset named "${id}" already exists.`)
      }
      parsePlugins(pluginsYaml)
      const declaration = { name, description, order, pluginsYaml }
      await writeGeneratedBundle(id, declaration)
      const result = await pluginManager.installBundle(join(generatedDir(), id), { saveExact: true })
      return { ...summarize(result), ok: true, id }
    },
    async update(request) {
      const id = request?.id
      assertNewId(id)
      assertName(request?.name)
      const { name, description, order, pluginsYaml } = request
      if (typeof pluginsYaml === 'string' && /\b!!js\b/.test(pluginsYaml)) {
        throw new BridgeError(
          'js-unsupported',
          'Editing a preset with `!!js` expressions is not supported from this view yet. Create a fresh preset, or hand-edit the profile patch for that row.'
        )
      }
      parsePlugins(pluginsYaml)
      const entry = configEditor.entries().find(
        (candidate) => candidate.options.id === `preset-${id}` && candidate.options.name === PRESET_PACKAGE
      )
      if (entry === undefined) {
        throw new BridgeError(
          'not-live',
          `Preset "${id}" is not an active row that can be edited here (it may be broken); delete and recreate it instead.`
        )
      }
      const fields = declarationFields({ name, description, order })
      await configEditor.edit(entry, () => {
        const next = { id }
        if (fields.name !== undefined) next.name = fields.name
        if (fields.description !== undefined) next.description = fields.description
        if (fields.order !== undefined) next.order = fields.order
        next.plugins = parse(pluginsYaml, { customTags: [JS_TAG] })
        return next
      })
      return { ok: true, id, changed: true, application: 'applied' }
    },
    async remove(request) {
      const id = request?.id
      assertNewId(id)
      const roster = await listRoster()
      const target = roster.find((preset) => preset.id === id)
      if (target === undefined) {
        throw new BridgeError('not-found', `Preset "${id}" was not found.`)
      }
      if (!target.custom || typeof target.bundle !== 'string') {
        throw new BridgeError(
          'not-deletable',
          `Preset "${id}" ships with the product and cannot be deleted here — duplicate it to make an editable copy.`
        )
      }
      await removeOverrideRow(id)
      const result = await pluginManager.removeBundle(target.bundle)
      // best-effort: drop the generated source dir once the bundle layer is gone
      try { await rm(join(generatedDir(), id), { recursive: true, force: true }) } catch { /* leftover source dir is harmless */ }
      return { ...summarize(result), ok: true, id }
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
