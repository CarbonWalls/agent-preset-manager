/**
 * Agent Presets — browser half.
 *
 * A Settings section ("Agent Presets") that lists every agent preset (default
 * and broken states included) and lets the user create, duplicate, edit and
 * delete custom presets. Data flows through the Host bridge at
 * /api/web-agent-presets/*. Styles use only the Host theme tokens.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-web-agent-presets',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'web-agent-presets';
    const BRIDGE = '/api/web-agent-presets';

    const css = `
.wap{display:flex;flex-direction:column;gap:14px;padding:2px 2px 20px;font-family:-apple-system,"SF Pro Text","Segoe UI",system-ui,sans-serif}
.wap-intro{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5;margin:0}
.wap-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.wap-error{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:1.5}
.wap-btn{height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.wap-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.wap-btn:disabled{opacity:.5;cursor:default}
.wap-btn-primary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.wap-btn-primary:hover{background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground)}
.wap-btn-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.wap-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.wap-card{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px;min-width:0}
.wap-card-broken{border-color:var(--dsw-alias-state-error-primary)}
.wap-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wap-name{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wap-id{font-size:12px;color:var(--dsw-alias-label-secondary)}
.wap-tag{flex:none;font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-state-idle-primary)}
.wap-tag-default{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.wap-tag-broken{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.wap-desc{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5;margin:0;word-break:break-word}
.wap-broken{font-size:12px;color:var(--dsw-alias-state-error-primary);margin:0;word-break:break-word}
.wap-foot{margin-top:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wap-actions-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wap-form{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:16px;display:flex;flex-direction:column;gap:12px}
.wap-field{display:flex;flex-direction:column;gap:5px}
.wap-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.wap-input,.wap-select,.wap-textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:8px 10px}
.wap-input:focus-visible,.wap-select:focus-visible,.wap-textarea:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}
.wap-textarea{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12px;line-height:1.5;min-height:200px;resize:vertical;white-space:pre}
.wap-hint{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5;margin:0}
.wap-note{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0}
.wap-spacer{flex:1}
.wap-view{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px}
.wap-pre{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12px;line-height:1.55;white-space:pre;overflow:auto;max-height:340px;color:var(--dsw-alias-label-primary);margin:0}
.wap-trash{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px}
`;

    function slugify(text) {
      return String(text || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    async function call(method, payload) {
      let response;
      try {
        response = await fetch(BRIDGE + '/' + method, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload || {}),
        });
      } catch (error) {
        throw new Error('Bridge unreachable: ' + (error && error.message ? error.message : String(error)));
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error('Bridge returned a non-JSON response (HTTP ' + response.status + ')');
      }
      if (data && data.ok === false) {
        const error = new Error(data.message || 'Request failed');
        error.code = data.code;
        throw error;
      }
      if (!response.ok) throw new Error(data && data.error ? data.error : 'HTTP ' + response.status);
      return data;
    }

    function Tag({ kind, children }) {
      return h('span', { className: 'wap-tag' + (kind ? ' wap-tag-' + kind : '') }, children);
    }

    function PresetCard({ preset, t, onView, onDuplicate, onEdit, onDelete, confirming }) {
      const tags = [];
      if (preset.isDefault) tags.push(h(Tag, { key: 'default', kind: 'default' }, t('default')));
      if (preset.custom) tags.push(h(Tag, { key: 'custom' }, t('custom')));
      if (preset.broken) tags.push(h(Tag, { key: 'broken', kind: 'broken' }, t('broken')));
      const actions = [
        h('button', { key: 'view', type: 'button', className: 'wap-btn', onClick: () => onView(preset) }, t('view')),
        h('button', { key: 'dup', type: 'button', className: 'wap-btn', onClick: () => onDuplicate(preset) }, t('duplicate')),
      ];
      if (preset.custom) {
        actions.push(h('button', { key: 'edit', type: 'button', className: 'wap-btn', onClick: () => onEdit(preset) }, t('edit')));
        if (confirming === preset.id) {
          actions.push(
            h('span', { key: 'confirm', className: 'wap-trash' },
              h('span', null, t('deleteConfirmText', { id: preset.id })),
              h('button', { type: 'button', className: 'wap-btn wap-btn-danger', onClick: () => onDelete(preset) }, t('delete')),
              h('button', { type: 'button', className: 'wap-btn', onClick: () => onDelete(preset, true) }, t('cancel')),
            )
          );
        } else {
          actions.push(h('button', { key: 'del', type: 'button', className: 'wap-btn wap-btn-danger', onClick: () => onDelete(preset) }, t('delete')));
        }
      }
      return h('div', { className: 'wap-card' + (preset.broken ? ' wap-card-broken' : '') },
        h('div', { className: 'wap-head' },
          h('span', { className: 'wap-name', title: preset.name || preset.id }, preset.name || preset.id),
          h('span', { className: 'wap-id' }, preset.id),
          tags,
        ),
        preset.description ? h('p', { className: 'wap-desc' }, preset.description) : null,
        preset.broken ? h('p', { className: 'wap-broken' }, preset.broken) : null,
        h('div', { className: 'wap-foot' },
          h('div', { className: 'wap-actions-row' }, actions),
        ),
      );
    }

    function PresetForm({ mode, preset, sources, t, onSubmit, onCancel, onPickSource }) {
      const [id, setId] = React.useState(preset.id);
      const [name, setName] = React.useState(preset.name);
      const [description, setDescription] = React.useState(preset.description || '');
      const [order, setOrder] = React.useState(preset.order === undefined ? '' : String(preset.order));
      const [pluginsYaml, setPluginsYaml] = React.useState(preset.pluginsYaml);
      const [saving, setSaving] = React.useState(false);
      const [suggestedId, setSuggestedId] = React.useState(preset.id);

      const onNameChange = (value) => {
        setName(value);
        const slug = slugify(value);
        if (mode !== 'edit' && (id === '' || id === suggestedId || id === preset.id)) {
          setId(slug);
          setSuggestedId(slug);
        }
      };

      const submit = () => {
        setSaving(true);
        onSubmit({ id: id || slugify(name), name: name.trim(), description: description.trim(), order, pluginsYaml }, () => setSaving(false));
      };

      return h('form', { className: 'wap-form', onSubmit: (event) => { event.preventDefault(); submit(); } },
        h('div', { className: 'wap-field' },
          h('label', { className: 'wap-label', htmlFor: NS + '-name' }, t('fieldName')),
          h('input', { id: NS + '-name', className: 'wap-input', value: name, onChange: (e) => onNameChange(e.target.value), placeholder: t('fieldNamePh'), required: true }),
        ),
        mode !== 'edit' ? h('div', { className: 'wap-field' },
          h('label', { className: 'wap-label', htmlFor: NS + '-id' }, t('fieldId')),
          h('input', { id: NS + '-id', className: 'wap-input', value: id, onChange: (e) => { setId(e.target.value); setSuggestedId(slugify(e.target.value)); }, placeholder: t('fieldIdPh'), required: true, pattern: '[a-z0-9]+(-[a-z0-9]+)*', title: t('fieldIdHelp') }),
          h('p', { className: 'wap-hint' }, t('fieldIdHelp')),
        ) : null,
        h('div', { className: 'wap-field' },
          h('label', { className: 'wap-label', htmlFor: NS + '-desc' }, t('fieldDesc')),
          h('input', { id: NS + '-desc', className: 'wap-input', value: description, onChange: (e) => setDescription(e.target.value) }),
        ),
        h('div', { className: 'wap-field' },
          h('label', { className: 'wap-label', htmlFor: NS + '-order' }, t('fieldOrder')),
          h('input', { id: NS + '-order', className: 'wap-input', type: 'number', step: 1, value: order, onChange: (e) => setOrder(e.target.value), placeholder: t('fieldOrderPh') }),
          h('p', { className: 'wap-hint' }, t('fieldOrderHelp')),
        ),
        mode !== 'edit' && sources.length > 0 ? h('div', { className: 'wap-field' },
          h('label', { className: 'wap-label', htmlFor: NS + '-start' }, t('startFrom')),
          h('select', { id: NS + '-start', className: 'wap-select', defaultValue: '', onChange: (e) => onPickSource(e.target.value, { setId, setPluginsYaml, setDescription, setSuggestedId }) },
            h('option', { value: '' }, t('startFromEmpty')),
            sources.map((source) => h('option', { key: source.id, value: source.id }, source.name || source.id)),
          ),
        ) : null,
        h('div', { className: 'wap-field' },
          h('label', { className: 'wap-label', htmlFor: NS + '-plugins' }, t('fieldPlugins')),
          h('textarea', { id: NS + '-plugins', className: 'wap-textarea', value: pluginsYaml, onChange: (e) => setPluginsYaml(e.target.value), placeholder: '- id: persona\n  name: \'@deepseek-ai/dsh-persona\'\n  config:\n    prefix: You are ...\n', spellCheck: false }),
          h('p', { className: 'wap-hint' }, t('fieldPluginsHelp')),
        ),
        saving ? h('p', { className: 'wap-note' }, t('saving')) : null,
        h('div', { className: 'wap-actions-row' },
          h('button', { type: 'submit', className: 'wap-btn wap-btn-primary', disabled: saving }, mode === 'edit' ? t('save') : t('create')),
          h('button', { type: 'button', className: 'wap-btn', onClick: onCancel, disabled: saving }, t('cancel')),
        ),
      );
    }

    function PresetsSection(props) {
      const { api, t } = props;
      const [state, setState] = React.useState({ phase: 'loading', presets: [], error: null });
      const [editor, setEditor] = React.useState(null); // {mode, preset?, source?}
      const [viewing, setViewing] = React.useState(null); // {id, name, content, loading, error}
      const [confirmingId, setConfirmingId] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [busyError, setBusyError] = React.useState(null);

      const load = React.useCallback(() => {
        let alive = true;
        setState({ phase: 'loading', presets: [], error: null });
        setBusyError(null);
        api.list().then(
          (data) => { if (alive) setState({ phase: 'ready', presets: data.value.presets, error: null }); },
          (error) => { if (alive) setState({ phase: 'ready', presets: [], error: error.message }); }
        );
        return () => { alive = false; };
      }, [api]);

      React.useEffect(load, [load]);

      const fail = (message) => setBusyError(message);

      const openCreate = () => {
        setBusyError(null);
        setViewing(null);
        setEditor({ mode: 'create', preset: { id: '', name: '', description: '', pluginsYaml: '' } });
      };

      const openEdit = (preset) => {
        setBusyError(null);
        setViewing(null);
        setBusy(true);
        api.read(preset.id).then(
          (data) => {
            const value = data.value;
            setEditor({ mode: 'edit', preset: { id: value.id, name: value.name || value.id, description: value.description || '', pluginsYaml: value.content } });
            setBusy(false);
          },
          (error) => { setBusy(false); fail(error.message); }
        );
      };

      const openDuplicate = (preset) => {
        setBusyError(null);
        setViewing(null);
        setBusy(true);
        api.read(preset.id).then(
          (data) => {
            const value = data.value;
            setEditor({ mode: 'create', preset: { id: slugify((value.name || value.id) + ' copy'), name: (value.name || value.id) + ' copy', description: value.description || '', pluginsYaml: value.content } });
            setBusy(false);
          },
          (error) => { setBusy(false); fail(error.message); }
        );
      };

      const openView = (preset) => {
        setBusyError(null);
        setEditor(null);
        setViewing({ id: preset.id, name: preset.name, content: null, loading: true, error: null });
        api.read(preset.id).then(
          (data) => setViewing((v) => (v && v.id === preset.id ? { id: preset.id, name: data.value.name, content: data.value.content, loading: false, error: null } : v)),
          (error) => setViewing((v) => (v && v.id === preset.id ? { id: preset.id, name: preset.name, content: null, loading: false, error: error.message } : v))
        );
      };

      const pickSource = (id, form) => {
        if (!id) return;
        setBusy(true);
        api.read(id).then(
          (data) => {
            const value = data.value;
            form.setDescription(value.description || '');
            form.setPluginsYaml(value.content);
            const slug = slugify((value.name || id) + ' copy');
            form.setId(slug);
            form.setSuggestedId(slug);
            setBusy(false);
          },
          (error) => { setBusy(false); fail(error.message); }
        );
      };

      const submitEditor = (payload, done) => {
        setBusyError(null);
        setBusy(true);
        const op = editor.mode === 'edit' ? api.update : api.create;
        op(payload).then(
          () => {
            setEditor(null);
            setBusy(false);
            done && done();
            load();
          },
          (error) => { setBusy(false); done && done(); fail(error.message); }
        );
      };

      const deletePreset = (preset, cancel) => {
        if (cancel) { setConfirmingId(null); return; }
        if (confirmingId !== preset.id) { setConfirmingId(preset.id); return; }
        setConfirmingId(null);
        setBusyError(null);
        setBusy(true);
        api.remove(preset.id).then(
          () => { setBusy(false); load(); },
          (error) => { setBusy(false); fail(error.message); }
        );
      };

      return h('div', { className: 'wap' },
        h('style', { dangerouslySetInnerHTML: { __html: css } }),
        h('h2', null, t('title')),
        h('p', { className: 'wap-intro' }, t('intro')),
        h('div', { className: 'wap-actions' },
          h('button', { type: 'button', className: 'wap-btn wap-btn-primary', onClick: openCreate, disabled: busy }, t('newPreset')),
          viewing ? h('div', { className: 'wap-spacer' }, null) : null,
          viewing ? h('button', { type: 'button', className: 'wap-btn', onClick: () => setViewing(null) }, t('closeView')) : null,
        ),
        busyError ? h('p', { className: 'wap-error' }, busyError) : null,

        viewing !== null
          ? h('div', { className: 'wap-view' },
              h('div', { className: 'wap-head' },
                h('span', { className: 'wap-name' }, viewing.name || viewing.id),
                h('span', { className: 'wap-id' }, viewing.id),
              ),
              viewing.loading ? h('p', { className: 'wap-note' }, t('loading')) : null,
              viewing.error ? h('p', { className: 'wap-error' }, viewing.error) : null,
              viewing.content !== null ? h('pre', { className: 'wap-pre' }, viewing.content) : null,
            )
          : null,

        editor !== null
          ? h(PresetForm, {
              mode: editor.mode,
              preset: editor.preset,
              sources: state.presets.filter((p) => p.id !== (editor.mode === 'edit' ? editor.preset.id : editor.preset.id)),
              t,
              onSubmit: submitEditor,
              onCancel: () => { setEditor(null); setBusyError(null); },
              onPickSource: pickSource,
            })
          : null,

        state.phase === 'loading'
          ? h('p', { className: 'wap-note' }, t('loading'))
          : state.error
            ? h('p', { className: 'wap-error' }, state.error)
            : h('div', { className: 'wap-grid' },
                state.presets.map((preset) =>
                  h(PresetCard, {
                    key: preset.id,
                    preset,
                    t,
                    confirming: confirmingId,
                    onView: openView,
                    onDuplicate: openDuplicate,
                    onEdit: openEdit,
                    onDelete: deletePreset,
                  })
                ),
              ),
      );
    }

    /** English copy (key-set source of truth). */
    const en = {
      nav: 'Preset manager',
      title: 'Agent Presets',
      intro: 'Create, duplicate, edit and delete named agent presets. Custom presets are editable here; shipped presets can be viewed and duplicated.',
      newPreset: 'New preset',
      default: 'Default',
      custom: 'Custom',
      broken: 'Broken',
      view: 'View config',
      duplicate: 'Duplicate',
      edit: 'Edit',
      delete: 'Delete',
      cancel: 'Cancel',
      deleteConfirmText: 'Delete “{id}”?',
      fieldName: 'Name',
      fieldNamePh: 'e.g. Code Reviewer',
      fieldId: 'Preset id',
      fieldIdPh: 'e.g. code-reviewer',
      fieldIdHelp: 'Lowercase letters, digits and hyphens.',
      fieldDesc: 'Description',
      fieldOrder: 'Order',
      fieldOrderPh: 'e.g. 20',
      fieldOrderHelp: 'Roster position (optional).',
      startFrom: 'Start from',
      startFromEmpty: '— start empty —',
      fieldPlugins: 'Plugins (entry list YAML)',
      fieldPluginsHelp: 'One plugin row per line: `id` name (the plugin package) and optional `config`. Example: a persona plugin with a `prefix`.',
      create: 'Create preset',
      save: 'Save changes',
      saving: 'Saving…',
      loading: 'Loading…',
      closeView: 'Close',
    };

    /** Simplified Chinese copy. */
    const zh = {
      nav: '预设管理',
      title: 'Agent 预设',
      intro: '创建、复制、编辑和删除命名 Agent 预设。自定义预设可在此编辑；内置预设可查看配置或复制。',
      newPreset: '新建预设',
      default: '默认',
      custom: '自定义',
      broken: '异常',
      view: '查看配置',
      duplicate: '复制',
      edit: '编辑',
      delete: '删除',
      cancel: '取消',
      deleteConfirmText: '删除“{id}”？',
      fieldName: '名称',
      fieldNamePh: '例如：代码审查',
      fieldId: '预设 id',
      fieldIdPh: '例如：code-reviewer',
      fieldIdHelp: '仅限小写字母、数字和连字符。',
      fieldDesc: '描述',
      fieldOrder: '顺序',
      fieldOrderPh: '例如：20',
      fieldOrderHelp: '名册位置（可选）。',
      startFrom: '从现有预设开始',
      startFromEmpty: '— 空白开始 —',
      fieldPlugins: '插件列表（条目 YAML）',
      fieldPluginsHelp: '每行一个插件条目：`id`、name（插件包名）与可选 config。例如：带 prefix 的 persona 插件。',
      create: '创建预设',
      save: '保存修改',
      saving: '保存中…',
      loading: '加载中…',
      closeView: '关闭',
    };

    const inject = ['slots', 'locale'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'web-agent-presets: dictionaries');
      const t = ctx.locale.bind(NS);
      const api = {
        list: () => call('list'),
        read: (id) => call('read', { id }),
        create: (payload) => call('create', payload),
        update: (payload) => call('update', payload),
        remove: (id) => call('remove', { id }),
      };
      const injected = () => ({ api, t });
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: NS,
        order: 9,
        label: () => t('nav'),
        inject: injected,
      }, PresetsSection));
    }

    return { inject, apply };
  },
});
