// Safe inbound image fetching.
//
// Chat attachments are untrusted URLs. Before handing bytes to a multimodal
// model we enforce: http(s) only, public-address destination (no SSRF), manual
// redirect checks, image/* content type, and a byte cap.
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_REDIRECTS = 3;

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidr(ip, base, bits) {
  const value = ipv4ToInt(ip);
  const start = ipv4ToInt(base);
  if (value === null || start === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (start & mask);
}

export function isPrivateAddress(address) {
  const ip = String(address ?? '').replace(/^\[|\]$/gu, '');
  if (net.isIPv4(ip)) {
    if (inCidr(ip, '0.0.0.0', 8)) return true;
    if (inCidr(ip, '10.0.0.0', 8)) return true;
    if (inCidr(ip, '100.64.0.0', 10)) return true;
    if (inCidr(ip, '127.0.0.0', 8)) return true;
    if (inCidr(ip, '169.254.0.0', 16)) return true;
    if (inCidr(ip, '172.16.0.0', 12)) return true;
    if (inCidr(ip, '192.0.0.0', 24)) return true;
    if (inCidr(ip, '192.168.0.0', 16)) return true;
    if (inCidr(ip, '198.18.0.0', 15)) return true;
    if (inCidr(ip, '224.0.0.0', 4)) return true;
    if (inCidr(ip, '240.0.0.0', 4)) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    if (lower.startsWith('ff')) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true; // unknown address form: fail closed
}

function assertPublicUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('图片地址不是合法 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持 http(s) 图片地址');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('不允许访问本机/局域网图片地址');
  }
  if (net.isIP(host) && isPrivateAddress(host)) {
    throw new Error('不允许访问本机/局域网图片地址');
  }
  return url;
}

async function readCapped(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`图片过大：${buffer.length} bytes`);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`图片过大：超过 ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

/**
 * @param {string} urlString
 * @param {object} [options]
 * @param {number} [options.maxBytes]
 * @param {number} [options.timeoutMs]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {typeof dns.lookup} [options.lookupImpl]
 * @returns {Promise<{base64:string, mediaType:string, bytes:number, url:string}>}
 */
export async function fetchImage(urlString, {
  maxBytes = 8 * 1024 * 1024,
  timeoutMs = 15_000,
  fetchImpl = globalThis.fetch,
  lookupImpl = dns.lookup,
} = {}) {
  let url = assertPublicUrl(urlString);
  if (typeof fetchImpl !== 'function') throw new Error('当前运行时不提供 fetch');
  const signal = AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 15_000));
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let addresses;
    try {
      addresses = await lookupImpl(url.hostname, { all: true, verbatim: true });
    } catch (error) {
      throw new Error(`图片域名解析失败：${error?.message ?? error}`);
    }
    const list = Array.isArray(addresses) ? addresses : [addresses];
    if (list.length === 0 || list.some((entry) => !entry?.address || isPrivateAddress(entry.address))) {
      throw new Error('图片地址解析到本机/局域网地址，已拒绝');
    }
    const response = await fetchImpl(url.toString(), {
      redirect: 'manual',
      signal,
      headers: { accept: 'image/*' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`图片重定向缺少 Location（${response.status}）`);
      url = assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
    const mediaType = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!mediaType.startsWith('image/')) throw new Error(`不是图片内容：${mediaType || 'unknown'}`);
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > maxBytes) throw new Error(`图片过大：${length} bytes`);
    const buffer = await readCapped(response, maxBytes);
    if (buffer.length === 0) throw new Error('图片内容为空');
    return { base64: buffer.toString('base64'), mediaType, bytes: buffer.length, url: url.toString() };
  }
  throw new Error('图片重定向次数过多');
}
