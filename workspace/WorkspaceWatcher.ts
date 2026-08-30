import * as fs from 'fs'
import * as path from 'path'

export type WatchEventType = 'change' | 'create' | 'delete'

export interface FileChangeEvent {
  type: WatchEventType
  filePath: string
  timestamp: number
}

type ChangeListener = (event: FileChangeEvent) => void

export class WorkspaceWatcher {
  private watchers: Map<string, fs.FSWatcher> = new Map()
  private listeners: ChangeListener[] = []
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private watchedDirs = new Set<string>()

  onChange(listener: ChangeListener): void {
    this.listeners.push(listener)
  }

  watchDirectory(dirPath: string): boolean {
    if (this.watchedDirs.has(dirPath)) return false
    this.watchedDirs.add(dirPath)

    if (!fs.existsSync(dirPath)) return false

    try {
      const watcher = fs.watch(dirPath, { recursive: false }, (eventType, filename) => {
        if (!filename) return
        const fullPath = path.join(dirPath, filename)
        const event: FileChangeEvent = {
          type: mapEventType(eventType),
          filePath: fullPath,
          timestamp: Date.now(),
        }
        this.debounceEmit(event)
      })
      this.watchers.set(dirPath, watcher)
      return true
    } catch {
      return false
    }
  }

  unwatchDirectory(dirPath: string): void {
    const watcher = this.watchers.get(dirPath)
    if (watcher) {
      watcher.close()
      this.watchers.delete(dirPath)
      this.watchedDirs.delete(dirPath)
    }
  }

  stopAll(): void {
    for (const [dir, watcher] of this.watchers) {
      watcher.close()
      this.watchedDirs.delete(dir)
    }
    this.watchers.clear()
  }

  private debounceEmit(event: FileChangeEvent): void {
    const key = event.filePath + event.type
    const existing = this.debounceTimers.get(key)
    if (existing) clearTimeout(existing)

    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key)
      for (const listener of this.listeners) {
        listener(event)
      }
    }, 300))
  }
}

function mapEventType(raw: string): WatchEventType {
  switch (raw) {
    case 'rename': return 'delete'
    case 'change': return 'change'
    default: return 'change'
  }
}
