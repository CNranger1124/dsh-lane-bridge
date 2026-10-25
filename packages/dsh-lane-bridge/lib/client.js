// Browser half of dsh-lane-bridge.
//
// Hand-written CJS-style bundle for DSH's lazy module loader: the factory only
// registers exports; module bodies run when the Settings section is first
// materialized. No build step, no UI-primitives dependency — plain React and
// inline/theme-variable styles keep the install footprint small.
window.__ModuleLoader__.load({
  id: 'dsh-lane-bridge',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useMemo } = React;

    const API = '/lane-bridge/api';
    const CSS = `
      .lb-root { display:flex; flex-direction:column; gap:14px; padding:4px 2px 28px; color: var(--dsw-alias-text-primary, #1f2328); font-size:13px; }
      .lb-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
      .lb-title { font-size:16px; font-weight:650; margin:0; }
      .lb-sub { margin:3px 0 0; color: var(--dsw-alias-text-secondary, #6b7280); font-size:12px; }
      .lb-tabs { display:flex; flex-wrap:wrap; gap:4px; border-bottom:1px solid var(--dsw-alias-border, #e5e7eb); padding-bottom:6px; }
      .lb-tab { border:0; background:transparent; color:var(--dsw-alias-text-secondary,#6b7280); padding:6px 10px; border-radius:7px; cursor:pointer; font-size:13px; }
      .lb-tab:hover { background:var(--dsw-alias-bg-hover,#f3f4f6); }
      .lb-tab--on { background:var(--dsw-alias-bg-selected,#eceff3); color:var(--dsw-alias-text-primary,#111827); font-weight:600; }
      .lb-card { border:1px solid var(--dsw-alias-border,#e5e7eb); border-radius:10px; padding:14px; background:var(--dsw-alias-bg-primary,#fff); display:flex; flex-direction:column; gap:10px; }
      .lb-card-head { display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer; user-select:none; }
      .lb-card-head:focus-visible { outline:2px solid var(--dsw-alias-accent,#2563eb); outline-offset:2px; border-radius:6px; }
      .lb-card-title { font-weight:620; font-size:13px; }
      .lb-card-body { display:flex; flex-direction:column; gap:10px; }
      .lb-chev { color:var(--dsw-alias-text-secondary,#6b7280); font-size:11px; width:12px; flex:none; }
      .lb-muted { color:var(--dsw-alias-text-secondary,#6b7280); font-size:12px; }
      .lb-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
      .lb-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:10px; }
      .lb-field { display:flex; flex-direction:column; gap:4px; min-width:0; }
      .lb-label { font-size:12px; color:var(--dsw-alias-text-secondary,#6b7280); }
      .lb-input, .lb-select, .lb-textarea { width:100%; box-sizing:border-box; border:1px solid var(--dsw-alias-border,#d1d5db); border-radius:7px; background:var(--dsw-alias-bg-primary,#fff); color:inherit; padding:7px 9px; font-size:13px; font-family:inherit; }
      .lb-textarea { min-height:110px; resize:vertical; line-height:1.5; }
      .lb-textarea--tall { min-height:260px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; }
      .lb-btn { border:1px solid var(--dsw-alias-border,#d1d5db); background:var(--dsw-alias-bg-primary,#fff); color:inherit; border-radius:7px; padding:6px 11px; cursor:pointer; font-size:12px; }
      .lb-btn:hover { background:var(--dsw-alias-bg-hover,#f3f4f6); }
      .lb-btn--primary { background:var(--dsw-alias-accent,#2563eb); border-color:var(--dsw-alias-accent,#2563eb); color:#fff; }
      .lb-btn--danger { color:#b91c1c; border-color:#fecaca; }
      .lb-btn:disabled { opacity:.55; cursor:not-allowed; }
      .lb-pill { display:inline-flex; align-items:center; gap:5px; border-radius:999px; padding:2px 8px; font-size:11px; border:1px solid var(--dsw-alias-border,#e5e7eb); }
      .lb-pill--ok { color:#047857; border-color:#a7f3d0; background:#ecfdf5; }
      .lb-pill--bad { color:#b91c1c; border-color:#fecaca; background:#fef2f2; }
      .lb-pill--idle { color:#6b7280; }
      .lb-table { width:100%; border-collapse:collapse; font-size:12px; }
      .lb-table th { text-align:left; font-weight:600; color:var(--dsw-alias-text-secondary,#6b7280); padding:6px 8px; border-bottom:1px solid var(--dsw-alias-border,#e5e7eb); }
      .lb-table td { padding:6px 8px; border-bottom:1px solid var(--dsw-alias-border,#f1f2f4); vertical-align:top; }
      .lb-error { color:#b91c1c; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:8px 10px; white-space:pre-wrap; }
      .lb-ok { color:#047857; }
      .lb-list { display:flex; flex-direction:column; gap:8px; }
      .lb-listitem { display:flex; gap:8px; align-items:center; justify-content:space-between; border:1px solid var(--dsw-alias-border,#e5e7eb); border-radius:8px; padding:8px 10px; }
      .lb-listitem--on { border-color:var(--dsw-alias-accent,#2563eb); background:var(--dsw-alias-bg-selected,#f5f8ff); }
      .lb-mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11px; }
      .lb-actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
      .lb-footer { display:flex; gap:8px; align-items:center; justify-content:flex-end; position:sticky; bottom:0; z-index:3; margin-top:4px; padding:9px 2px; background:var(--dsw-alias-bg-primary,#fff); border-top:1px solid var(--dsw-alias-border,#e5e7eb); }
      .lb-log { margin:0; max-height:320px; overflow:auto; white-space:pre-wrap; word-break:break-word; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11px; line-height:1.55; background:var(--dsw-alias-bg-secondary,#f6f7f9); border:1px solid var(--dsw-alias-border,#e5e7eb); border-radius:8px; padding:10px; }
      .lb-check { display:flex; align-items:center; gap:6px; font-size:12px; }
      .lb-sidebar { height:100%; min-height:0; overflow:auto; padding:0 2px; box-sizing:border-box; }
      .lb-sidebar .lb-root--compact { padding-bottom:16px; }
      .lb-root--compact .lb-grid { grid-template-columns:1fr; }
      .lb-root--compact .lb-table { min-width:560px; }
      .lb-root--compact .lb-title { font-size:15px; }
      .lb-root--compact .lb-sub { display:none; }
      .lb-root--compact .lb-card { padding:11px; }
    `;
    if (typeof document !== 'undefined') {
      let style = document.getElementById('dsh-lane-bridge-css');
      if (!style) {
        style = document.createElement('style');
        style.id = 'dsh-lane-bridge-css';
        document.head.appendChild(style);
      }
      style.textContent = CSS;
    }

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    async function api(path, options = {}) {
      const res = await fetch(`${API}${path}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        ...options,
        headers: {
          'x-lane-bridge': '1',
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(options.headers ?? {}),
        },
      });
      const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    }

    function Field({ label, hint, children }) {
      return h('div', { className: 'lb-field' },
        h('span', { className: 'lb-label' }, label),
        children,
        hint ? h('span', { className: 'lb-muted' }, hint) : null
      );
    }

    function Card({ title, extra, children, defaultOpen = true }) {
      const [open, setOpen] = useState(defaultOpen);
      const toggle = () => setOpen((value) => !value);
      return h('div', { className: 'lb-card' },
        h('div', {
          className: 'lb-card-head',
          role: 'button',
          tabIndex: 0,
          'aria-expanded': open,
          onClick: toggle,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              toggle();
            }
          },
        },
          h('div', { className: 'lb-row', style: { gap: 8, minWidth: 0 } },
            h('span', { className: 'lb-chev', 'aria-hidden': true }, open ? '▾' : '▸'),
            h('div', { className: 'lb-card-title' }, title)
          ),
          extra ? h('div', { onClick: (event) => event.stopPropagation() }, extra) : null
        ),
        open ? h('div', { className: 'lb-card-body' }, children) : null
      );
    }

    function StatusPill({ status }) {
      const cls = status?.connected ? 'lb-pill lb-pill--ok' : status?.enabled ? 'lb-pill lb-pill--bad' : 'lb-pill lb-pill--idle';
      const text = status?.connected ? '已连接' : status?.enabled ? (status?.configured === false ? '未配置' : '未连接') : '已停用';
      return h('span', { className: cls }, text);
    }

    function linesToArray(text) {
      return String(text ?? '').split(/[\n,，]/u).map((s) => s.trim()).filter(Boolean);
    }

    // Group-chat attention policies. `mention` + `keyword` combine.
    const TRIGGER_VALUES = ['all', 'mention', 'keyword', 'off'];
    const TRIGGER_OPTIONS = [
      ['all', '所有消息'],
      ['mention', '@ 或回复机器人'],
      ['keyword', '命中关键词'],
      ['off', '关闭（只记录）'],
    ];

    // What each DSH preset actually gives a session. The host registry supplies
    // the ids (and descriptions for presets that declare one); these notes cover
    // the built-ins, which ship without a description.
    const PRESET_NOTES = {
      'lane-support': 'IM 客服人格：只负责接待和查知识库，没有本地文件/命令权限。桥接会把 lane_send、lane_kb_* 等工具和角色卡另外注入到会话上。',
      standard: '标准代理：人格 + 文件读写/搜索 + 终端（PowerShell）+ 后台任务 + 定时任务 + 技能。能力最全，适合需要真正查代码/改文件的客服。',
      ptc: '标准工具链 + 程序化工具调用（PTC）：模型可以写脚本批量调用工具，适合多步骤数据处理；比 standard 多一层流程编排。',
      cordis: '标准工具链 + goal/plan 模式 + Cordis 插件开发技能：用来开发/调试 DSH 插件本身，不适合客服。',
      minimal: '最小工具集：只保留只读文件与图片读取、上下文压缩；没有终端、没有写入。适合纯问答、成本最低。',
    };

    function Overview({ data, refresh }) {
      const [cfg, setCfg] = useState(() => clone(data.state.config));
      const [busy, setBusy] = useState(false);
      const [message, setMessage] = useState('');
      const [error, setError] = useState('');
      const [logs, setLogs] = useState(null);
      const [showLogs, setShowLogs] = useState(false);
      const [logError, setLogError] = useState('');
      const [ghRepos, setGhRepos] = useState([]);
      const [ghBranches, setGhBranches] = useState([]);
      const [ghBusy, setGhBusy] = useState('');
      const [ghError, setGhError] = useState('');
      const [ghAuth, setGhAuth] = useState(null);
      const [manualRepo, setManualRepo] = useState(false);
      const [manualBranch, setManualBranch] = useState(false);
      const setChannel = (id, key, value) => {
        setCfg((current) => {
          const next = clone(current);
          next.channels[id] = { ...(next.channels[id] ?? {}), [key]: value };
          return next;
        });
      };
      const save = async (label) => {
        setBusy(true); setError(''); setMessage('');
        try {
          await api('/config', { method: 'POST', body: JSON.stringify({ config: cfg }) });
          setMessage(typeof label === 'string' ? label : '已保存');
          await refresh();
        } catch (err) { setError(String(err.message ?? err)); } finally { setBusy(false); }
      };
      const toggleChannel = async (id, enabled) => {
        setBusy(true); setError(''); setMessage('');
        try {
          const next = clone(cfg);
          next.channels = { ...(next.channels ?? {}) };
          next.channels[id] = { ...(next.channels[id] ?? {}), enabled };
          await api('/config', { method: 'POST', body: JSON.stringify({ config: next }) });
          setCfg(next);
          setMessage(enabled ? '已启用，正在连接通道…' : '已停用该通道');
          await refresh();
        } catch (err) { setError(String(err.message ?? err)); } finally { setBusy(false); }
      };
      const restartChannels = async () => {
        setBusy(true); setError(''); setMessage('');
        try {
          await api('/channels/restart', { method: 'POST', body: '{}' });
          setMessage('已请求重连，稍等几秒看状态');
          await refresh();
        } catch (err) { setError(String(err.message ?? err)); } finally { setBusy(false); }
      };
      const loadLogs = async () => {
        setLogError('');
        try {
          const result = await api('/channels/logs');
          setLogs(result.lines ?? []);
          setShowLogs(true);
        } catch (err) { setLogError(String(err.message ?? err)); }
      };
      const gh = cfg.github ?? {};
      const repoKnown = ghRepos.some((item) => item.repo === gh.repo);
      const branchKnown = ghBranches.includes(gh.branch);
      const repoValue = gh.repo ? (repoKnown ? gh.repo : '__custom__') : '';
      const branchValue = gh.branch ? (branchKnown ? gh.branch : '__custom__') : '';
      const setGithub = (key, value) => setCfg((current) => {
        const next = clone(current);
        next.github = { ...(next.github ?? {}), [key]: value };
        return next;
      });
      const loadGithubAuth = async () => {
        setGhBusy('auth'); setGhError('');
        try { setGhAuth(await api('/github/auth')); } catch (err) { setGhError(String(err.message ?? err)); } finally { setGhBusy(''); }
      };
      const loadRepos = async () => {
        setGhBusy('repos'); setGhError('');
        try {
          const result = await api('/github/repos?limit=300');
          const repos = result.repos ?? [];
          setGhRepos(repos);
          setMessage(`已读取 ${repos.length} 个仓库`);
        } catch (err) { setGhError(String(err.message ?? err)); } finally { setGhBusy(''); }
      };
      const loadBranches = async (repoValue) => {
        const target = String(repoValue ?? gh.repo ?? '').trim();
        if (!target) return;
        setGhBusy('branches'); setGhError('');
        try {
          const result = await api(`/github/branches?repo=${encodeURIComponent(target)}`);
          setGhBranches(result.branches ?? []);
        } catch (err) { setGhBranches([]); setGhError(String(err.message ?? err)); } finally { setGhBusy(''); }
      };
      const channels = [
        ['snowluma', 'SnowLuma / QQ', 'OneBot v11 WebSocket；可填 SnowLuma 安装目录自动读 token', [
          ['wsUrl', 'WebSocket 地址', 'text'],
          ['accessToken', 'Access Token', 'password'],
          ['homeDir', 'SnowLuma 安装目录（可选）', 'text'],
        ]],
        ['qqbot', '官方 QQ Bot', 'QQ 开放平台 AppID/Secret', [
          ['appId', 'AppID', 'text'],
          ['appSecret', 'AppSecret', 'password'],
        ]],
        ['discord', 'Discord', 'discord.js；需要开启 Message Content Intent', [
          ['token', 'Bot Token', 'password'],
        ]],
      ];
      const anyEnabled = channels.some(([id]) => cfg.channels?.[id]?.enabled === true);
      return h('div', { className: 'lb-root' },
        !anyEnabled ? h('div', { className: 'lb-error' }, '还没有启动任何聊天通道。用下面的「启动通道」卡片逐个启动；如果只是想让机器人在 QQ 上跑，先启动 SnowLuma。') : null,
        message ? h('div', { className: 'lb-ok' }, message) : null,
        error ? h('div', { className: 'lb-error' }, error) : null,
        h(Card, {
          title: '启动通道',
          extra: h('div', { className: 'lb-actions' },
            h('button', { className: 'lb-btn', disabled: busy, onClick: () => void restartChannels() }, '全部重连'),
            h('button', { className: 'lb-btn', onClick: () => void loadLogs() }, showLogs ? '刷新日志' : '查看日志')
          ),
        },
          h('div', { className: 'lb-muted' }, '顺序：1）先启动 SnowLuma（本插件不会代启动）；2）点对应通道的「启动」；3）等状态变成「已连接」。官方 QQ Bot / Discord 先填凭据再启动。'),
          ...data.channels.map((status) => {
            const entry = cfg.channels?.[status.id] ?? {};
            return h('div', { className: 'lb-listitem', key: `launch-${status.id}` },
              h('div', { style: { minWidth: 0, flex: 1 } },
                h('div', { className: 'lb-row', style: { gap: 8 } },
                  h('b', null, status.label),
                  h(StatusPill, { status })
                ),
                status.hint ? h('div', { className: 'lb-muted' }, status.hint) : null
              ),
              h('div', { className: 'lb-actions' },
                !entry.enabled ? h('button', {
                  className: 'lb-btn lb-btn--primary',
                  disabled: busy,
                  onClick: () => void toggleChannel(status.id, true),
                }, '启动') : null,
                entry.enabled ? h('button', {
                  className: 'lb-btn',
                  disabled: busy,
                  onClick: () => void restartChannels(),
                }, '重试连接') : null,
                entry.enabled ? h('button', {
                  className: 'lb-btn lb-btn--danger',
                  disabled: busy,
                  onClick: () => void toggleChannel(status.id, false),
                }, '停止') : null
              )
            );
          })
        ),
        showLogs ? h(Card, { title: '通道日志', extra: h('button', { className: 'lb-btn', onClick: () => void loadLogs() }, '刷新') },
          logError ? h('div', { className: 'lb-error' }, logError) : null,
          !logs ? h('div', { className: 'lb-muted' }, '加载中…') : logs.length === 0
            ? h('div', { className: 'lb-muted' }, '还没有日志。点「全部重连」后再看。')
            : h('pre', { className: 'lb-log' }, ...logs.slice(0, 120).map((line) => `${new Date(line.at).toLocaleTimeString()} ${String(line.level).toUpperCase()} ${line.text}\n`))
        ) : null,
        h(Card, {
          title: '通用',
          extra: h('button', { className: 'lb-btn lb-btn--primary', disabled: busy, onClick: () => void save('已保存通用设置') }, busy ? '保存中…' : '保存通用设置'),
        },
          h('div', { className: 'lb-grid' },
            h(Field, { label: '插件启用' },
              h('label', { className: 'lb-check' },
                h('input', { type: 'checkbox', checked: cfg.enabled !== false, onChange: (e) => setCfg({ ...cfg, enabled: e.target.checked }) }),
                '启用通道与自动回复'
              )
            ),
            h(Field, { label: '未绑定私聊自动回复' },
              h('label', { className: 'lb-check' },
                h('input', { type: 'checkbox', checked: cfg.autoReplyPrivate === true, onChange: (e) => setCfg({ ...cfg, autoReplyPrivate: e.target.checked }) }),
                '陌生人私聊也回复（客服收件箱）'
              )
            ),
            h(Field, { label: '未绑定群聊自动回复' },
              h('label', { className: 'lb-check' },
                h('input', { type: 'checkbox', checked: cfg.autoReplyGroups === true, onChange: (e) => setCfg({ ...cfg, autoReplyGroups: e.target.checked }) }),
                '不推荐：所有群都会触发模型'
              )
            ),
            h(Field, { label: '默认领域', hint: '未绑定会话/未指定领域时使用' },
              h('select', {
                className: 'lb-select',
                value: cfg.defaultDomainId ?? data.state.config.defaultDomainId,
                onChange: (e) => setCfg({ ...cfg, defaultDomainId: e.target.value }),
              }, ...data.state.domains.map((domain) => h('option', { key: domain.id, value: domain.id }, domain.name || domain.id)))
            ),
            h(Field, { label: '转人工', hint: '暂停自动回复并通知接管会话' },
              h('label', { className: 'lb-check' },
                h('input', { type: 'checkbox', checked: cfg.handoff?.enabled !== false, onChange: (e) => setCfg({ ...cfg, handoff: { ...(cfg.handoff ?? {}), enabled: e.target.checked } }) }),
                '启用 lane_escalate'
              )
            ),
            h(Field, { label: '接管会话', hint: '转人工通知发到这里（必须是已绑定会话）' },
              h('select', {
                className: 'lb-select',
                value: cfg.handoff?.targetKey ?? '',
                onChange: (e) => setCfg({ ...cfg, handoff: { ...(cfg.handoff ?? {}), targetKey: e.target.value } }),
              },
                h('option', { value: '' }, '未配置（只暂停，不通知）'),
                ...Object.keys(data.state.bindings ?? {}).map((key) => h('option', { key, value: key }, key))
              )
            ),
            h(Field, { label: '转人工提示语', hint: '暂停时发给用户一次' },
              h('input', { className: 'lb-input', value: cfg.handoff?.ackMessage ?? '', onChange: (e) => setCfg({ ...cfg, handoff: { ...(cfg.handoff ?? {}), ackMessage: e.target.value } }) })
            ),
            h(Field, { label: '图片理解', hint: '下载用户图片并以多模态输入发送给模型' },
              h('label', { className: 'lb-check' },
                h('input', { type: 'checkbox', checked: cfg.media?.enabled !== false, onChange: (e) => setCfg({ ...cfg, media: { ...(cfg.media ?? {}), enabled: e.target.checked } }) }),
                '启用（关闭后只发 [图片] 占位）'
              )
            ),
            h(Field, { label: '最多图片数', hint: '0~8' },
              h('input', { className: 'lb-input', type: 'number', min: 0, max: 8, value: cfg.media?.maxCount ?? 4, onChange: (e) => setCfg({ ...cfg, media: { ...(cfg.media ?? {}), maxCount: Number(e.target.value) } }) })
            ),
            h(Field, { label: '合并消息窗口', hint: '毫秒；0=每条消息立即处理' },
              h('input', { className: 'lb-input', type: 'number', min: 0, max: 10000, value: cfg.reply?.debounceMs ?? 800, onChange: (e) => setCfg({ ...cfg, reply: { ...(cfg.reply ?? {}), debounceMs: Number(e.target.value) } }) })
            ),
            h(Field, { label: '回复最大字数', hint: '超出会拆成多条' },
              h('input', { className: 'lb-input', type: 'number', min: 200, max: 10000, value: cfg.reply?.maxChars ?? 1500, onChange: (e) => setCfg({ ...cfg, reply: { ...(cfg.reply ?? {}), maxChars: Number(e.target.value) } }) })
            ),
            h(Field, { label: '外部推送 Token', hint: data.secretStatus?.pushToken ? '已配置；留空表示不修改' : '未配置；配置后可从 CI/监控推送' },
              h('input', { className: 'lb-input', type: 'password', placeholder: data.secretStatus?.pushToken ? '••••••••（留空不修改）' : '设置一个随机 token', value: cfg.pushToken ?? '', onChange: (e) => setCfg({ ...cfg, pushToken: e.target.value }) })
            ),
          ),
          h('div', { className: 'lb-actions' },
            h('button', { className: 'lb-btn lb-btn--primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存通用设置'),
            message ? h('span', { className: 'lb-ok' }, message) : null,
            error ? h('span', { className: 'lb-error' }, error) : null
          )
        ),
        ...channels.map(([id, label, hint, fields]) => {
          const entry = cfg.channels?.[id] ?? {};
          const status = data.channels.find((item) => item.id === id);
          return h(Card, {
            key: id,
            title: label,
            extra: h('div', { className: 'lb-actions' },
              h(StatusPill, { status }),
              h('button', {
                className: `lb-btn ${entry.enabled ? 'lb-btn--danger' : 'lb-btn--primary'}`,
                disabled: busy,
                onClick: () => void toggleChannel(id, !entry.enabled),
              }, entry.enabled ? '停止' : '启动'),
              h('button', {
                className: 'lb-btn',
                disabled: busy,
                onClick: () => void save(`已保存 ${label} 设置`),
              }, busy ? '保存中…' : '保存')
            ),
          },
            h('div', { className: 'lb-muted' }, hint),
            status?.hint ? h('div', { className: 'lb-muted' }, status.hint) : null,
            h('label', { className: 'lb-check' },
              h('input', { type: 'checkbox', checked: entry.enabled === true, onChange: (e) => setChannel(id, 'enabled', e.target.checked) }),
              '启用该通道'
            ),
            h('div', { className: 'lb-grid' },
              ...fields.map(([key, labelText, type]) => h(Field, { key, label: labelText },
                h('input', {
                  className: 'lb-input',
                  type,
                  value: entry[key] ?? '',
                  placeholder: type === 'password' && data.secretStatus?.[`${id}${key === 'accessToken' ? 'AccessToken' : key === 'appSecret' ? 'AppSecret' : 'Token'}`] ? '已配置；留空不修改' : '',
                  onChange: (e) => setChannel(id, key, e.target.value),
                })
              ))
            ),
            id === 'discord' ? h('label', { className: 'lb-check' },
              h('input', {
                type: 'checkbox',
                checked: entry.requireMention === true,
                onChange: (e) => setChannel('discord', 'requireMention', e.target.checked),
              }),
              '群聊里必须 @ 或回复机器人才响应'
            ) : null,
            status?.lastError ? h('div', { className: 'lb-muted' }, `状态：${status.lastError}`) : null,
            h('div', { className: 'lb-actions' },
              h('button', {
                className: 'lb-btn lb-btn--primary',
                disabled: busy,
                onClick: () => void save(`已保存 ${label} 设置`),
              }, busy ? '保存中…' : `保存 ${label} 设置`)
            )
          );
        }),
        h(Card, {
          title: 'GitHub 仓库（可选）',
          extra: h('div', { className: 'lb-actions' },
            data.github?.repo ? h('span', { className: 'lb-mono lb-muted' }, data.github.repo) : null,
            h('button', { className: 'lb-btn lb-btn--primary', disabled: busy, onClick: () => void save('已保存 GitHub 设置') }, busy ? '保存中…' : '保存 GitHub 设置')
          ),
        },
          h('div', { className: 'lb-muted' }, '给客服一个只读的远程仓库入口：查 issue、读文件、搜代码、看最近提交。这里填的是全局默认仓库；每个领域可以在「领域」里覆盖成不同仓库。token 不会回显。'),
          h('div', { className: 'lb-grid' },
            h(Field, { label: '启用' },
              h('label', { className: 'lb-check' },
                h('input', { type: 'checkbox', checked: gh.enabled === true, onChange: (e) => setGithub('enabled', e.target.checked) }),
                '允许仓库工具'
              )
            ),
            h(Field, { label: '仓库', hint: '点「读取仓库」列出当前 GitHub 账号可见的全部仓库；也可手动输入' },
              h('div', { className: 'lb-row' },
                h('select', {
                  className: 'lb-select',
                  style: { flex: '1 1 260px' },
                  value: repoValue,
                  onChange: (e) => {
                    const value = e.target.value;
                    if (value === '__custom__') { setManualRepo(true); return; }
                    setManualRepo(false);
                    setGithub('repo', value);
                    setGithub('branch', '');
                    setManualBranch(false);
                    setGhBranches([]);
                    if (value) void loadBranches(value);
                  },
                },
                  h('option', { value: '' }, ghRepos.length ? `选择仓库（共 ${ghRepos.length} 个）` : '先点「读取仓库」'),
                  ...ghRepos.map((item) => h('option', { key: item.repo, value: item.repo }, `${item.repo}${item.private ? '（私有）' : ''}`)),
                  h('option', { value: '__custom__' }, '手动输入 owner/repo')
                ),
                h('button', { className: 'lb-btn', disabled: ghBusy === 'repos', onClick: () => void loadRepos() }, ghBusy === 'repos' ? '读取中…' : '读取仓库')
              ),
              (manualRepo || (gh.repo && !repoKnown)) ? h('input', {
                className: 'lb-input',
                value: gh.repo ?? '',
                placeholder: 'owner/repo',
                onChange: (e) => setGithub('repo', e.target.value),
                onBlur: (e) => { if (e.target.value.trim()) void loadBranches(e.target.value.trim()); },
              }) : null,
              ghRepos.length ? h('div', { className: 'lb-muted' }, `已读取 ${ghRepos.length} 个仓库；下拉里是全部可见仓库，不是当前工作区` ) : null
            ),
            h(Field, { label: '分支', hint: '留空=仓库默认分支' },
              h('div', { className: 'lb-row' },
                h('select', {
                  className: 'lb-select',
                  style: { flex: '1 1 200px' },
                  value: branchValue,
                  onChange: (e) => {
                    const value = e.target.value;
                    if (value === '__custom__') { setManualBranch(true); return; }
                    setManualBranch(false);
                    setGithub('branch', value);
                  },
                },
                  h('option', { value: '' }, '默认分支'),
                  ...ghBranches.map((branch) => h('option', { key: branch, value: branch }, branch)),
                  h('option', { value: '__custom__' }, '手动输入分支')
                ),
                h('button', { className: 'lb-btn', disabled: ghBusy === 'branches' || !gh.repo, onClick: () => void loadBranches(gh.repo) }, ghBusy === 'branches' ? '读取中…' : '读取分支')
              ),
              (manualBranch || (gh.branch && !branchKnown)) ? h('input', {
                className: 'lb-input',
                value: gh.branch ?? '',
                placeholder: 'main',
                onChange: (e) => setGithub('branch', e.target.value),
              }) : null
            ),
            h(Field, { label: 'Token', hint: data.secretStatus?.githubToken ? '已配置；留空表示不修改' : '填了 gh auth login 后可留空；公开仓库匿名请求可能被限流' },
              h('input', { className: 'lb-input', type: 'password', value: gh.token ?? '', placeholder: data.secretStatus?.githubToken ? '••••••••（留空不修改）' : 'ghp_... / github_pat_...', onChange: (e) => setGithub('token', e.target.value) })
            ),
            h(Field, { label: 'GitHub 登录态', hint: '优先用本机 gh CLI；失败再填 token' },
              h('div', { className: 'lb-row' },
                h('button', { className: 'lb-btn', disabled: ghBusy === 'auth', onClick: () => void loadGithubAuth() }, ghBusy === 'auth' ? '检查中…' : '检查 gh 登录'),
                ghAuth ? h('span', { className: 'lb-muted' }, `${ghAuth.authenticated ? '已登录' : '未登录'} · ${ghAuth.source}${ghAuth.account ? ` · ${ghAuth.account}` : ''}`) : null
              )
            ),
            h(Field, { label: '允许建 issue', hint: '默认关闭；开启后还要在「领域」里勾选允许读取 GitHub 仓库' },
              h('label', { className: 'lb-check' },
                h('input', { type: 'checkbox', checked: gh.allowCreateIssue === true, onChange: (e) => setGithub('allowCreateIssue', e.target.checked) }),
                '允许 lane_repo_create_issue'
              )
            ),
            h(Field, { label: '标记标签', hint: '仓库里不存在这个标签时，会自动改为不带标签创建，不会丢 issue' },
              h('input', { className: 'lb-input', value: gh.issueLabel ?? 'agent', onChange: (e) => setGithub('issueLabel', e.target.value) })
            ),
            h(Field, { label: '每小时上限', hint: '防止误刷；0~20' },
              h('input', { className: 'lb-input', type: 'number', min: 0, max: 20, value: gh.maxCreatesPerHour ?? 3, onChange: (e) => setGithub('maxCreatesPerHour', Number(e.target.value)) })
            ),
          ),
          ghError ? h('div', { className: 'lb-error' }, ghError) : null,
          ghAuth?.hint ? h('div', { className: 'lb-muted' }, ghAuth.hint) : null,
          data.github?.hint ? h('div', { className: 'lb-muted' }, data.github.hint) : null,
          h('div', { className: 'lb-actions' },
            h('button', { className: 'lb-btn lb-btn--primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存 GitHub 设置')
          )
        ),
        h('div', { className: 'lb-footer' },
          message ? h('span', { className: 'lb-ok' }, message) : null,
          error ? h('span', { className: 'lb-error' }, error) : null,
          h('button', { className: 'lb-btn', onClick: async () => { await api('/channels/restart', { method: 'POST', body: '{}' }); await refresh(); } }, '重启通道'),
          h('button', { className: 'lb-btn lb-btn--primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存通道设置')
        )
      );
    }

    function Conversations({ data, refresh }) {
      const [draft, setDraft] = useState(() => clone(data.state.bindings ?? {}));
      const [manual, setManual] = useState('');
      const [message, setMessage] = useState('');
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const domains = data.state.domains;
      const conversations = Object.values(data.state.conversations ?? {}).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
      const setBinding = (key, patch) => {
        setDraft((current) => {
          const next = clone(current);
          const existing = next[key] ?? { domainId: data.state.config.defaultDomainId, enabled: true };
          next[key] = { ...existing, ...patch };
          return next;
        });
      };
      const bind = (key) => {
        if (!draft[key]) setBinding(key, {});
      };
      const unbind = (key) => {
        setDraft((current) => {
          const next = clone(current);
          delete next[key];
          return next;
        });
      };
      const resetSession = async (key) => {
        if (typeof window.confirm === 'function' && !window.confirm('重置该会话？下一条消息会创建一个新的 DSH 会话（旧会话保留在历史里）。')) return;
        setBusy(true); setError(''); setMessage('');
        try {
          await api('/session/reset', { method: 'POST', body: JSON.stringify({ key }) });
          setMessage('会话已重置');
          await refresh();
        } catch (err) { setError(String(err.message ?? err)); } finally { setBusy(false); }
      };
      const handoff = async (key, action) => {
        setBusy(true); setError(''); setMessage('');
        try {
          await api('/handoff', { method: 'POST', body: JSON.stringify({ key, action }) });
          setMessage(action === 'resume' ? '已恢复自动回复' : '已转人工');
          await refresh();
        } catch (err) { setError(String(err.message ?? err)); } finally { setBusy(false); }
      };
      const save = async () => {
        setBusy(true); setError(''); setMessage('');
        try {
          await api('/bindings', { method: 'POST', body: JSON.stringify({ bindings: draft }) });
          setMessage('已保存');
          await refresh();
        } catch (err) { setError(String(err.message ?? err)); } finally { setBusy(false); }
      };
      const addManual = () => {
        const key = manual.trim();
        if (!/^[^:]+:(group|private):.+/u.test(key)) { setError('key 必须形如 snowluma:group:123456'); return; }
        setError('');
        setDraft((current) => ({ ...current, [key]: { domainId: data.state.config.defaultDomainId, enabled: true } }));
        setManual('');
      };
      return h('div', { className: 'lb-root' },
        h(Card, {
          title: '已发现的会话',
          extra: h('div', { className: 'lb-actions' },
            h('span', { className: 'lb-muted' }, `${conversations.length} 个`),
            h('button', { className: 'lb-btn lb-btn--primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存绑定')
          ),
        },
          h('div', { className: 'lb-muted' }, '未绑定的会话只会被记录，不会触发模型。绑定后会为它创建一个 DSH 会话。'),
          h('div', { style: { overflowX: 'auto' } },
            h('table', { className: 'lb-table' },
              h('thead', null, h('tr', null,
                h('th', null, '会话'), h('th', null, '最近消息'), h('th', null, 'DSH 会话'), h('th', null, '领域'), h('th', null, '角色卡'), h('th', null, '自动回复'), h('th', null, '')
              )),
              h('tbody', null, ...(conversations.length ? conversations.map((convo) => {
                const binding = draft[convo.key];
                const sessionId = String(data.state.sessions?.[convo.key]?.sessionId ?? '');
                return h('tr', { key: convo.key },
                  h('td', null,
                    h('div', null, convo.name || convo.key, binding?.paused ? h('span', { className: 'lb-pill lb-pill--bad', style: { marginLeft: 6 } }, '人工中') : null),
                    h('div', { className: 'lb-mono lb-muted' }, convo.key)
                  ),
                  h('td', null,
                    h('div', { className: 'lb-muted' }, convo.lastAt ? new Date(convo.lastAt).toLocaleString() : ''),
                    h('div', null, String(convo.lastText ?? '').slice(0, 60))
                  ),
                  h('td', null,
                    sessionId
                      ? h('div', { className: 'lb-mono', title: sessionId }, sessionId.slice(0, 16))
                      : h('span', { className: 'lb-muted' }, binding ? '尚未建立' : '未绑定')
                  ),
                  h('td', null,
                    h('select', {
                      className: 'lb-select',
                      value: binding?.domainId ?? '',
                      onChange: (e) => binding ? setBinding(convo.key, { domainId: e.target.value }) : null,
                      disabled: !binding,
                    },
                      h('option', { value: '' }, '未绑定'),
                      ...domains.map((domain) => h('option', { key: domain.id, value: domain.id }, domain.name || domain.id))
                    )
                  ),
                  h('td', null,
                    binding ? h('select', {
                      className: 'lb-select',
                      value: binding.role ?? '',
                      onChange: (e) => setBinding(convo.key, { role: e.target.value }),
                    },
                      h('option', { value: '' }, '跟随领域'),
                      ...data.state.roles.map((role) => h('option', { key: role.name, value: role.name }, role.name))
                    ) : h('span', { className: 'lb-muted' }, '—')
                  ),
                  h('td', null,
                    binding ? h('label', { className: 'lb-check' },
                      h('input', { type: 'checkbox', checked: binding.enabled !== false, onChange: (e) => setBinding(convo.key, { enabled: e.target.checked }) }),
                      '开'
                    ) : h('span', { className: 'lb-muted' }, '—')
                  ),
                  h('td', null,
                    h('div', { className: 'lb-actions' },
                      binding ? h('button', { className: 'lb-btn lb-btn--danger', onClick: () => unbind(convo.key) }, '解绑')
                        : h('button', { className: 'lb-btn', onClick: () => bind(convo.key) }, '绑定'),
                      binding ? h('button', { className: 'lb-btn', onClick: () => resetSession(convo.key) }, '重置会话') : null,
                      binding ? (binding.paused
                        ? h('button', { className: 'lb-btn', onClick: () => handoff(convo.key, 'resume') }, '恢复自动回复')
                        : h('button', { className: 'lb-btn', onClick: () => handoff(convo.key, 'escalate') }, '转人工')) : null
                    )
                  )
                );
              }) : [h('tr', null, h('td', { colSpan: 7, className: 'lb-muted' }, '还没有收到过消息。让机器人上线后发一条消息，或手动添加。'))]))
            )
          ),
          h('div', { className: 'lb-row' },
            h('input', { className: 'lb-input', style: { maxWidth: 380 }, placeholder: 'snowluma:group:123456', value: manual, onChange: (e) => setManual(e.target.value) }),
            h('button', { className: 'lb-btn', onClick: addManual }, '手动添加绑定')
          )
        ),
        h('div', { className: 'lb-footer' },
          message ? h('span', { className: 'lb-ok' }, message) : null,
          error ? h('span', { className: 'lb-error' }, error) : null,
          h('button', { className: 'lb-btn lb-btn--primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存绑定')
        )
      );
    }

    function Domains({ data, refresh }) {
      const [draft, setDraft] = useState(() => clone(data.state.domains));
      const [selected, setSelected] = useState(() => data.state.domains[0]?.id ?? 'default');
      const [message, setMessage] = useState('');
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const [repoOptions, setRepoOptions] = useState([]);
      const [repoBranches, setRepoBranches] = useState([]);
      const [branchRepo, setBranchRepo] = useState('');
      const [repoBusy, setRepoBusy] = useState('');
      const [repoError, setRepoError] = useState('');
      const [presets, setPresets] = useState([]);
      const [presetError, setPresetError] = useState('');
      const current = draft.find((domain) => domain.id === selected) ?? draft[0];
      const globalRepo = data.state.config.github?.repo ?? '';
      const effectiveRepo = current?.repo || globalRepo;
      const loadPresets = async () => {
        setPresetError('');
        try {
          const result = await api('/presets');
          setPresets(Array.isArray(result?.presets) ? result.presets : []);
        } catch (err) { setPresetError(String(err.message ?? err)); }
      };
      useEffect(() => { void loadPresets(); }, []);
      const selectedPreset = presets.find((preset) => preset.id === current?.preset);
      const presetKnown = Boolean(selectedPreset);
      const presetNote = PRESET_NOTES[current?.preset]
        ?? selectedPreset?.description
        ?? (presets.length > 0
          ? '自定义 preset：请确认它确实存在于当前 DSH 里，否则会话会退回宿主默认。'
          : '当前 DSH 没有提供 preset 列表，先手填 id（例如 lane-support）。');
      const loadRepoOptions = async () => {
        setRepoBusy('repos'); setRepoError('');
        try {
          const result = await api('/github/repos?limit=300');
          setRepoOptions(result.repos ?? []);
        } catch (err) { setRepoError(String(err.message ?? err)); } finally { setRepoBusy(''); }
      };
      const loadDomainBranches = async (target) => {
        const repoValue = String(target ?? effectiveRepo ?? '').trim();
        if (!repoValue) return;
        setRepoBusy('branches'); setRepoError('');
        try {
          const result = await api(`/github/branches?repo=${encodeURIComponent(repoValue)}`);
          setBranchRepo(repoValue);
          setRepoBranches(result.branches ?? []);
        } catch (err) { setRepoBranches([]); setRepoError(String(err.message ?? err)); } finally { setRepoBusy(''); }
      };
      const patch = (key, value) => {
        setDraft((list) => list.map((domain) => domain.id === current.id ? { ...domain, [key]: value } : domain));
      };
      const triggersOf = (domain) => {
        const raw = Array.isArray(domain?.triggers) ? domain.triggers : [domain?.trigger ?? 'all'];
        const picked = raw.filter((value) => TRIGGER_VALUES.includes(value));
        return picked.length ? picked : ['all'];
      };
      const setTriggers = (next) => {
        patch('triggers', next);
        patch('trigger', next[0]);
      };
      // `all` and `off` are exclusive; mention + keyword combine. Unchecking an
      // exclusive mode lands on a visible alternative instead of silently
      // snapping back to the same value.
      const toggleTrigger = (mode, on) => {
        if (mode === 'all') {
          setTriggers(on ? ['all'] : ['mention']);
          return;
        }
        if (mode === 'off') {
          setTriggers(on ? ['off'] : ['all']);
          return;
        }
        const picked = new Set(triggersOf(current));
        picked.delete('all');
        picked.delete('off');
        if (on) picked.add(mode); else picked.delete(mode);
        const next = TRIGGER_VALUES.filter((value) => picked.has(value) && value !== 'all' && value !== 'off');
        setTriggers(next.length ? next : ['all']);
      };
      const add = () => {
        const id = `domain-${Date.now().toString(36)}`;
        setDraft((list) => [...list, {
          id, name: '新领域', role: data.state.roles[0]?.name ?? '客服', preset: 'lane-support', model: '',
          knowledgeScopes: ['default'], allowedHostTools: [], autoReply: true, trigger: 'all', triggers: ['all'], keywords: [],
          kbDraftEnabled: true, repoEnabled: false, repo: '', branch: '', systemPrompt: '', maxReplyChars: 0,
        }]);
        setSelected(id);
      };
      const remove = () => {
        if (draft.length <= 1) { setError('至少保留一个领域'); return; }
        setDraft((list) => list.filter((domain) => domain.id !== current.id));
        setSelected(draft.find((domain) => domain.id !== current.id)?.id ?? '');
      };
      const save = async () => {
        setBusy(true); setError(''); setMessage('');
        try {
          await api('/domains', { method: 'POST', body: JSON.stringify({ domains: draft }) });
          setMessage('已保存');
          await refresh();
        } catch (err) { setError(String(err.message ?? err)); } finally { setBusy(false); }
      };
      return h('div', { className: 'lb-root' },
        h('div', { className: 'lb-row' },
          h('button', { className: 'lb-btn', onClick: add }, '+ 新建领域'),
          h('button', { className: 'lb-btn lb-btn--danger', onClick: remove }, '删除当前领域')
        ),
        h('div', { className: 'lb-row', style: { alignItems: 'flex-start' } },
          h('div', { className: 'lb-list', style: { minWidth: 190 } },
            ...draft.map((domain) => h('button', {
              key: domain.id,
              className: `lb-listitem ${domain.id === current?.id ? 'lb-listitem--on' : ''}`,
              style: { cursor: 'pointer', textAlign: 'left', background: 'transparent', color: 'inherit' },
              onClick: () => setSelected(domain.id),
            }, h('span', null, domain.name || domain.id), h('span', { className: 'lb-mono lb-muted' }, domain.id)))
          ),
          current ? h(Card, {
            title: `领域：${current.name || current.id}`,
            extra: h('button', { className: 'lb-btn lb-btn--primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存领域'),
          },
            h('div', { className: 'lb-grid' },
              h(Field, { label: '名称' }, h('input', { className: 'lb-input', value: current.name, onChange: (e) => patch('name', e.target.value) })),
              h(Field, { label: 'ID', hint: '只读（绑定用它）' }, h('input', { className: 'lb-input', value: current.id, readOnly: true })),
              h(Field, { label: '角色卡' },
                h('select', { className: 'lb-select', value: current.role, onChange: (e) => patch('role', e.target.value) },
                  ...data.state.roles.map((role) => h('option', { key: role.name, value: role.name }, role.name))
                )
              ),
              h(Field, { label: 'Agent preset', hint: 'preset 决定会话挂哪些 DSH 插件和工具；桥接的 lane_* 工具与角色卡会另外注入' },
                h('div', { className: 'lb-field' },
                  presets.length > 0
                    ? h('select', {
                      className: 'lb-select',
                      value: presetKnown ? current.preset : '__custom__',
                      onChange: (e) => { if (e.target.value !== '__custom__') patch('preset', e.target.value); },
                    },
                      h('option', { value: '__custom__' }, '手动输入 / 未知 preset'),
                      ...presets.map((preset) => h('option', { key: preset.id, value: preset.id },
                        `${preset.name || preset.id}（${preset.id}）${preset.isDefault ? ' · 默认' : ''}${preset.broken ? ' · 加载失败' : ''}`
                      ))
                    )
                    : null,
                  presets.length === 0 || !presetKnown
                    ? h('input', { className: 'lb-input', value: current.preset, placeholder: 'preset id，例如 lane-support', onChange: (e) => patch('preset', e.target.value) })
                    : null,
                  h('div', { className: 'lb-muted' }, presetNote),
                  presetError ? h('div', { className: 'lb-error' }, `preset 列表读取失败：${presetError}`) : null,
                  selectedPreset?.broken ? h('div', { className: 'lb-error' }, `该 preset 加载失败：${selectedPreset.broken}`) : null
                )
              ),
              h(Field, { label: '模型', hint: 'provider/model；留空=DSH 默认' },
                h('input', { className: 'lb-input', value: current.model, onChange: (e) => patch('model', e.target.value) })
              ),
              h(Field, { label: '知识库 scope', hint: '逗号分隔' },
                h('input', { className: 'lb-input', value: (current.knowledgeScopes ?? []).join(', '), onChange: (e) => patch('knowledgeScopes', linesToArray(e.target.value)) })
              ),
              h(Field, { label: '允许的宿主工具', hint: '逗号分隔；留空=无宿主工具' },
                h('input', { className: 'lb-input', value: (current.allowedHostTools ?? []).join(', '), onChange: (e) => patch('allowedHostTools', linesToArray(e.target.value)) })
              ),
              h(Field, { label: '单条回复上限', hint: '0=使用全局' },
                h('input', { className: 'lb-input', type: 'number', min: 0, value: current.maxReplyChars ?? 0, onChange: (e) => patch('maxReplyChars', Number(e.target.value)) })
              ),
            ),
            h('div', { className: 'lb-grid' },
              h(Field, { label: '共享记忆', hint: '同领域的群/私聊共享' },
                h('label', { className: 'lb-check' },
                  h('input', { type: 'checkbox', checked: current.memoryEnabled === true, onChange: (e) => patch('memoryEnabled', e.target.checked) }),
                  '启用领域共享记忆'
                )
              ),
              h(Field, { label: '记忆注入上限', hint: '字符数' },
                h('input', { className: 'lb-input', type: 'number', min: 200, max: 8000, value: current.memoryMaxChars ?? 2000, onChange: (e) => patch('memoryMaxChars', Number(e.target.value)) })
              ),
              h(Field, { label: '知识库草稿' },
                h('label', { className: 'lb-check' },
                  h('input', { type: 'checkbox', checked: current.kbDraftEnabled !== false, onChange: (e) => patch('kbDraftEnabled', e.target.checked) }),
                  '允许 lane_kb_draft（只写待审区）'
                )
              ),
              h(Field, { label: 'GitHub 仓库' },
                h('label', { className: 'lb-check' },
                  h('input', { type: 'checkbox', checked: current.repoEnabled === true, onChange: (e) => patch('repoEnabled', e.target.checked) }),
                  '允许该领域读取仓库（需全局 GitHub 启用；每个领域可用不同仓库）'
                )
              ),
              h(Field, { label: '仓库（可选）', hint: `留空=继承全局${globalRepo ? `（${globalRepo}）` : '（全局未设置）'}` },
                h('div', { className: 'lb-row' },
                  h('select', {
                    className: 'lb-select',
                    style: { flex: '1 1 220px' },
                    value: current.repo ? (repoOptions.some((item) => item.repo === current.repo) ? current.repo : '__custom__') : '',
                    onChange: (e) => {
                      const value = e.target.value;
                      if (value === '__custom__') return;
                      patch('repo', value);
                      patch('branch', '');
                      setRepoBranches([]);
                      setBranchRepo('');
                      if (value) void loadDomainBranches(value);
                    },
                  },
                    h('option', { value: '' }, globalRepo ? `继承全局（${globalRepo}）` : '继承全局（未设置）'),
                    ...repoOptions.map((item) => h('option', { key: item.repo, value: item.repo }, `${item.repo}${item.private ? '（私有）' : ''}`)),
                    h('option', { value: '__custom__' }, '手动输入 owner/repo')
                  ),
                  h('button', { className: 'lb-btn', disabled: repoBusy === 'repos', onClick: () => void loadRepoOptions() }, repoBusy === 'repos' ? '读取中…' : '读取仓库')
                ),
                h('input', {
                  className: 'lb-input',
                  value: current.repo ?? '',
                  placeholder: 'owner/repo（留空继承全局）',
                  onChange: (e) => patch('repo', e.target.value),
                })
              ),
              h(Field, { label: '分支（可选）', hint: '留空=继承全局/仓库默认分支' },
                h('div', { className: 'lb-row' },
                  h('select', {
                    className: 'lb-select',
                    style: { flex: '1 1 200px' },
                    value: current.branch ? (branchRepo === effectiveRepo && repoBranches.includes(current.branch) ? current.branch : '__custom__') : '',
                    onChange: (e) => {
                      const value = e.target.value;
                      if (value === '__custom__') return;
                      patch('branch', value);
                    },
                  },
                    h('option', { value: '' }, '继承全局/默认分支'),
                    ...(branchRepo === effectiveRepo ? repoBranches : []).map((branch) => h('option', { key: branch, value: branch }, branch)),
                    h('option', { value: '__custom__' }, '手动输入分支')
                  ),
                  h('button', { className: 'lb-btn', disabled: repoBusy === 'branches' || !effectiveRepo, onClick: () => void loadDomainBranches(effectiveRepo) }, repoBusy === 'branches' ? '读取中…' : '读取分支')
                ),
                h('input', {
                  className: 'lb-input',
                  value: current.branch ?? '',
                  placeholder: 'main（留空继承）',
                  onChange: (e) => patch('branch', e.target.value),
                })
              ),
              repoError ? h('div', { className: 'lb-error' }, repoError) : null
            ),
            h('label', { className: 'lb-check' },
              h('input', { type: 'checkbox', checked: current.autoReply !== false, onChange: (e) => patch('autoReply', e.target.checked) }),
              '允许自动回复（关闭后只记录消息）'
            ),
            h('div', { className: 'lb-grid' },
              h(Field, { label: '群聊触发策略（可多选）', hint: '命中任意一条就回复；「所有消息」「关闭」与其它互斥；私聊除「关闭」外始终回复' },
                h('div', { className: 'lb-actions', style: { flexWrap: 'wrap', rowGap: 6 } },
                  ...TRIGGER_OPTIONS.map(([value, label]) => h('label', { key: value, className: 'lb-check' },
                    h('input', {
                      type: 'checkbox',
                      checked: triggersOf(current).includes(value),
                      onChange: (e) => toggleTrigger(value, e.target.checked),
                    }),
                    label
                  ))
                )
              ),
              h(Field, { label: '关键词', hint: '勾选「命中关键词」时生效，逗号分隔' },
                h('input', { className: 'lb-input', value: (current.keywords ?? []).join(', '), onChange: (e) => patch('keywords', linesToArray(e.target.value)) })
              )
            ),
            h(Field, { label: '领域附加说明', hint: '会追加在角色卡之前；可写产品口径/禁止事项' },
              h('textarea', { className: 'lb-textarea', value: current.systemPrompt ?? '', onChange: (e) => patch('systemPrompt', e.target.value) })
            )
          ) : null
        ),
        h('div', { className: 'lb-footer' },
          message ? h('span', { className: 'lb-ok' }, message) : null,
          error ? h('span', { className: 'lb-error' }, error) : null,
          h('button', { className: 'lb-btn lb-btn--primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存领域')
        )
      );
    }

    function RolesAndKnowledge({ data, refresh }) {
      const [roles, setRoles] = useState(() => clone(data.state.roles));
      const [selected, setSelected] = useState(() => data.state.roles[0]?.name ?? '');
      const [message, setMessage] = useState('');
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const [kb, setKb] = useState(null);
      const [kbError, setKbError] = useState('');
      const [kbFile, setKbFile] = useState(null);
      const [kbContent, setKbContent] = useState('');
      const [kbMessage, setKbMessage] = useState('');
      const [memDomain, setMemDomain] = useState(() => data.state.domains[0]?.id ?? '');
      const [memText, setMemText] = useState('');
      const [memMessage, setMemMessage] = useState('');
      const [memError, setMemError] = useState('');
      const current = roles.find((role) => role.name === selected) ?? roles[0];
      const patch = (key, value) => setRoles((list) => list.map((role) => role.name === current.name ? { ...role, [key]: value } : role));
      const loadKb = useCallback(async () => {
        setKbError('');
        try { setKb(await api('/knowledge')); } catch (err) { setKbError(String(err.message ?? err)); }
      }, []);
      useEffect(() => { loadKb(); }, [loadKb]);
      const openKb = async (file) => {
        setKbError(''); setKbMessage('');
        try {
          const query = new URLSearchParams({ scope: file.scope, path: file.path });
          const result = await api(`/knowledge/read?${query.toString()}`);
          setKbFile(file);
          setKbContent(result.content ?? '');
        } catch (err) { setKbError(String(err.message ?? err)); }
      };
      const saveKb = async () => {
        if (!kbFile) return;
        setKbError(''); setKbMessage('');
        try {
          await api('/knowledge', { method: 'POST', body: JSON.stringify({ scope: kbFile.scope, path: kbFile.path, content: kbContent }) });
          setKbMessage('已保存');
          await loadKb();
        } catch (err) { setKbError(String(err.message ?? err)); }
      };
      const loadMemory = useCallback(async (domainId) => {
        setMemError(''); setMemMessage('');
        try {
          const result = await api(`/memory?domain=${encodeURIComponent(domainId)}`);
          setMemText(result.text ?? '');
        } catch (err) { setMemError(String(err.message ?? err)); }
      }, []);
      useEffect(() => { if (memDomain) void loadMemory(memDomain); }, [memDomain, loadMemory]);
      const saveMemory = async () => {
        setMemError(''); setMemMessage('');
        try {
          const result = await api('/memory', { method: 'POST', body: JSON.stringify({ domainId: memDomain, text: memText }) });
          setMemMessage(`已保存（${result.count ?? 0} 条）`);
          await loadMemory(memDomain);
        } catch (err) { setMemError(String(err.message ?? err)); }
      };
      const clearMemory = async () => {
        if (typeof window.confirm === 'function' && !window.confirm('清空该领域的共享记忆？')) return;
        setMemError(''); setMemMessage('');
        try {
          await api('/memory', { method: 'POST', body: JSON.stringify({ domainId: memDomain, action: 'clear' }) });
          setMemText('');
          setMemMessage('已清空');
        } catch (err) { setMemError(String(err.message ?? err)); }
      };
      const add = () => {
        let index = 1;
        let name = '新角色';
        while (roles.some((role) => role.name === name)) name = `新角色${index++}`;
        setRoles((list) => [...list, { name, content: '# 角色卡\n\n' }]);
        setSelected(name);
      };
      const remove = () => {
        if (roles.length <= 1) { setError('至少保留一张角色卡'); return; }
        setRoles((list) => list.filter((role) => role.name !== current.name));
        setSelected(roles.find((role) => role.name !== current.name)?.name ?? '');
      };
      const save = async () => {
        setBusy(true); setError(''); setMessage('');
        try {
          await api('/roles', { method: 'POST', body: JSON.stringify({ roles }) });
          setMessage('已保存');
          await refresh();
        } catch (err) { setError(String(err.message ?? err)); } finally { setBusy(false); }
      };
      return h('div', { className: 'lb-root' },
        h(Card, { title: '共享角色卡', extra: h('div', { className: 'lb-actions' },
          h('button', { className: 'lb-btn', onClick: add }, '+ 新建'),
          h('button', { className: 'lb-btn lb-btn--danger', onClick: remove }, '删除'),
          h('button', { className: 'lb-btn lb-btn--primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存角色卡')
        ) },
          h('div', { className: 'lb-grid' },
            h(Field, { label: '角色名' },
              h('select', { className: 'lb-select', value: current?.name ?? '', onChange: (e) => setSelected(e.target.value) },
                ...roles.map((role) => h('option', { key: role.name, value: role.name }, role.name))
              )
            ),
            h(Field, { label: '重命名', hint: '失焦后生效；引用它的领域/绑定会回退到默认' },
              h('input', {
                key: current?.name ?? '',
                className: 'lb-input',
                defaultValue: current?.name ?? '',
                onBlur: (e) => {
                  const next = e.target.value.trim();
                  if (!next || next === current?.name) { e.target.value = current?.name ?? ''; return; }
                  if (roles.some((role) => role.name === next)) { e.target.value = current?.name ?? ''; setError('角色名已存在'); return; }
                  setRoles((list) => list.map((role) => role.name === current.name ? { ...role, name: next } : role));
                  setSelected(next);
                },
              })
            )
          ),
          h('textarea', { className: 'lb-textarea lb-textarea--tall', value: current?.content ?? '', onChange: (e) => patch('content', e.target.value) }),
          h('div', { className: 'lb-footer' },
            message ? h('span', { className: 'lb-ok' }, message) : null,
            error ? h('span', { className: 'lb-error' }, error) : null,
            h('button', { className: 'lb-btn lb-btn--primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存角色卡')
          )
        ),
        h(Card, { title: '领域共享记忆', extra: h('div', { className: 'lb-actions' },
          h('button', { className: 'lb-btn', onClick: () => loadMemory(memDomain) }, '刷新'),
          h('button', { className: 'lb-btn lb-btn--primary', onClick: saveMemory }, '保存记忆')
        ) },
          h('div', { className: 'lb-muted' }, '同一领域下的群/私聊共享；每行一条，模型可通过 lane_memory_add 追加。与知识库冲突时以知识库为准。'),
          h('div', { className: 'lb-grid' },
            h(Field, { label: '领域' },
              h('select', { className: 'lb-select', value: memDomain, onChange: (e) => setMemDomain(e.target.value) },
                ...data.state.domains.map((domain) => h('option', { key: domain.id, value: domain.id }, domain.name || domain.id))
              )
            )
          ),
          memError ? h('div', { className: 'lb-error' }, memError) : null,
          h('textarea', { className: 'lb-textarea', value: memText, onChange: (e) => setMemText(e.target.value), placeholder: '每行一条，例如：玩家反馈 1.2.3 版本合成界面点星标没反应' }),
          h('div', { className: 'lb-footer' },
            memMessage ? h('span', { className: 'lb-ok' }, memMessage) : null,
            h('button', { className: 'lb-btn lb-btn--danger', onClick: clearMemory }, '清空'),
            h('button', { className: 'lb-btn lb-btn--primary', onClick: saveMemory }, '保存记忆')
          )
        ),
        h(Card, { title: '共享知识库', extra: h('div', { className: 'lb-actions' },
          h('button', { className: 'lb-btn', onClick: loadKb }, '刷新'),
          kbFile ? h('button', { className: 'lb-btn lb-btn--primary', onClick: saveKb }, '保存文档') : null
        ) },
          h('div', { className: 'lb-muted' }, `目录：${data.paths?.dataDir ?? ''}/knowledge（Markdown / TXT；按 scope 分目录）`),
          kbError ? h('div', { className: 'lb-error' }, kbError) : null,
          kb ? h('div', null,
            h('div', { className: 'lb-muted' }, `scope：${(kb.scopes ?? []).join('、') || '（空）'}；文件 ${kb.count ?? 0} 个`),
            h('div', { style: { overflowX: 'auto' } },
              h('table', { className: 'lb-table' },
                h('thead', null, h('tr', null, h('th', null, 'scope'), h('th', null, '文件'), h('th', null, '大小'), h('th', null, ''))),
                h('tbody', null, ...(kb.files ?? []).map((file) => h('tr', { key: `${file.scope}/${file.path}` },
                  h('td', null, file.scope), h('td', { className: 'lb-mono' }, file.path), h('td', null, `${file.size} B`),
                  h('td', null, h('button', { className: 'lb-btn', onClick: () => openKb(file) }, '打开'))
                )))
              )
            )
          ) : h('div', { className: 'lb-muted' }, '加载中…'),
          kbFile ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { className: 'lb-row' },
              h('span', { className: 'lb-mono' }, `${kbFile.scope}/${kbFile.path}`),
              kbMessage ? h('span', { className: 'lb-ok' }, kbMessage) : null
            ),
            h('textarea', { className: 'lb-textarea lb-textarea--tall', value: kbContent, onChange: (e) => setKbContent(e.target.value) }),
            h('div', { className: 'lb-footer' },
              h('button', { className: 'lb-btn', onClick: () => { setKbFile(null); setKbContent(''); } }, '关闭'),
              h('button', { className: 'lb-btn lb-btn--primary', onClick: saveKb }, '保存文档')
            )
          ) : null
        )
      );
    }

    function KbDrafts({ data, refresh }) {
      const [state, setState] = useState(null);
      const [error, setError] = useState('');
      const [message, setMessage] = useState('');
      const [busy, setBusy] = useState('');
      const load = useCallback(async () => {
        setError('');
        try { setState(await api('/kb/drafts')); } catch (err) { setError(String(err.message ?? err)); }
      }, []);
      useEffect(() => { void load(); }, [load]);
      const approve = async (draft, target) => {
        setBusy(`${draft.scope}/${draft.file}`); setError(''); setMessage('');
        try {
          await api('/kb/drafts', { method: 'POST', body: JSON.stringify({ action: 'approve', scope: draft.scope, file: draft.file, target }) });
          setMessage('已采纳，已并入正式知识库');
          await load();
          await refresh();
        } catch (err) { setError(String(err.message ?? err)); } finally { setBusy(''); }
      };
      const discard = async (draft) => {
        if (typeof window.confirm === 'function' && !window.confirm('丢弃这条草稿？')) return;
        setBusy(`${draft.scope}/${draft.file}`); setError(''); setMessage('');
        try {
          await api('/kb/drafts', { method: 'POST', body: JSON.stringify({ action: 'discard', scope: draft.scope, file: draft.file }) });
          setMessage('已丢弃草稿');
          await load();
        } catch (err) { setError(String(err.message ?? err)); } finally { setBusy(''); }
      };
      const drafts = state?.drafts ?? [];
      return h('div', { className: 'lb-root' },
        h(Card, { title: '知识库审批', extra: h('button', { className: 'lb-btn', onClick: load }, '刷新') },
          h('div', { className: 'lb-muted' }, 'AI 只能把新结论写进「待审」区；未采纳前不参与检索。采纳时会把内容追加到目标文档，并保留来源。'),
          error ? h('div', { className: 'lb-error' }, error) : null,
          message ? h('span', { className: 'lb-ok' }, message) : null,
          !state ? h('div', { className: 'lb-muted' }, '加载中…') : drafts.length === 0
            ? h('div', { className: 'lb-muted' }, '没有待审草稿。')
            : h('div', { className: 'lb-list' }, ...drafts.map((draft) => {
              const targets = state.targets?.[draft.scope] ?? [];
              const options = targets.length ? targets : ['常见问题.md'];
              const target = options.includes('常见问题.md') ? '常见问题.md' : options[0];
              const selectId = `lb-draft-target-${draft.scope}-${draft.file}`;
              return h('div', { className: 'lb-card', key: `${draft.scope}/${draft.file}` },
                h('div', { className: 'lb-card-head' },
                  h('div', null,
                    h('div', { className: 'lb-card-title' }, draft.title),
                    h('div', { className: 'lb-mono lb-muted' }, `${draft.scope} / ${draft.file}`)
                  ),
                  h('span', { className: 'lb-pill' }, `${draft.chars} 字`)
                ),
                h('div', { className: 'lb-muted' }, `来源：${draft.source || '（未注明）'}`),
                h('div', { className: 'lb-muted' }, draft.preview || '（正文为空）'),
                h('div', { className: 'lb-row' },
                  h('select', { className: 'lb-select', defaultValue: target, id: selectId },
                    ...options.map((option) => h('option', { key: option, value: option }, option))
                  ),
                  h('button', {
                    className: 'lb-btn lb-btn--primary',
                    disabled: busy === `${draft.scope}/${draft.file}`,
                    onClick: () => {
                      const el = document.getElementById(selectId);
                      void approve(draft, el?.value ?? target);
                    },
                  }, '采纳'),
                  h('button', {
                    className: 'lb-btn lb-btn--danger',
                    disabled: busy === `${draft.scope}/${draft.file}`,
                    onClick: () => void discard(draft),
                  }, '丢弃')
                )
              );
            }))
        )
      );
    }

    function Usage({ data, refresh }) {
      const [usage, setUsage] = useState(null);
      const [error, setError] = useState('');
      const [message, setMessage] = useState('');
      const load = useCallback(async () => {
        setError('');
        try { setUsage(await api('/usage')); } catch (err) { setError(String(err.message ?? err)); }
      }, []);
      useEffect(() => { void load(); }, [load]);
      const clear = async () => {
        if (typeof window.confirm === 'function' && !window.confirm('清空本地用量记录？')) return;
        setError(''); setMessage('');
        try {
          setUsage(await api('/usage', { method: 'POST', body: '{}' }));
          setMessage('已清空');
          await refresh();
        } catch (err) { setError(String(err.message ?? err)); }
      };
      const total = usage?.total ?? {};
      return h('div', { className: 'lb-root' },
        h(Card, { title: 'Token 用量', extra: h('div', { className: 'lb-actions' },
          h('button', { className: 'lb-btn', onClick: load }, '刷新'),
          h('button', { className: 'lb-btn lb-btn--danger', onClick: clear }, '清空')
        ) },
          h('div', { className: 'lb-muted' }, '只记录本插件接管的会话；数据保存在本地 usage.jsonl，不上传。按轮次记录 DSH 上报的 input/output/cache token。'),
          error ? h('div', { className: 'lb-error' }, error) : null,
          message ? h('span', { className: 'lb-ok' }, message) : null,
          h('div', { className: 'lb-grid' },
            h(Field, { label: '轮次' }, h('div', { className: 'lb-mono' }, String(total.turns ?? 0))),
            h(Field, { label: '输入 token' }, h('div', { className: 'lb-mono' }, String(total.inputTokens ?? 0))),
            h(Field, { label: '输出 token' }, h('div', { className: 'lb-mono' }, String(total.outputTokens ?? 0))),
            h(Field, { label: '缓存命中 token' }, h('div', { className: 'lb-mono' }, String(total.cacheReadTokens ?? 0))),
            h(Field, { label: '缓存写入 token' }, h('div', { className: 'lb-mono' }, String(total.cacheWriteTokens ?? 0))),
            h(Field, { label: '总计' }, h('div', { className: 'lb-mono' }, String(total.totalTokens ?? 0)))
          ),
          usage?.byKey?.length ? h('div', { style: { overflowX: 'auto' } },
            h('table', { className: 'lb-table' },
              h('thead', null, h('tr', null,
                h('th', null, '会话'), h('th', null, '轮次'), h('th', null, '输入'), h('th', null, '输出'), h('th', null, '缓存命中'), h('th', null, '总计')
              )),
              h('tbody', null, ...usage.byKey.map((row) => h('tr', { key: row.key },
                h('td', { className: 'lb-mono' }, row.key),
                h('td', null, String(row.turns)),
                h('td', null, String(row.inputTokens)),
                h('td', null, String(row.outputTokens)),
                h('td', null, String(row.cacheReadTokens)),
                h('td', null, String(row.totalTokens))
              )))
            )
          ) : h('div', { className: 'lb-muted' }, '还没有用量记录。')
        )
      );
    }

    function Push({ data, refresh }) {
      const [targets, setTargets] = useState([]);
      const [text, setText] = useState('');
      const [message, setMessage] = useState('');
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const keys = [...new Set([...Object.keys(data.state.bindings ?? {}), ...Object.keys(data.state.conversations ?? {})])];
      const toggle = (key, on) => setTargets((list) => (
        on ? [...new Set([...list, key])] : list.filter((item) => item !== key)
      ));
      const send = async () => {
        setBusy(true); setError(''); setMessage('');
        try {
          const result = await api('/push', { method: 'POST', body: JSON.stringify({ targets, messages: text }) });
          const results = Array.isArray(result.results) ? result.results : [];
          const okCount = results.filter((item) => item.ok).length;
          setMessage(`已发送 ${result.sent ?? 0} 条 · ${okCount}/${targets.length} 个会话成功`);
          const failed = results.filter((item) => !item.ok);
          if (failed.length > 0) setError(failed.map((item) => `${item.target}：${item.error}`).join('；'));
          await refresh();
        } catch (err) { setError(String(err.message ?? err)); } finally { setBusy(false); }
      };
      return h('div', { className: 'lb-root' },
        h(Card, { title: '统一推送' },
          h('div', { className: 'lb-muted' }, '向任意已发现/已绑定会话发送消息，可同时勾选多个。外部系统用 `POST /lane-bridge/api/push` + `Authorization: Bearer <pushToken>`，body 用 `targets` 数组。'),
          h(Field, { label: `目标会话（已选 ${targets.length} 个）` },
            h('div', { className: 'lb-row' },
              h('button', { className: 'lb-btn', onClick: () => setTargets(keys) }, `全选（${keys.length}）`),
              h('button', { className: 'lb-btn', onClick: () => setTargets([]) }, '清空')
            ),
            keys.length > 0
              ? h('div', { style: { maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--dsw-alias-border,#e5e7eb)', borderRadius: 8, padding: '8px 10px' } },
                ...keys.map((key) => h('label', { key, className: 'lb-check' },
                  h('input', { type: 'checkbox', checked: targets.includes(key), onChange: (e) => toggle(key, e.target.checked) }),
                  h('span', null, `${data.state.conversations?.[key]?.name ?? key} `, h('span', { className: 'lb-mono lb-muted' }, key))
                ))
              )
              : h('div', { className: 'lb-muted' }, '还没有已发现/已绑定会话。')
          ),
          h(Field, { label: '消息', hint: '换行会被保留；过长会按全局上限拆分' },
            h('textarea', { className: 'lb-textarea', value: text, onChange: (e) => setText(e.target.value) })
          ),
          h('div', { className: 'lb-footer' },
            message ? h('span', { className: 'lb-ok' }, message) : null,
            error ? h('span', { className: 'lb-error' }, error) : null,
            h('button', { className: 'lb-btn lb-btn--primary', disabled: busy || targets.length === 0 || !text.trim(), onClick: send }, busy ? '发送中…' : `发送到 ${targets.length} 个会话`)
          )
        ),
        h(Card, { title: 'curl 示例' },
          h('pre', { className: 'lb-mono', style: { whiteSpace: 'pre-wrap', margin: 0 } },
            `curl -X POST http://127.0.0.1:<dsh-port>/lane-bridge/api/push \\\n  -H "Authorization: Bearer $LANE_PUSH_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"targets":["snowluma:group:123456","qqbot:private:8FD..."],"messages":"维护通知：今晚 23:00 停服"}'`
          )
        )
      );
    }

    // A render error in one plugin card can unmount the whole Settings tree in
    // some DSH versions, which looks like "all UI disappeared".  Keep failures
    // inside this boundary and show the actual message instead.
    class LaneErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
        this.retry = this.retry.bind(this);
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error) {
        try { console.error('[dsh-lane-bridge] UI render failed', error); } catch {}
      }
      retry() {
        this.setState({ error: null });
      }
      render() {
        if (this.state.error) {
          return h('div', { className: 'lb-root' },
            h('div', { className: 'lb-error' }, `面板渲染失败：${this.state.error?.message ?? this.state.error}`),
            h('button', { className: 'lb-btn', onClick: this.retry }, '重试')
          );
        }
        return this.props.children;
      }
    }

    function LanePanel({ compact = false, initialTab = 'overview' }) {
      const [data, setData] = useState(null);
      const [version, setVersion] = useState('');
      const [error, setError] = useState('');
      const [tab, setTab] = useState(initialTab);
      const load = useCallback(async () => {
        try {
          const next = await api('/state');
          setData(next);
          setError('');
        } catch (err) { setError(String(err.message ?? err)); }
      }, []);
      useEffect(() => {
        void load();
        const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 15000);
        return () => clearInterval(timer);
      }, [load]);
      // The build the host actually loaded, straight from the running process.
      // Without this, "restart to load the new version" is unfalsifiable.
      useEffect(() => {
        let alive = true;
        api('/health').then((health) => { if (alive) setVersion(String(health?.version ?? '')); }).catch(() => {});
        return () => { alive = false; };
      }, []);
      const tabs = [
        ['overview', '概览与通道'],
        ['conversations', '会话'],
        ['domains', '领域'],
        ['roles', '角色与知识'],
        ['drafts', '知识库审批'],
        ['usage', '用量'],
        ['push', '推送'],
      ];
      return h('div', { className: `lb-root ${compact ? 'lb-root--compact' : ''}` },
        h('div', { className: 'lb-head' },
          h('div', null,
            h('h2', { className: 'lb-title' }, 'IM 桥接'),
            h('p', { className: 'lb-sub' }, 'QQ / 官方 QQ Bot / Discord 共用一个客服层：领域、角色卡、知识库与统一推送。每个模块可点标题折叠，标题栏有独立保存按钮，页面底部也有固定保存栏。')
          ),
          h('div', { className: 'lb-actions' },
            version ? h('span', { className: 'lb-muted', title: '当前运行中的插件版本' }, `v${version}`) : null,
            h('button', { className: 'lb-btn', onClick: load }, '刷新')
          )
        ),
        error ? h('div', { className: 'lb-error' }, error) : null,
        data ? h('div', { className: 'lb-tabs' },
          ...tabs.map(([id, label]) => h('button', {
            key: id,
            className: `lb-tab ${tab === id ? 'lb-tab--on' : ''}`,
            onClick: () => setTab(id),
          }, label))
        ) : null,
        !data && !error ? h('div', { className: 'lb-muted' }, '加载中…') : null,
        data && tab === 'overview' ? h(Overview, { data, refresh: load }) : null,
        data && tab === 'conversations' ? h(Conversations, { data, refresh: load }) : null,
        data && tab === 'domains' ? h(Domains, { data, refresh: load }) : null,
        data && tab === 'roles' ? h(RolesAndKnowledge, { data, refresh: load }) : null,
        data && tab === 'drafts' ? h(KbDrafts, { data, refresh: load }) : null,
        data && tab === 'usage' ? h(Usage, { data, refresh: load }) : null,
        data && tab === 'push' ? h(Push, { data, refresh: load }) : null
      );
    }

    function LaneSettings() {
      return h(LaneErrorBoundary, null, h(LanePanel, null));
    }

    function LaneSidebar() {
      return h('div', { className: 'lb-sidebar' },
        h(LaneErrorBoundary, null, h(LanePanel, { compact: true, initialTab: 'conversations' }))
      );
    }

    const TAB_KIND = 'lane-bridge-panel';
    const TAB_ID = 'lane-bridge/sidebar';

    function LaneIcon() {
      return h('svg', {
        width: 20,
        height: 20,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': true,
      },
        h('path', {
          d: 'M4.5 5.5h15v10.2h-8.1L7 19.2v-3.5H4.5V5.5Z',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M8.2 9.1h7.6M8.2 12.2h5.2',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        })
      );
    }

    const name = 'dsh-lane-bridge-client';
    const inject = ['slots', 'sidebarRightTabs'];

    function apply(ctx) {
      const disposers = [];
      if (ctx.slots) {
        disposers.push(ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'lane-bridge',
          order: 35,
          label: 'IM 桥接',
        }, LaneSettings)));
      }
      if (ctx.slots && ctx.sidebarRightTabs) {
        disposers.push(ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          title: () => 'IM 桥接',
          guide: [{
            id: 'lane-bridge',
            order: 70,
            title: () => 'IM 桥接',
            description: () => '会话、通道、领域与知识库管理',
            icon: LaneIcon,
          }],
        }));
        disposers.push(ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
        }, LaneSidebar)));
      }
      ctx.effect(() => () => {
        for (const dispose of disposers.reverse()) {
          try { dispose(); } catch {}
        }
      }, 'dsh-lane-bridge-client.panels');
    }

    const exportsObject = { name, inject, apply };
    if (globalThis.__LANE_TEST__) {
      exportsObject.__components = { Card, Conversations, Domains, KbDrafts, LanePanel, LaneSettings, LaneSidebar, Push };
    }
    return exportsObject;
  },
});
