/**
 * 审批 Remote 的客户端封装（PR-B）：四个冻结方法 + pending 轮询端点。
 * 只做 HTTP 与失败计数，不缓存策略、不另记审计。
 */
export const APPROVAL_BASE = '/dsh-approval'

/** 轮询是否该继续：页面隐藏停、连续失败到上限停。 */
export function shouldPoll({ visibility = 'visible', failures = 0, maxFailures = 3 } = {}) {
  return visibility !== 'hidden' && failures < maxFailures
}

/**
 * 造客户端。
 * @param {{ fetchImpl?: Function, base?: string, headers?: object }} [options] - 注入 fetch（测试用）与基址。
 * @returns {object} get/set/audit/decide/pending 五个方法。
 */
export function createApprovalClient({ fetchImpl, base = APPROVAL_BASE, headers = {} } = {}) {
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args))
  const request = async (path, init) => {
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...headers, ...(init?.headers ?? {}) },
    })
    if (response.ok !== true) throw new Error(`approval ${path}: HTTP ${response.status}`)
    return response.json()
  }
  return {
    get: () => request('/policy'),
    set: (patch, ifVersion) => request('/policy', { method: 'POST', body: JSON.stringify({ patch, ifVersion }) }),
    audit: (query = {}) => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value))
      const suffix = params.toString()
      return request(`/audit${suffix === '' ? '' : `?${suffix}`}`)
    },
    decide: (requestId, choice) => request('/decide', { method: 'POST', body: JSON.stringify({ requestId, choice }) }),
    pending: () => request('/pending'),
  }
}
