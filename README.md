# @local/dsh-web-agent-presets — Agent Presets (Web UI)

A small Harness plugin that adds an **Agent Presets** management page to the Web
UI Settings (Settings → **Preset manager**): create, duplicate, edit, view and
delete named agent presets without writing YAML by hand.

The harness ships a read-only preset selector (`@deepseek-ai/dsh-client-ui-agent-preset`)
that can only pick a default / view configs / ask an agent to author via Creator
mode. This plugin adds the missing **authoring** half.

## What it does

- **List** every declared preset (default badge, broken diagnostics, shipped vs custom).
- **Create** a new preset: id, name, description, roster order and a plugin list
  written as entry-list YAML (the same dialect the Loader uses, `!!js` accepted).
- **Duplicate** any preset (shipped ones included) into a new custom preset.
- **Edit** a custom preset's name/description/order/plugins live.
- **Delete** a custom preset (removes its bundle layer and cleans the profile patch).

## How it works (Host side)

Uses only public Host services (no dsh-internal imports):

| Operation | Mechanism |
|---|---|
| create | generates a patch-only bundle under `<profile>/web-agent-presets/<id>`, then `pluginManager.installBundle(dir)` (the same path the Plugins page / Creator mode use) |
| update | `configEditor.edit(...)` rewrites the preset declaration and hot-reloads it |
| delete | `pluginManager.removeBundle(...)`, removes stale override rows from the profile patch, and drops the generated source dir |

The Web page reads and writes through a small authenticated bridge:
`POST /api/web-agent-presets/{list,read,create,update,remove}` (loopback-only guard).

## Install / activate

Installed as profile bundle `@local/dsh-web-agent-presets` (row `web-agent-presets`).
Disable/enable from the Web Plugins page, or:

```
dsh plugin ...
```

## Notes

- The **shipped** presets (standard/ptc/minimal/cordis) can be viewed and duplicated
  but not deleted here.
- Editing a preset whose plugin list contains `!!js` expressions is not supported
  yet from this view (create fresh, or edit the profile patch for that row).
- After the Harness starts, delete also auto-cleans stale config-editor override
  rows and the generated bundle source directory.
- This bundle's installation required no changes to shipped files.
