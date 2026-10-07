/* ============================================================================
 * OpenCode Go quota — Client half
 *
 * Registers one entry into `sidebar.footer.action`: the row the sidebar shell
 * renders directly under the workspace/session browsing region and directly
 * above the Settings row. That row is `display:flex` and already holds the
 * plugin-manager icon, so this widget keeps to a single 42px cell and moves
 * every detail into a fixed-position popover instead of growing the footer.
 *
 *   wide sidebar   →  [ring] OpenCode Go ············· 本月 18%
 *   collapsed rail →  a 36px button carrying the percent
 *   hover / click  →  popover with one row per window: a 6px usage bar, a
 *                     marker for how much of the window has already elapsed,
 *                     the remaining share and a reset countdown
 *
 * Data comes from this package's own Host half over
 * `GET /api/opencode-go-quota`; the API key stays in the Host process.
 * ========================================================================== */

window.__ModuleLoader__.load({
  id: 'dsh-opencode-go-quota',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Same-origin route served by this package's Host half. */
    const ROUTE = '/api/opencode-go-quota'
    /** Background refresh interval. Kept short because the upstream endpoint
     *  answers `cache-control: no-store` and the number moves as you work. */
    const REFRESH_MS = 60 * 1000
    /** Popover geometry and hover timing. */
    const CARD_WIDTH = 320
    const HOVER_OPEN_MS = 160
    const HOVER_CLOSE_MS = 220

    /**
     * The three Go windows, in display order. `periodMs` is the length of the
     * window itself and drives the elapsed-time marker; `null` means "derive
     * it from the reset instant" — the monthly window is a billing cycle whose
     * start is not on the wire, so it is estimated and labelled as such.
     */
    const WINDOWS = [
      { key: 'rolling', label: '5 小时窗口', short: '5小时', periodMs: 5 * 60 * 60 * 1000 },
      { key: 'weekly', label: '本周', short: '本周', periodMs: 7 * 24 * 60 * 60 * 1000 },
      { key: 'monthly', label: '本月', short: '本月', periodMs: null },
    ]

    const CSS = `
.ogq-cell{flex:none;align-items:center;width:100%;min-width:0;height:42px;margin:6px 0 0;display:flex;position:relative}
.ogq-cell.rail{width:36px;height:36px;margin:0}
.ogq-btn{align-items:center;width:100%;min-width:0;height:42px;gap:8px;margin:0 -2px;padding:0 10px 0 8px;border:none;border-radius:12px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;cursor:pointer;display:inline-flex;overflow:hidden;user-select:none}
.ogq-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ogq-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.ogq-cell.rail .ogq-btn{width:36px;height:36px;border-radius:50%;justify-content:center;gap:0;padding:0}
.ogq-label{flex:1;min-width:0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ogq-badge{flex:none;margin-left:auto;font-size:12px;line-height:16px;font-weight:500;font-variant-numeric:tabular-nums;white-space:nowrap}
.ogq-railnum{font-size:11px;line-height:14px;font-weight:700;font-variant-numeric:tabular-nums}
.ogq-card{position:fixed;z-index:40;box-sizing:border-box;width:${CARD_WIDTH}px;max-width:calc(100vw - 24px);max-height:min(70vh,440px);overflow:auto;padding:0 0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 10px 32px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary)}
.ogq-head{position:sticky;top:0;display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--dsw-alias-bg-overlay)}
.ogq-title{font-size:14px;line-height:20px;font-weight:500}
.ogq-updated{margin-left:auto;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.ogq-refresh{flex:none;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer}
.ogq-refresh:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ogq-rows{display:flex;flex-direction:column;gap:12px;padding:2px 12px 0}
.ogq-row{display:flex;flex-direction:column;gap:4px}
.ogq-rowhead{display:flex;align-items:baseline;gap:8px;font-size:13px;line-height:20px}
.ogq-used{margin-left:auto;font-weight:500;font-variant-numeric:tabular-nums}
.ogq-track{position:relative;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.ogq-fill{display:block;height:100%;border-radius:3px;transition:width .3s ease}
.ogq-marker{position:absolute;top:0;bottom:0;width:2px;border-radius:1px;background:var(--dsw-alias-label-secondary);opacity:.8;transform:translateX(-1px)}
.ogq-meta{display:flex;align-items:baseline;gap:10px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.ogq-meta .ogq-reset{margin-left:auto;font-variant-numeric:tabular-nums;white-space:nowrap}
.ogq-msg{padding:0 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.ogq-note{padding:8px 12px 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
`

    /** Bar colour for one usage percentage. */
    function toneOf(percent) {
      if (typeof percent !== 'number') return 'var(--dsw-alias-state-idle-primary)'
      if (percent >= 90) return 'var(--dsw-alias-state-error-primary)'
      if (percent >= 70) return 'var(--dsw-alias-state-warn-primary)'
      return 'var(--dsw-alias-state-business-primary)'
    }

    const clampPercent = (value) => Math.max(0, Math.min(100, value))

    /** "2 小时 12 分钟后重置" — easier to act on than an absolute instant. */
    function resetCountdown(iso) {
      if (typeof iso !== 'string') return ''
      const at = Date.parse(iso)
      if (Number.isNaN(at)) return ''
      const minutes = Math.round((at - Date.now()) / 60000)
      if (minutes <= 0) return '即将重置'
      if (minutes < 60) return `${minutes} 分钟后重置`
      const hours = Math.floor(minutes / 60)
      if (hours < 48) return `${hours} 小时 ${minutes % 60} 分钟后重置`
      return `${Math.round(hours / 24)} 天后重置`
    }

    /** Absolute reset instant in the viewer's own zone. */
    function resetAbsolute(iso) {
      if (typeof iso !== 'string') return ''
      const at = Date.parse(iso)
      if (Number.isNaN(at)) return ''
      return new Date(at).toLocaleString('zh-CN', {
        month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      })
    }

    /** Length of the calendar month preceding `end` (day-of-month clamped). */
    function monthBefore(end) {
      const from = new Date(end)
      const prev = new Date(end)
      prev.setDate(1)
      prev.setMonth(prev.getMonth() - 1)
      const lastDay = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate()
      prev.setDate(Math.min(from.getDate(), lastDay))
      return from.getTime() - prev.getTime()
    }

    /**
     * How much of the window has already elapsed, 0..1, or null when the
     * window's start cannot be established.
     * @returns {{ratio: number, estimated: boolean}|null}
     */
    function elapsedOf(row) {
      if (typeof row.resetsAt !== 'string') return null
      const end = Date.parse(row.resetsAt)
      if (Number.isNaN(end)) return null
      const estimated = row.periodMs === null
      const period = estimated ? monthBefore(end) : row.periodMs
      if (!(period > 0)) return null
      const start = end - period
      const now = Date.now()
      return { ratio: now <= start ? 0 : now >= end ? 1 : (now - start) / period, estimated }
    }

    /** The small gauge: a ring whose arc is the number it labels. */
    function ringIcon(percent) {
      const used = typeof percent === 'number' ? clampPercent(percent) : 0
      return h('svg', {
        viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none',
        'aria-hidden': true, style: { flex: 'none' },
      },
      h('circle', {
        cx: 12, cy: 12, r: 8, stroke: 'currentColor', strokeOpacity: 0.28, strokeWidth: 2.6,
      }),
      h('circle', {
        cx: 12, cy: 12, r: 8, stroke: toneOf(percent), strokeWidth: 2.6, strokeLinecap: 'round',
        pathLength: 100, strokeDasharray: `${used} 100`, transform: 'rotate(-90 12 12)',
      }))
    }

    /** One window's block inside the popover. */
    function WindowRow(props) {
      const row = props.row
      const hasUsage = typeof row.percent === 'number'
      const elapsed = elapsedOf(row)
      const countdown = resetCountdown(row.resetsAt)
      const absolute = resetAbsolute(row.resetsAt)
      const resetTitle = absolute === '' ? countdown : `${countdown}（${absolute}）`
      return h('div', { className: 'ogq-row' },
        h('div', { className: 'ogq-rowhead' },
          h('span', null, row.label),
          h('span', {
            className: 'ogq-used',
            style: { color: hasUsage ? toneOf(row.percent) : undefined },
          }, hasUsage ? `已用 ${row.percent}%` : '暂无数据')),
        h('div', { className: 'ogq-track' },
          h('i', {
            className: 'ogq-fill',
            style: { width: `${hasUsage ? clampPercent(row.percent) : 0}%`, background: toneOf(row.percent) },
          }),
          elapsed === null ? null : h('i', {
            className: 'ogq-marker',
            style: { left: `${elapsed.ratio * 100}%` },
            title: '时间进度',
          })),
        h('div', { className: 'ogq-meta' },
          h('span', null, hasUsage ? `剩余 ${100 - row.percent}%` : '—'),
          elapsed === null ? null : h('span', null,
            `${elapsed.estimated ? '≈' : ''}时间已过 ${Math.round(elapsed.ratio * 100)}%`),
          h('span', { className: 'ogq-reset', title: resetTitle }, countdown)),
      )
    }

    /**
     * The sidebar-foot cell. `wide` is the owner's column state: false means
     * the 56px rail, where only a 36px control fits.
     */
    function OpenCodeGoQuota(props) {
      const wide = props.wide !== false
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [rect, setRect] = React.useState(null)
      const buttonRef = React.useRef(null)
      const cardRef = React.useRef(null)
      const alive = React.useRef(true)
      const inflight = React.useRef(null)
      const openTimer = React.useRef(null)
      const closeTimer = React.useRef(null)

      const load = React.useCallback((force) => {
        if (inflight.current !== null) inflight.current.abort()
        const controller = new AbortController()
        inflight.current = controller
        fetch(ROUTE + (force === true ? '?refresh=1' : ''), {
          signal: controller.signal,
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })
          .then((response) => response.json())
          .then((payload) => {
            if (alive.current !== true) return
            inflight.current = null
            if (payload !== null && typeof payload === 'object' && payload.ok === true) {
              setData(payload)
              setError(null)
            } else {
              setError(payload !== null && typeof payload === 'object' && typeof payload.error === 'string'
                ? payload.error
                : '额度接口返回异常')
            }
          })
          .catch((cause) => {
            if (alive.current !== true || (cause !== null && cause.name === 'AbortError')) return
            inflight.current = null
            setError(cause !== null && typeof cause.message === 'string' ? cause.message : '额度请求失败')
          })
      }, [])

      React.useEffect(() => {
        alive.current = true
        load(false)
        const timer = setInterval(() => load(false), REFRESH_MS)
        return () => {
          alive.current = false
          clearInterval(timer)
          if (inflight.current !== null) inflight.current.abort()
        }
      }, [load])

      const clearTimers = () => {
        if (openTimer.current !== null) { clearTimeout(openTimer.current); openTimer.current = null }
        if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null }
      }
      const openCard = () => {
        clearTimers()
        const node = buttonRef.current
        if (node === null || typeof node.getBoundingClientRect !== 'function') return
        setRect(node.getBoundingClientRect())
        setOpen(true)
      }
      const scheduleOpen = () => {
        clearTimers()
        openTimer.current = setTimeout(openCard, HOVER_OPEN_MS)
      }
      const scheduleClose = () => {
        clearTimers()
        closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS)
      }
      const cancelClose = () => clearTimers()

      // Outside click, Escape, and viewport changes close the popover.
      React.useEffect(() => {
        if (!open) return undefined
        const doc = typeof document === 'undefined' ? null : document
        if (doc === null) return undefined
        const onPointerDown = (event) => {
          const target = event.target
          if (target instanceof Node) {
            const button = buttonRef.current
            if (button !== null && button.contains(target)) return
            const card = cardRef.current
            if (card !== null && card.contains(target)) return
          }
          setOpen(false)
        }
        const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false) }
        doc.addEventListener('pointerdown', onPointerDown)
        doc.addEventListener('keydown', onKeyDown)
        const onResize = () => setOpen(false)
        window.addEventListener('resize', onResize)
        return () => {
          doc.removeEventListener('pointerdown', onPointerDown)
          doc.removeEventListener('keydown', onKeyDown)
          window.removeEventListener('resize', onResize)
        }
      }, [open])

      // Timers die with the component.
      React.useEffect(() => () => clearTimers(), [])

      const raw = data !== null && Array.isArray(data.windows) ? data.windows : []
      const rows = WINDOWS.map((window) => {
        const found = raw.find((entry) => entry !== null && typeof entry === 'object' && entry.key === window.key)
        return {
          key: window.key,
          label: window.label,
          short: window.short,
          periodMs: window.periodMs,
          percent: found !== undefined && typeof found.percent === 'number' ? found.percent : null,
          resetsAt: found !== undefined && typeof found.resetsAt === 'string' ? found.resetsAt : null,
        }
      })
      const lead = rows.reduce(
        (acc, row) => (row.percent !== null && (acc === null || row.percent > acc.percent) ? row : acc),
        null,
      )
      const tone = error !== null ? 'var(--dsw-alias-state-error-primary)' : toneOf(lead === null ? null : lead.percent)
      const badge = error !== null
        ? '获取失败'
        : lead === null
          ? (data === null ? '读取中…' : '--')
          : `${lead.short} ${lead.percent}%`
      const updatedAt = data !== null && typeof data.fetchedAt === 'number' ? data.fetchedAt : null
      const updatedText = updatedAt === null
        ? ''
        : `更新 ${new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
      const ariaLabel = rows.every((row) => row.percent === null)
        ? `OpenCode Go 额度：${badge}`
        : `OpenCode Go 额度：${rows.filter((row) => row.percent !== null).map((row) => `${row.label} 已用 ${row.percent}%`).join('，')}`

      const cardStyle = rect === null ? {} : {
        left: `${Math.max(8, Math.min(rect.left, (window.innerWidth || 1024) - CARD_WIDTH - 8))}px`,
        bottom: `${Math.max(8, (window.innerHeight || 768) - rect.top + 8)}px`,
      }
      const card = !open || rect === null ? null : h('div', {
        ref: cardRef,
        className: 'ogq-card',
        role: 'dialog',
        'aria-label': 'OpenCode Go 额度',
        style: cardStyle,
        onMouseEnter: cancelClose,
        onMouseLeave: scheduleClose,
      },
      h('div', { className: 'ogq-head' },
        h('span', { className: 'ogq-title' }, 'OpenCode Go 额度'),
        h('span', { className: 'ogq-updated' }, updatedText),
        h('button', {
          type: 'button', className: 'ogq-refresh', title: '立即刷新', 'aria-label': '立即刷新',
          onClick: () => load(true),
        }, '刷新')),
      error === null ? null : h('div', { className: 'ogq-msg' }, error),
      h('div', { className: 'ogq-rows' }, rows.map((row) => h(WindowRow, { key: row.key, row }))),
      h('div', { className: 'ogq-note' }, '数据来自 OpenCode 官方用量接口，全账号口径（含其他机器）。'))

      return h(React.Fragment, null,
        h('style', { key: 'ogq-css' }, CSS),
        h('div', {
          key: 'ogq-cell',
          className: wide ? 'ogq-cell' : 'ogq-cell rail',
          onMouseEnter: wide ? scheduleOpen : undefined,
          onMouseLeave: wide ? scheduleClose : undefined,
        },
        h('button', {
          ref: buttonRef,
          type: 'button',
          className: 'ogq-btn',
          onClick: () => (open ? setOpen(false) : openCard()),
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': ariaLabel,
          title: wide ? undefined : ariaLabel,
        },
        wide ? ringIcon(lead === null ? null : lead.percent) : null,
        wide ? h('span', { className: 'ogq-label' }, 'OpenCode Go') : null,
        wide
          ? h('span', { className: 'ogq-badge', style: { color: tone } }, badge)
          : h('span', { className: 'ogq-railnum', style: { color: tone } }, lead === null ? '--' : `${lead.percent}%`),
        )),
        card,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'opencode-go-quota',
          order: 20,
          label: 'OpenCode Go 额度',
        }, OpenCodeGoQuota))
      },
    }
  },
})
