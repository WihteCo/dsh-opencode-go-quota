/* ============================================================================
 * OpenCode Go quota — Host half
 *
 * Serves one same-origin JSON route for the browser half:
 *
 *   GET /api/opencode-go-quota[?refresh=1]
 *
 * It reads the live OpenCode Go subscription quota from the official usage
 * endpoint (https://opencode.ai/zen/go/v1/usage) with the credential the
 * `opencode-go` provider already uses, so the widget never needs its own key
 * and the key never reaches the browser.
 *
 * Response shapes:
 *   { ok: true,  fetchedAt: number, windows: [{ key, label, percent, status, resetsAt }] }
 *   { ok: false, error: string, code?: string, detail?: string }
 *
 * The route follows the Web carrier's lifetime through `ctx.effect`, and the
 * upstream answer is cached briefly so a page reload does not hammer it.
 * ========================================================================== */

/** Credential (POSIX-style environment-variable name) holding the API key. */
const CREDENTIAL_REF = 'OPENCODE_GO_API_KEY'
/** Official OpenCode Go usage endpoint (note: the trailing-slash form 401s). */
const USAGE_ENDPOINT = 'https://opencode.ai/zen/go/v1/usage'
/** Same-origin route the Client half fetches. */
const ROUTE_PATH = '/api/opencode-go-quota'
/** Window order and display labels, mirrored by the Client half. */
const WINDOWS = [
  { key: 'rolling', label: '5小时' },
  { key: 'weekly', label: '每周' },
  { key: 'monthly', label: '每月' },
]
/** How long one upstream answer is reused before the next request re-reads it. */
const CACHE_MS = 30_000
/** Upstream request budget. */
const REQUEST_TIMEOUT_MS = 12_000

/** Write one JSON response. */
function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/**
 * Refuse a cross-site caller while still allowing every same-origin mount
 * (loopback, LAN, or the mobile gateway): the browser sends `sec-fetch-site`
 * on fetch, and when it sends `Origin` it must name this exact host.
 */
function isSameOriginRequest(req) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return false
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  return true
}

/** Error text safe to hand back to the widget. */
function messageOf(error) {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'object' && typeof error.message === 'string') return error.message
  return String(error)
}

/**
 * Read the OpenCode Go quota.
 * @param ctx - the Host context the route is registered on.
 * @param force - bypass the short-lived cache (the widget's manual refresh).
 * @returns the wire payload, never throwing.
 */
async function readQuota(ctx, force) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    return { ok: false, error: '运行时缺少 credentials 服务', code: 'no-credentials-service' }
  }
  let credential
  try {
    credential = await credentials.resolve(CREDENTIAL_REF)
  } catch (error) {
    return { ok: false, error: `读取凭据失败：${messageOf(error)}`, code: 'credential-error' }
  }
  if (credential === undefined || typeof credential.value !== 'string' || credential.value === '') {
    return {
      ok: false,
      error: `凭据 ${CREDENTIAL_REF} 未配置，请先在设置里填入 OpenCode Go 的 API Key`,
      code: 'credential-missing',
    }
  }

  let response
  try {
    response = await fetch(USAGE_ENDPOINT, {
      headers: {
        authorization: `Bearer ${credential.value}`,
        accept: 'application/json',
        'x-opencode-client': 'cli',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    return { ok: false, error: `请求额度接口失败：${messageOf(error)}`, code: 'network' }
  }

  const text = await response.text().catch(() => '')
  if (!response.ok) {
    return {
      ok: false,
      error: response.status === 401
        ? `额度接口返回 401，${CREDENTIAL_REF} 可能已失效`
        : `额度接口返回 HTTP ${response.status}`,
      code: `http-${response.status}`,
      detail: text.slice(0, 200),
    }
  }

  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    return { ok: false, error: '额度接口返回了无法解析的内容', code: 'parse' }
  }
  const usage = payload !== null && typeof payload === 'object' ? payload.usage : undefined
  if (usage === null || typeof usage !== 'object') {
    return { ok: false, error: '额度接口返回结构异常（缺少 usage）', code: 'shape' }
  }

  const windows = WINDOWS.map((window) => {
    const raw = usage[window.key]
    if (raw === null || typeof raw !== 'object') {
      return { key: window.key, label: window.label, percent: null, status: 'missing', resetsAt: null }
    }
    return {
      key: window.key,
      label: window.label,
      percent: typeof raw.percent === 'number' ? raw.percent : null,
      status: typeof raw.status === 'string' ? raw.status : 'unknown',
      resetsAt: typeof raw.resetsAt === 'string' ? raw.resetsAt : null,
    }
  })
  return { ok: true, fetchedAt: Date.now(), windows }
}

/**
 * Mount the Host half.
 * @param ctx - Host context owning the Web carrier.
 */
export function apply(ctx) {
  /** Last successful answer, reused for {@link CACHE_MS}. */
  let cache = null

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      if (!isSameOriginRequest(req)) {
        json(res, 403, { ok: false, error: 'cross-site-request-rejected' })
        return
      }
      let force = false
      try {
        force = new URL(req.url ?? ROUTE_PATH, 'http://localhost').searchParams.get('refresh') === '1'
      } catch {
        force = false
      }
      if (!force && cache !== null && Date.now() - cache.at < CACHE_MS) {
        json(res, 200, cache.value)
        return
      }
      const value = await readQuota(ctx, force)
      if (value.ok === true) cache = { at: Date.now(), value }
      json(res, 200, value)
    },
  }), 'opencode-go-quota: usage route')
}

/** The Host half needs the Web carrier; `credentials` is resolved lazily so a
 *  missing credential still renders a widget that explains itself. */
export const inject = ['webServer']
