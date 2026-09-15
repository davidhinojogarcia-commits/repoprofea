from pathlib import Path
import subprocess

p = Path('components/RegistrationForm.tsx')
text = p.read_text(encoding='utf-8')
old = 'También puedes capturarlos desde Cámara escáner → Seguridad Social / IBAN.'
new = 'También puedes capturarlos desde Escáner → Seguridad Social / IBAN.'
if old not in text:
    raise SystemExit('Expected scanner wording not found')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
subprocess.run(['git', 'add', 'components/RegistrationForm.tsx'], check=True)
