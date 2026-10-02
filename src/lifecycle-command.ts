// Hold one lifecycle command through mutation, confirmation, and snapshot application.
// Sharing this gate across the whole App also preserves order when tabs change.
export function createLifecycleCommandGate() {
  let pending = false
  return {
    async run<T>(command: () => Promise<T>): Promise<T> {
      if (pending) {
        const error = new Error('另一项绑定/解绑操作正在确认，请等待完成。')
        error.name = 'LifecycleCommandPendingError'
        throw error
      }
      pending = true
      try {
        return await command()
      } finally {
        pending = false
      }
    },
  }
}
