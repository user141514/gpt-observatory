import type {
  GraphResponse,
  NowResponse,
  SearchResult,
  SupervisedTasksResponse,
  TimelineEvent,
} from './types'

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

export const api = {
  supervisedTasks: () => getJson<SupervisedTasksResponse>('/api/supervised-tasks'),
  syncWatchdog: () =>
    fetch('/api/watchdog/sync', { method: 'POST' }).then(async response => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return response.json() as Promise<SupervisedTasksResponse>
    }),
  now: () => getJson<NowResponse>('/api/now'),
  timeline: () => getJson<{ events: TimelineEvent[] }>('/api/timeline'),
  graph: () => getJson<GraphResponse>('/api/graph'),
  search: (query: string) =>
    getJson<{ query: string; results: SearchResult[] }>(
      `/api/search?q=${encodeURIComponent(query)}`,
    ),
}
