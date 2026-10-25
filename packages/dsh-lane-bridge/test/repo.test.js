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
