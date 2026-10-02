// A confirmed mutation starts a new refresh generation before applying its snapshot.
// Responses, facts, and errors from older requests must not replace that evidence.
export function createRegistryRefreshGate() {
  let generation = 0
  return {
    begin(): () => boolean {
      const requestGeneration = ++generation
      return () => requestGeneration === generation
    },
  }
}
