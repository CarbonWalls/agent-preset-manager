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
- **Delete** a custom preset (removes its section from the managed data bundle).

## How it works (Host side)

Uses only public Host services (`webServer`, `pluginManager`, `agentPresets`).

Presets you create here live in a single managed **data bundle** at
`<profile>/web-agent-presets/data` (`@local/dsh-web-agent-preset-data`): one
marker-delimited section per preset in its `cordis.patch.yml`. Every save
rewrites that one small file and pushes it back through the plugin manager's
HMR reload (`setBundleEnabled(name, true)` re-reads the patch from disk), so
no `pnpm install` runs per operation — saves stay fast even on modest hardware.

| Operation | Mechanism |
|---|---|
| list | `agentPresets.remoteExportList()` (memoized 60s, invalidated on writes) + a tiny read of the managed patch |
| create | append a section to the data-bundle patch, one HMR re-apply |
| update | rewrite that section in the data-bundle patch, one HMR re-apply |
| delete | remove that section from the data-bundle patch, one HMR re-apply |

The first time a data bundle is introduced it must be installed once (a
single pnpm add). Install it up front to keep the very first save fast too:

```
# from the "data" directory above
dsh plugin install ./web-agent-presets/data
```

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
  yet from this view (create fresh, or hand-edit the data-bundle patch section).
  Creating a preset from a shipped one preserves `!!js` verbatim.
- Saves and loads are memoized on the Host side; on entry-level machines this
  turns ~2.5s loads into ~10ms and ~40–50s pnpm-driven saves into a single
  ~6–7s hot re-apply.
- The plugin's own button styling uses the theme's on-brand foreground token,
  so the primary "Create" button stays readable in both light and dark themes.
- This bundle's installation required no changes to shipped files.
