from pathlib import Path

# GestionCitas must own its React hook import instead of relying on a runtime global.
p = Path('components/GestionCitas.tsx')
s = p.read_text()
old = "import React, { useState, useEffect, useMemo } from 'react';"
new = "import React, { useState, useEffect, useMemo, useCallback } from 'react';"
if old in s:
    s = s.replace(old, new, 1)
if 'useCallback' not in s.splitlines()[0]:
    raise SystemExit('GestionCitas does not import useCallback')
p.write_text(s)

# Remove the entire temporary runtime global bridge. The app must compile using real imports/state only.
p = Path('index.tsx')
s = p.read_text()
start = s.find('// Puente de arranque temporal mientras se elimina el código legacy de sincronización.')
end_marker = "\n\nconst App = React.lazy(() => import('./App'));"
end = s.find(end_marker)
if start >= 0 and end >= 0:
    s = s[:start] + "const App = React.lazy(() => import('./App'));" + s[end + len(end_marker):]
elif 'Object.assign(globalThis as any' in s:
    raise SystemExit('bootstrap bridge present but markers were not found')
p.write_text(s)
