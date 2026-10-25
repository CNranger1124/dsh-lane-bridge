import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubRepo } from '../lib/repo.js';

function jsonResponse(status, body, etag = '') {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => name.toLowerCase() === 'etag' ? etag : '' },
    text: async () => JSON.stringify(body),
  };
}

function makeRepo(fetchImpl, overrides = {}) {
  const config = {
    github: {
      enabled: true,
      repo: 'owner/repo',
      token: 'secret-token',
      branch: 'main',
      ...overrides,
    },
  };
  return new GitHubRepo({ getConfig: () => config, fetchImpl });
}

test('GitHub repo reads files, issues, and recent commits', async () => {
  const calls = [];
  const repo = makeRepo(async (url) => {
    calls.push(url);
    if (url.includes('/contents/')) {
      return jsonResponse(200, {
        path: 'src/app.js', size: 12, sha: 'abc', encoding: 'base64',
        content: Buffer.from('console.log(1)').toString('base64'),
      });
    }
    if (url.includes('/issues')) {
      return jsonResponse(200, [{ number: 7, title: 'Bug', state: 'open', labels: [], comments: 1, updated_at: 'now', html_url: 'u', body: 'body' }]);
    }
    return jsonResponse(200, [{ sha: '1234567890', commit: { message: 'fix\nbody', author: { name: 'A', date: 'now' } }, html_url: 'u' }]);
  });
  const file = await repo.readFile({ path: 'src/app.js' });
  assert.equal(file.content, 'console.log(1)');
  assert.equal(file.truncated, false);
  const issues = await repo.listIssues({});
  assert.equal(issues.issues[0].number, 7);
  const commits = await repo.recentCommits({});
  assert.equal(commits.commits[0].sha, '1234567890');
  assert.ok(calls.every((url) => url.startsWith('https://api.github.com/')));
});

test('GitHub repo blocks path traversal and redacts the token', async () => {
  const repo = makeRepo(async () => jsonResponse(401, { message: 'bad secret-token' }));
  await assert.rejects(() => repo.readFile({ path: '../.env' }), /不允许包含/);
  await assert.rejects(() => repo.readFile({ path: 'src/app.js' }), (error) => {
    assert.match(error.message, /401/);
    assert.equal(error.message.includes('secret-token'), false);
    return true;
  });
});

test('GitHub repo lists repos and branches for the settings dropdowns', async () => {
  process.env.QQ_GITHUB_DISABLE_GH = '1';
  const repo = makeRepo(async (url) => {
    if (url.includes('/user/repos')) {
      return jsonResponse(200, [{ full_name: 'owner/repo', private: true, default_branch: 'main' }]);
    }
    return jsonResponse(200, [{ name: 'main' }, { name: 'dev' }]);
  });
  try {
    const repos = await repo.listRepos({});
    assert.equal(repos.count, 1);
    assert.deepEqual(repos.repos, [{ repo: 'owner/repo', private: true, defaultBranch: 'main' }]);
    const branches = await repo.listBranches({ repo: 'owner/repo' });
    assert.deepEqual(branches.branches, ['main', 'dev']);
  } finally {
    delete process.env.QQ_GITHUB_DISABLE_GH;
  }
});

test('GitHub repo scopes reads to a domain repository and branch', async () => {
  process.env.QQ_GITHUB_DISABLE_GH = '1';
  const calls = [];
  const repo = makeRepo(async (url) => {
    calls.push(url);
    return jsonResponse(200, {
      path: 'src/app.js', size: 2, sha: 'abc', encoding: 'base64',
      content: Buffer.from('ok').toString('base64'),
    });
  });
  try {
    const scoped = repo.forRepo({ repo: 'other/project', branch: 'dev' });
    assert.equal(scoped.config().repo, 'other/project');
    assert.equal(scoped.config().branch, 'dev');
    assert.equal(repo.forRepo({ repo: 'other/project', branch: 'dev' }), scoped);
    await scoped.readFile({ path: 'src/app.js' });
    assert.match(calls[0], /\/repos\/other\/project\/contents\/src\/app\.js/);
    assert.match(calls[0], /ref=dev/);
    assert.equal(repo.forRepo({ repo: '', branch: '' }), repo);
  } finally {
    delete process.env.QQ_GITHUB_DISABLE_GH;
  }
});

test('createIssue is gated by the switch and retries without unknown labels', async () => {
  const calls = [];
  const repo = makeRepo(async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    // GitHub refuses the whole issue when a label does not exist in the repo.
    if (Array.isArray(body?.labels)) {
      return jsonResponse(422, { message: 'Validation Failed', errors: [{ resource: 'Issue', field: 'labels', code: 'invalid' }] });
    }
    return jsonResponse(201, { number: 12, html_url: 'https://github.com/owner/repo/issues/12' });
  }, { allowCreateIssue: true, issueLabel: 'agent' });

  const created = await repo.createIssue({ title: '进游戏闪退', body: '步骤：点开始' });
  assert.equal(created.ok, true);
  assert.equal(created.number, 12);
  assert.deepEqual(created.labelsDropped, ['agent']);
  assert.deepEqual(created.labels, []);
  assert.equal(created.createsThisHour, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.labels, ['agent']);
  assert.equal(calls[1].body.labels, undefined);

  const disabled = makeRepo(async () => jsonResponse(201, {}), { allowCreateIssue: false });
  await assert.rejects(() => disabled.createIssue({ title: 'x', body: 'y' }), /未开启/);
});

test('GitHub repo requires a token for code search and a valid repo', async () => {
  process.env.QQ_GITHUB_DISABLE_GH = '1';
  try {
    const noToken = makeRepo(async () => jsonResponse(200, {}), { token: '' });
    await assert.rejects(() => noToken.searchCode({ query: 'foo' }), /需要 GitHub token/);
    const invalid = makeRepo(async () => jsonResponse(200, {}), { repo: 'not-a-repo' });
    await assert.rejects(() => invalid.readFile({ path: 'a.js' }), /owner\/repo/);
  } finally {
    delete process.env.QQ_GITHUB_DISABLE_GH;
  }
});
