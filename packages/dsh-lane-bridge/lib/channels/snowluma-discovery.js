// SnowLuma endpoint discovery.
//
// SnowLuma writes one OneBot config per QQ account under
// `<home>/config/onebot_<uin>.json`; the WS token and port are per account. A
// user who already runs SnowLuma should not have to copy the token by hand, so
// the adapter can read it when the operator points `channels.snowluma.homeDir`
// at the SnowLuma install (or sets SNOWLUMA_HOME).
import fs from 'node:fs';
import path from 'node:path';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function discoverSnowLumaEndpoint({ homeDir = '', accessToken = '', wsUrl = '' } = {}) {
  const homes = [homeDir, process.env.SNOWLUMA_HOME].filter(Boolean);
  for (const home of homes) {
    const configDir = path.join(String(home), 'config');
    let entries = [];
    try {
      entries = fs.readdirSync(configDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const candidates = entries
      .filter((entry) => entry.isFile() && /^onebot_(\d+)\.json$/iu.test(entry.name))
      .map((entry) => ({ entry, uin: /^onebot_(\d+)\.json$/iu.exec(entry.name)[1] }))
      .sort((a, b) => a.uin.localeCompare(b.uin));
    for (const { entry, uin } of candidates) {
      const file = path.join(configDir, entry.name);
      const config = readJson(file);
      const ws = config?.networks?.wsServers?.[0];
      if (!ws) continue;
      const token = String(ws.accessToken ?? '');
      if (!token && accessToken) continue;
      const host = String(ws.host || '127.0.0.1');
      const port = Number(ws.port) || 3001;
      return {
        wsUrl: wsUrl || `ws://${host}:${port}`,
        accessToken: accessToken || token,
        uin,
        source: file,
      };
    }
  }
  return null;
}
