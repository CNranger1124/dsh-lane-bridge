// Read-only GitHub repository access for support agents.
//
// The repository is fixed by config; tools never accept an owner/repo. The
// token is only used in headers and is redacted from every error and return
// value. Network access is pinned to api.github.com.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API_BASE = 'https://api.github.com';
const MAX_CACHE = 120;
const GH_CANDIDATES = ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe', 'C:\\Program Files (x86)\\GitHub CLI\\gh.exe'];

function trim(text, max) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max)}\n…（已截断，原始 ${value.length} 字符）`;
}

function normalizePath(input) {
  const raw = String(input ?? '').trim().replace(/\\/gu, '/');
  if (!raw) return { ok: false, message: 'path 不能为空' };
  if (raw.length > 400) return { ok: false, message: 'path 过长' };
  if (raw.startsWith('/') || /^[a-zA-Z]:/u.test(raw)) return { ok: false, message: 'path 必须是仓库内的相对路径' };
  const parts = raw.split('/').filter(Boolean);
  if (parts.some((part) => part === '..')) return { ok: false, message: 'path 不允许包含 ..' };
  return { ok: true, path: parts.join('/') };
}

function normalizeRef(input) {
  const ref = String(input ?? '').trim();
  if (!ref) return '';
  if (ref.length > 120 || /[\\\s]/u.test(ref)) throw new Error('ref 非法');
  return ref;
}

function parseRepo(value) {
  const repo = String(value ?? '').trim();
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(repo);
  return match ? { owner: match[1], name: match[2], full: `${match[1]}/${match[2]}` } : null;
}

function redact(text, token) {
  let out = String(text ?? '');
  if (token && out.includes(token)) out = out.split(token).join('***');
  return out;
}

export class GitHubRepo {
  constructor({ getConfig, dataDir = '', logger = null, fetchImpl = null } = {}) {
    this.getConfig = getConfig;
    this.dataDir = dataDir;
    this.logger = logger;
    this.fetchImpl = fetchImpl ?? fetch;
    this.cache = new Map();
    this.ghCache = { at: 0, token: '', account: '' };
    this.auditFile = dataDir ? path.join(dataDir, 'github-repo-audit.log') : '';
    this.counterFile = dataDir ? path.join(dataDir, 'github-repo-calls.json') : '';
  }

  config() {
    const raw = this.getConfig?.()?.github ?? {};
    const parsed = parseRepo(raw.repo);
    return {
      enabled: raw.enabled === true,
      repo: parsed?.full ?? '',
      owner: parsed?.owner ?? '',
      name: parsed?.name ?? '',
      valid: Boolean(parsed),
      token: String(raw.token ?? ''),
      branch: String(raw.branch ?? '').trim(),
      allowCreateIssue: raw.allowCreateIssue === true,
      issueLabel: String(raw.issueLabel ?? 'agent').trim() || 'agent',
      maxCreatesPerHour: Math.max(0, Math.min(20, Number(raw.maxCreatesPerHour) || 3)),
      maxFileChars: Math.max(2000, Math.min(60000, Number(raw.maxFileChars) || 20000)),
    };
  }

  ghAuth(force = false) {
    if (process.env.QQ_GITHUB_DISABLE_GH === '1') return { token: '', account: '' };
    if (!force && Date.now() - this.ghCache.at < 5 * 60 * 1000) return this.ghCache;
    let token = '';
    let account = '';
    for (const bin of GH_CANDIDATES) {
      try {
        token = String(execFileSync(bin, ['auth', 'token'], {
          timeout: 5000,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        })).trim();
        if (token) {
          try {
            account = String(execFileSync(bin, ['api', 'user', '--jq', '.login'], {
              timeout: 5000,
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
              windowsHide: true,
            })).trim();
          } catch {}
          break;
        }
      } catch {}
    }
    this.ghCache = { at: Date.now(), token, account };
    return this.ghCache;
  }

  auth() {
    const cfg = this.config();
    if (cfg.token) return { token: cfg.token, source: 'config', account: '' };
    const gh = this.ghAuth();
    if (gh.token) return { token: gh.token, source: 'gh-cli', account: gh.account };
    return { token: '', source: 'anonymous', account: '' };
  }

  status(resolveAuth = false) {
    const cfg = this.config();
    const auth = resolveAuth ? this.auth() : { token: cfg.token, source: cfg.token ? 'config' : 'not-checked', account: '' };
    return {
      enabled: cfg.enabled,
      repo: cfg.repo,
      repoConfigured: cfg.valid,
      branch: cfg.branch,
      tokenConfigured: Boolean(cfg.token),
      authSource: auth.source,
      authAccount: auth.account,
      authenticated: Boolean(auth.token),
      allowCreateIssue: cfg.allowCreateIssue,
      hint: !cfg.enabled
        ? 'GitHub 仓库读取未启用：在设置 → IM 桥接 → 概览与通道里启用'
        : !cfg.valid
          ? '仓库格式应为 owner/repo'
          : cfg.token
            ? '可用 lane_repo_status / lane_repo_read_file / lane_repo_search_code 等工具'
            : '可用只读工具；未填 token 时 GitHub 匿名额度可能不足，代码搜索也必须填 token',
    };
  }

  async request(apiPath, { method = 'GET', body, accept, retried = false } = {}) {
    const cfg = this.config();
    if (!cfg.enabled) throw new Error('GitHub 仓库读取未启用');
    if (!cfg.valid) throw new Error('GitHub 仓库未配置：请填写 owner/repo');
    const auth = this.auth();
    if (method !== 'GET' && !auth.token) throw new Error('该操作需要 GitHub token');
    const url = `${API_BASE}${apiPath}`;
    const headers = {
      accept: accept || 'application/vnd.github+json',
      'user-agent': 'dsh-lane-bridge',
      'x-github-api-version': '2022-11-28',
    };
    if (auth.token) headers.authorization = `Bearer ${auth.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const cacheKey = method === 'GET' ? `${cfg.repo}|${accept || ''}|${apiPath}` : '';
    const cached = cacheKey ? this.cache.get(cacheKey) : null;
    if (cached?.etag) headers['if-none-match'] = cached.etag;
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw new Error(`GitHub 请求失败：${redact(error?.message ?? error, auth.token)}`);
    }
    if (response.status === 304 && cached) {
      cached.at = Date.now();
      return { ok: true, status: 200, data: cached.data, cached: true };
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text ? { raw: text.slice(0, 2000) } : null; }
    if (response.ok && cacheKey) {
      const etag = response.headers.get('etag') || '';
      if (etag && text.length <= 512 * 1024) {
        this.cache.set(cacheKey, { etag, data, at: Date.now() });
        if (this.cache.size > MAX_CACHE) {
          const oldest = [...this.cache.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0))[0]?.[0];
          if (oldest) this.cache.delete(oldest);
        }
      }
    }
    if (!response.ok) {
      if (response.status === 401 && auth.source === 'gh-cli' && !retried) {
        this.ghAuth(true);
        return this.request(apiPath, { method, body, accept, retried: true });
      }
      const msg = data?.message ?? '';
      let hint = '';
      if (response.status === 401) hint = '（token 无效或过期）';
      else if (response.status === 403 && /rate limit/iu.test(msg)) hint = '（额度用完或 token 权限不足）';
      else if (response.status === 404) hint = '（仓库/资源不存在，或没有读权限）';
      throw new Error(`${response.status} ${redact(msg || 'GitHub API 请求失败', auth.token)}${hint}`);
    }
    return { ok: true, status: response.status, data, cached: false };
  }

  async #apiJson(apiPath, auth) {
    const headers = {
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-lane-bridge',
      'x-github-api-version': '2022-11-28',
    };
    if (auth.token) headers.authorization = `Bearer ${auth.token}`;
    let response;
    try {
      response = await this.fetchImpl(`${API_BASE}${apiPath}`, { headers, signal: AbortSignal.timeout(15000) });
    } catch (error) {
      throw new Error(`GitHub 请求失败：${redact(error?.message ?? error, auth.token)}`);
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw new Error(`${response.status} ${redact(data?.message || 'GitHub API 请求失败', auth.token)}`);
    return data;
  }

  #ghJson(args) {
    if (process.env.QQ_GITHUB_DISABLE_GH === '1') return null;
    for (const bin of GH_CANDIDATES) {
      try {
        const out = String(execFileSync(bin, args, {
          timeout: 15000,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        })).trim();
        return JSON.parse(out);
      } catch {}
    }
    return null;
  }

  async authStatus() {
    const cfg = this.config();
    const auth = this.auth();
    return {
      authenticated: Boolean(auth.token),
      source: auth.source,
      account: auth.account,
      repo: cfg.repo,
      ghInstalled: GH_CANDIDATES.some((bin) => {
        try {
          execFileSync(bin, ['--version'], { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
          return true;
        } catch { return false; }
      }),
      hint: auth.token
        ? '已找到 GitHub 凭据'
        : '没有可用凭据：先在终端运行 gh auth login，或在下方填 token',
    };
  }

  async listRepos({ limit = 100 } = {}) {
    const auth = this.auth();
    if (!auth.token) throw new Error('没有 GitHub 凭据：请先 gh auth login，或填 token');
    const gh = this.#ghJson(['repo', 'list', '--limit', String(Math.min(200, Math.max(1, Number(limit) || 100))), '--json', 'nameWithOwner,isPrivate,defaultBranchRef']);
    if (Array.isArray(gh)) {
      return {
        source: 'gh-cli',
        repos: gh.map((item) => ({
          repo: item.nameWithOwner,
          private: item.isPrivate === true,
          defaultBranch: item.defaultBranchRef?.name ?? '',
        })),
      };
    }
    const data = await this.#apiJson(`/user/repos?per_page=${Math.min(100, Math.max(1, Number(limit) || 100))}&sort=updated`, auth);
    return {
      source: 'api',
      repos: (Array.isArray(data) ? data : []).map((item) => ({
        repo: item.full_name,
        private: item.private === true,
        defaultBranch: item.default_branch ?? '',
      })),
    };
  }

  async listBranches({ repo } = {}) {
    const parsed = parseRepo(repo || this.config().repo);
    if (!parsed) throw new Error('仓库格式应为 owner/repo');
    const auth = this.auth();
    if (!auth.token) throw new Error('没有 GitHub 凭据：请先 gh auth login，或填 token');
    const gh = this.#ghJson(['api', `repos/${parsed.full}/branches?per_page=100`]);
    if (Array.isArray(gh)) return { repo: parsed.full, source: 'gh-cli', branches: gh.map((item) => item.name).filter(Boolean) };
    const data = await this.#apiJson(`/repos/${parsed.full}/branches?per_page=100`, auth);
    return { repo: parsed.full, source: 'api', branches: (Array.isArray(data) ? data : []).map((item) => item.name).filter(Boolean) };
  }

  async listIssues({ state = 'open', query = '', labels = '', limit = 15 } = {}) {
    const cfg = this.config();
    const n = Math.min(30, Math.max(1, Number(limit) || 15));
    let apiPath;
    if (query || labels) {
      const terms = [`repo:${cfg.repo}`, 'is:issue'];
      if (state !== 'all') terms.push(`state:${state}`);
      if (query) terms.push(String(query));
      for (const label of String(labels).split(',').map((item) => item.trim()).filter(Boolean)) terms.push(`label:"${label}"`);
      apiPath = `/search/issues?q=${encodeURIComponent(terms.join(' '))}&per_page=${n}&sort=updated&order=desc`;
    } else {
      apiPath = `/repos/${cfg.owner}/${cfg.name}/issues?state=${encodeURIComponent(state)}&per_page=${n}&sort=updated&direction=desc`;
    }
    const result = await this.request(apiPath);
    const items = Array.isArray(result.data) ? result.data : (result.data?.items ?? []);
    return {
      repo: cfg.repo,
      total: result.data?.total_count,
      issues: items.filter((item) => !item.pull_request).slice(0, n).map((item) => ({
        number: item.number,
        title: trim(item.title, 200),
        state: item.state,
        labels: (item.labels ?? []).map((label) => typeof label === 'string' ? label : label.name).slice(0, 6),
        comments: item.comments,
        updatedAt: item.updated_at,
        url: item.html_url,
        bodyPreview: trim(String(item.body ?? '').replace(/\r/gu, ''), 300),
      })),
    };
  }

  async getIssue({ number, comments = 10, commentChars = 800 } = {}) {
    const cfg = this.config();
    const id = Number(number);
    if (!Number.isInteger(id) || id < 1) throw new Error('number 必须是正整数');
    const result = await this.request(`/repos/${cfg.owner}/${cfg.name}/issues/${id}`);
    const issue = result.data ?? {};
    const out = {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      labels: (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label.name),
      author: issue.user?.login,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      url: issue.html_url,
      body: trim(String(issue.body ?? '').replace(/\r/gu, ''), 4000),
    };
    if (comments > 0 && Number(issue.comments) > 0) {
      const cResult = await this.request(`/repos/${cfg.owner}/${cfg.name}/issues/${id}/comments?per_page=${Math.min(30, comments)}&sort=created&direction=desc`);
      if (Array.isArray(cResult.data)) {
        out.comments = cResult.data.slice(-Math.min(30, comments)).reverse().map((comment) => ({
          author: comment.user?.login,
          createdAt: comment.created_at,
          body: trim(String(comment.body ?? '').replace(/\r/gu, ''), Math.min(3000, Math.max(200, commentChars))),
        }));
      }
    }
    return out;
  }

  async searchCode({ query, path: prefix, limit = 10 } = {}) {
    const cfg = this.config();
    const auth = this.auth();
    if (!auth.token) throw new Error('代码搜索需要 GitHub token（或先 gh auth login）');
    const q = String(query ?? '').trim();
    if (!q) throw new Error('query 不能为空');
    const terms = [`repo:${cfg.repo}`, q];
    const normalized = normalizePath(prefix ?? '');
    if (normalized.ok && normalized.path) terms.push(`path:${normalized.path}`);
    const result = await this.request(`/search/code?q=${encodeURIComponent(terms.join(' '))}&per_page=${Math.min(20, Math.max(1, Number(limit) || 10))}`, {
      accept: 'application/vnd.github.text-match+json',
    });
    return {
      repo: cfg.repo,
      query: q,
      total: result.data?.total_count,
      results: (result.data?.items ?? []).map((item) => ({
        path: item.path,
        url: item.html_url,
        fragments: (item.text_matches ?? []).slice(0, 3).map((match) => trim(String(match.fragment ?? '').replace(/\r/gu, ''), 240)),
      })),
    };
  }

  async readFile({ path: filePath, ref } = {}) {
    const cfg = this.config();
    const normalized = normalizePath(filePath);
    if (!normalized.ok) throw new Error(normalized.message);
    const refValue = normalizeRef(ref);
    const encoded = normalized.path.split('/').map((part) => encodeURIComponent(part)).join('/');
    const query = refValue ? `?ref=${encodeURIComponent(refValue)}` : '';
    const result = await this.request(`/repos/${cfg.owner}/${cfg.name}/contents/${encoded}${query}`);
    const data = result.data ?? {};
    if (Array.isArray(data)) {
      return { path: normalized.path, directory: true, entries: data.map((item) => ({ name: item.name, type: item.type, path: item.path })) };
    }
    if (data.encoding !== 'base64' || typeof data.content !== 'string') {
      throw new Error(`该文件不可作为文本读取（size=${data.size ?? '?'}）`);
    }
    const text = Buffer.from(data.content, 'base64').toString('utf8').replace(/\r\n/gu, '\n');
    return {
      path: data.path,
      size: data.size,
      sha: data.sha,
      truncated: text.length > cfg.maxFileChars,
      content: trim(text, cfg.maxFileChars),
    };
  }

  async recentCommits({ limit = 15, path: pathFilter, since } = {}) {
    const cfg = this.config();
    const n = Math.min(30, Math.max(1, Number(limit) || 15));
    const params = new URLSearchParams({ per_page: String(n) });
    if (pathFilter) {
      const normalized = normalizePath(pathFilter);
      if (!normalized.ok) throw new Error(normalized.message);
      params.set('path', normalized.path);
    }
    if (since) {
      const timestamp = Date.parse(String(since));
      if (!Number.isFinite(timestamp)) throw new Error('since 不是合法时间');
      params.set('since', new Date(timestamp).toISOString());
    }
    const result = await this.request(`/repos/${cfg.owner}/${cfg.name}/commits?${params.toString()}`);
    return {
      repo: cfg.repo,
      commits: (Array.isArray(result.data) ? result.data : []).map((commit) => ({
        sha: String(commit.sha ?? '').slice(0, 10),
        message: trim(String(commit.commit?.message ?? '').split('\n')[0], 160),
        author: commit.commit?.author?.name,
        date: commit.commit?.author?.date,
        url: commit.html_url,
      })),
    };
  }

  readCounter() {
    try {
      const data = JSON.parse(fs.readFileSync(this.counterFile, 'utf8'));
      return { hour: String(data?.hour ?? ''), count: Math.max(0, Number(data?.count) || 0) };
    } catch {
      return { hour: '', count: 0 };
    }
  }

  writeCounter(hour, count) {
    try {
      fs.mkdirSync(path.dirname(this.counterFile), { recursive: true });
      fs.writeFileSync(this.counterFile, JSON.stringify({ hour, count }, null, 2), 'utf8');
    } catch {}
  }

  async createIssue({ title, body, labels } = {}) {
    const cfg = this.config();
    if (!cfg.allowCreateIssue) throw new Error('建 issue 未开启（管理员可在 Settings → IM 桥接 → 概览与通道 开启）');
    const hour = new Date().toISOString().slice(0, 13);
    const used = this.readCounter();
    const count = used.hour === hour ? used.count : 0;
    if (count >= cfg.maxCreatesPerHour) throw new Error(`本小时已建 ${count} 条 issue，达到上限 ${cfg.maxCreatesPerHour}`);
    const cleanTitle = String(title ?? '').trim().slice(0, 200);
    const cleanBody = String(body ?? '').trim().slice(0, 20000);
    if (!cleanTitle) throw new Error('title 不能为空');
    const labelSet = new Set([cfg.issueLabel]);
    for (const label of String(labels ?? '').split(',').map((item) => item.trim()).filter(Boolean)) labelSet.add(label);
    const result = await this.request(`/repos/${cfg.owner}/${cfg.name}/issues`, {
      method: 'POST',
      body: { title: cleanTitle, body: cleanBody, labels: [...labelSet] },
    });
    this.writeCounter(hour, count + 1);
    try {
      if (this.auditFile) {
        fs.mkdirSync(path.dirname(this.auditFile), { recursive: true });
        fs.appendFileSync(this.auditFile, `${new Date().toISOString()} ${JSON.stringify({ action: 'create_issue', number: result.data?.number, title: cleanTitle })}\n`, 'utf8');
      }
    } catch {}
    return { ok: true, number: result.data?.number, url: result.data?.html_url, labels: [...labelSet], createsThisHour: count + 1 };
  }
}
