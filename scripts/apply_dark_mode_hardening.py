from pathlib import Path

index_path = Path('index.tsx')
text = index_path.read_text()
needle = "import './institutional-polish.css';"
addition = "import './dark-mode-hardening.css';"
if addition not in text:
    if needle not in text:
        raise SystemExit('institutional-polish import not found')
    text = text.replace(needle, needle + '\n' + addition, 1)
    index_path.write_text(text)

# Static audit: report recurring legacy light-only utility usage. These are covered by
# dark-mode-hardening.css, but keeping the count visible in CI helps prevent regressions.
patterns = {
    'bg-white': 0,
    'bg-slate-50': 0,
    'bg-gray-50': 0,
    'text-slate-900': 0,
    'text-gray-900': 0,
    'border-slate-200': 0,
}
for path in list(Path('components').rglob('*.tsx')) + [Path('App.tsx')]:
    if not path.exists():
        continue
    content = path.read_text(errors='ignore')
    for key in patterns:
        patterns[key] += content.count(key)
print('Dark mode compatibility audit:', patterns)
