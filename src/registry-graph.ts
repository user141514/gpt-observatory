import type { GraphResponse, SupervisedTasksResponse } from './types.js'

// Registry membership is independent of a secondary factual graph refresh.
// Filter only Watchdog-owned topology; retain unrelated canonical entities.
export function projectRegistryGraph(
  graph: GraphResponse,
  lastSuccessfulRegistry: SupervisedTasksResponse | undefined,
): GraphResponse {
  if (!lastSuccessfulRegistry?.integration.available) return graph
  const tasks = new Set(lastSuccessfulRegistry.tasks.map(task => task.stableKey))
  const conversations = new Set(lastSuccessfulRegistry.tasks.map(
    task => task.currentConversation.stableKey,
  ))
  const nodes = graph.nodes.filter(node => {
    const watchdogTask = node.type === 'supervised_task'
      || (node.type === 'task' && Object.hasOwn(node.facts, 'watchdog_registered'))
    const watchdogConversation = node.type === 'conversation'
      && Object.hasOwn(node.facts, 'watchdog_bound')
    if (watchdogTask) return tasks.has(node.stableKey)
    if (watchdogConversation) return conversations.has(node.stableKey)
    return true
  })
  const visibleIds = new Set(nodes.map(node => node.id))
  return {
    nodes,
    edges: graph.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
  }
}
