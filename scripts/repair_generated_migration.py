from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

header = ROOT / 'components/Header.tsx'
h = header.read_text()
h = re.sub(r"\n\s*\{\/\* Sincronizar con Firebase Firestore & Auth Button \*\/\}\n\s*</button>\n\s*\)\}", '', h, count=1)
header.write_text(h)

# Ensure no appointment/subcontractor business DB is recreated by legacy code.
for filename, patterns in {
    'components/SubcontratasSection.tsx': [r"localStorage\.getItem\(STORAGE_KEY\)", r"localStorage\.setItem\(STORAGE_KEY", r"localStorage\.getItem\('personasPROFEA'\)"],
    'components/GestionCitas.tsx': [r"localStorage\.getItem\('profea_latest_citas'\)", r"localStorage\.setItem\('profea_latest_citas'"],
}.items():
    text = (ROOT / filename).read_text()
    for pattern in patterns:
        if re.search(pattern, text):
            raise SystemExit(f'Legacy business storage remains in {filename}: {pattern}')

print('Generated migration output repaired.')
