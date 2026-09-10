from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

checks = {
    'App.tsx': [
        ('manual sync module imports', r"^import .*?(?:FirebaseSyncModal|DatabaseSyncAlert|syncNotifier).*?;$"),
        ('manual sync header props', r"onOpenFirebaseSync\s*=|isSyncingFirebase\s*=|firebaseWorkersCount\s*=|\bonOpenFirebaseSync\b.*(?:Header|<Header)"),
    ],
    'components/Header.tsx': [
        ('manual sync props', r"onOpenFirebaseSync|isSyncingFirebase|firebaseWorkersCount"),
        ('dangling sync button JSX', r"\{onOpenFirebaseSync &&|id=\"btn-sync-firebase-firestore\""),
    ],
    'components/SubcontratasSection.tsx': [
        ('business localStorage database', r"localStorage\.getItem\(STORAGE_KEY\)|localStorage\.setItem\(STORAGE_KEY|localStorage\.getItem\('personasPROFEA'\)"),
    ],
    'components/GestionCitas.tsx': [
        ('appointment localStorage database', r"localStorage\.getItem\('profea_latest_citas'\)|localStorage\.setItem\('profea_latest_citas'"),
    ],
}

errors = []
for filename, patterns in checks.items():
    text = (ROOT / filename).read_text()
    for label, pattern in patterns:
        if re.search(pattern, text, re.M):
            errors.append(f'{filename}: {label}')

if errors:
    raise SystemExit('Migration output validation failed:\n- ' + '\n- '.join(errors))

print('Firestore migration output validation passed.')
