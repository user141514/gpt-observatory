import type {
  GraphResponse,
  NowResponse,
  PromptUpdateInput,
  SearchResult,
  SupervisedTasksResponse,
  TaskPromptState,
  TimelineEvent,
  WatchdogRegisterResult,
  WatchdogUnregisterResult,
} from './types'

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw await apiError(response)
  return response.json() as Promise<T>
}

async function apiError(response: Response): Promise<Error> {
  const text = await response.text()
  let detail = text
  try {
    const body = text ? JSON.parse(text) : null
    detail = body ? JSON.stringify(body) : response.statusText
  } catch {
    // Keep plain-text boundary details.
  }
  return new Error(`${response.status} ${response.statusText}: ${detail}`)
}

export const api = {
  supervisedTasks: () => getJson<SupervisedTasksResponse>('/api/supervised-tasks'),
  taskPrompt: (taskId: string) =>
    getJson<TaskPromptState>(
      `/api/supervised-tasks/${encodeURIComponent(taskId)}/prompt`,
    ),
  updateTaskPrompt: async (
    taskId: string,
    input: PromptUpdateInput,
  ): Promise<TaskPromptState> => {
    const response = await fetch(
      `/api/supervised-tasks/${encodeURIComponent(taskId)}/prompt`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    )
    if (!response.ok) throw await apiError(response)
    return response.json() as Promise<TaskPromptState>
  },
  syncWatchdog: () =>
    fetch('/api/watchdog/sync', { method: 'POST' }).then(async response => {
      if (!response.ok) throw await apiError(response)
      return response.json() as Promise<SupervisedTasksResponse>
    }),
  registerWatchdog: async (url: string): Promise<WatchdogRegisterResult> => {
    const response = await fetch('/api/watchdog/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    if (!response.ok) throw await apiError(response)
    return response.json() as Promise<WatchdogRegisterResult>
  },
  unregisterWatchdog: async (
    conversationId: string,
  ): Promise<WatchdogUnregisterResult> => {
    const response = await fetch('/api/watchdog/unregister', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    })
    if (!response.ok) throw await apiError(response)
    return response.json() as Promise<WatchdogUnregisterResult>
  },
  now: () => getJson<NowResponse>('/api/now'),
  timeline: () => getJson<{ events: TimelineEvent[] }>('/api/timeline'),
  graph: () => getJson<GraphResponse>('/api/graph'),
  search: (query: string) =>
    getJson<{ query: string; results: SearchResult[] }>(
      `/api/search?q=${encodeURIComponent(query)}`,
    ),
}
