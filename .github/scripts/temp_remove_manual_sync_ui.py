from pathlib import Path

# Header: remove connection/sync presentation entirely.
p = Path('components/Header.tsx')
s = p.read_text()
s = s.replace("import { Menu, Sun, Moon, Cloud, CloudOff, Undo2, Redo2, Bell } from 'lucide-react';", "import { Menu, Sun, Moon, Undo2, Redo2, Bell } from 'lucide-react';")
s = s.replace("  isOffline?: boolean;\n  pendingSyncCount?: number;\n", "")
s = s.replace("export const Header: React.FC<HeaderProps> = ({ onMenuClick, theme, onThemeToggle, isOffline = false, pendingSyncCount = 0, onUndo, onRedo, canUndo = false, canRedo = false, onOpenNotificationManager, alertsCount = 0 }) => (", "export const Header: React.FC<HeaderProps> = ({ onMenuClick, theme, onThemeToggle, onUndo, onRedo, canUndo = false, canRedo = false, onOpenNotificationManager, alertsCount = 0 }) => (")
start = s.find("        {isOffline ? <div className=\"flex items-center gap-1.5 px-3 py-1.5")
if start != -1:
    end_marker = "        {onOpenNotificationManager &&"
    end = s.find(end_marker, start)
    if end == -1:
        raise SystemExit('Header notification marker not found')
    s = s[:start] + s[end:]
p.write_text(s)

# Person list: remove legacy per-worker sync props. Google Drive remains independent.
p = Path('components/PersonList.tsx')
s = p.read_text()
s = s.replace("  isSyncActive?: boolean;\n  onToggleSync?: (id: number) => void;\n", "")
s = s.replace("  isSyncActive = false,\n  onToggleSync,\n", "")
s = s.replace("                    isSyncActive={isSyncActive}\n                    onToggleSync={onToggleSync}\n", "")
s = s.replace("              isSyncActive={isSyncActive}\n              onToggleSync={onToggleSync}\n", "")
p.write_text(s)

# App: stop exposing any manual/offline synchronization UX.
p = Path('App.tsx')
s = p.read_text()
s = s.replace("import { CheckCircle, AlertTriangle, Cloud, CloudOff, RefreshCw } from 'lucide-react';", "import { CheckCircle, AlertTriangle, Cloud, RefreshCw } from 'lucide-react';")
s = s.replace("            isOffline={isOffline}\n            pendingSyncCount={isSyncing && groupId.trim() ? people.filter(p => !p.sincronizadoEnNube).length : 0}\n", "")
s = s.replace("                    isSyncActive={isSyncing}\n                    onToggleSync={handleTogglePersonSync}\n", "")
s = s.replace("                  isSyncActive={isSyncing}\n                  onToggleSync={handleTogglePersonSync}\n", "")
start_marker = "          {/* Offline Banner and Sync Queue Visualizer */}"
end_marker = "          {activeView === 'dashboard' && ("
start = s.find(start_marker)
if start != -1:
    end = s.find(end_marker, start)
    if end == -1:
        raise SystemExit('App dashboard marker not found')
    s = s[:start] + end_marker + s[end + len(end_marker):]
p.write_text(s)
