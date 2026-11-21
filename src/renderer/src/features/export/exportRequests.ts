/** Lets commands (Ctrl+E) open the export dialog owned by the editor screen. */
const listeners = new Set<() => void>()

export const exportRequests = {
  open() {
    for (const l of listeners) l()
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }
}
