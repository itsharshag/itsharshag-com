import { NotionAPI } from 'notion-client'

// Notion's API now answers 403 to non-browser user agents, and wraps every
// record as { spaceId, value: { role, value } }. Send a browser user agent and
// unwrap records to the { role, value } shape this notion-client expects.
const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

function unwrapRecords(res: any) {
  const recordMap = res?.recordMap
  if (recordMap) {
    for (const table of Object.values(recordMap)) {
      if (!table || typeof table !== 'object') continue
      for (const [id, record] of Object.entries(table as Record<string, any>)) {
        if (record?.value?.value && 'role' in record.value) {
          ;(table as Record<string, any>)[id] = record.value
        }
      }
    }
  }
  return res
}

// Builds prerender many pages at once and Notion rate limits them (429), so
// retry rate limits and server errors with backoff.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class BrowserNotionAPI extends NotionAPI {
  override async fetch<T>(opts: any): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await super.fetch<T>({
          ...opts,
          headers: { 'user-agent': userAgent, ...opts.headers }
        })
        return unwrapRecords(res)
      } catch (err: any) {
        const res = err?.response
        const status = res?.statusCode ?? res?.status
        if (attempt >= 9 || !(status === 429 || status >= 500)) throw err
        const header = res?.headers?.get?.('retry-after') ?? res?.headers?.['retry-after']
        const retryAfter = Number(header) * 1000 || 0
        await sleep(Math.min(60_000, Math.max(retryAfter, 1000 * 2 ** attempt)) + Math.random() * 1000)
      }
    }
  }
}

export const notion = new BrowserNotionAPI({
  apiBaseUrl: process.env.NOTION_API_BASE_URL
})
