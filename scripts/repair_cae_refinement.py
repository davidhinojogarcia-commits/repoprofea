from pathlib import Path

path = Path('scripts/apply_cae_refinement.py')
text = path.read_text()
old = '''    new_block = """    // Signature boxes: only explicitly configured signers are rendered.\\n'''
new = '''    new_block = """    // Signature boxes: only explicitly configured signers are rendered.\\n    const sigY = finalY + 7;\\n    doc.setDrawColor(203, 213, 225);\\n    doc.setLineWidth(0.4);\\n'''
if old not in text:
    raise SystemExit('signature block insertion point not found')
path.write_text(text.replace(old, new, 1))
print('CAE refinement migration repaired.')
