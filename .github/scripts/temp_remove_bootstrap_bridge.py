from pathlib import Path

# GestionCitas used React.useCallback through a temporary global bridge. Import it explicitly.
p = Path('components/GestionCitas.tsx')
s = p.read_text()
old = "import React, { useState, useEffect, useMemo } from 'react';"
new = "import React, { useState, useEffect, useMemo, useCallback } from 'react';"
if old not in s:
    raise SystemExit('GestionCitas React import not found')
p.write_text(s.replace(old, new, 1))

# Remove the entire temporary runtime global bridge. The app must now compile using real imports/state only.
p = Path('index.tsx')
s = p.read_text()
start = s.find('// Puente de arranque temporal mientras se elimina el código legacy de sincronización.')
end_marker = "\n\nconst App = React.lazy(() => import('./App'));"
end = s.find(end_marker)
if start < 0 or end < 0:
    raise SystemExit('bootstrap bridge not found')
s = s[:start] + "const App = React.lazy(() => import('./App'));" + s[end + len(end_marker):]
p.write_text(s)
