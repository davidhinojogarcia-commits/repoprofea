from pathlib import Path

p = Path('components/CameraScannerModal.tsx')
text = p.read_text()
old = """      window.dispatchEvent(new CustomEvent('profea:administrative-data-recognized', {
        detail: {
          dni: detected.dni,
          birthDate: detected.birthDate,
          nuss: detected.nuss,
          iban: detected.iban,
          documentText: detected.text,
        },
      }));
      onToast(`Datos reconocidos en ${elapsed} s e incorporados al registro en curso.`, 'success');
      handleClose();"""
new = """      const accepted: { dni?: string; birthDate?: string; nuss?: string; iban?: string; documentText?: string } = {
        documentText: detected.text,
      };

      if (detected.dni && window.confirm(`DNI/NIE detectado:\n\n${detected.dni}\n\n¿Incorporar este dato al trabajador en curso?`)) {
        accepted.dni = detected.dni;
      }
      if (detected.birthDate && window.confirm(`Fecha de nacimiento detectada:\n\n${detected.birthDate.split('-').reverse().join('/')}\n\n¿Incorporar este dato al trabajador en curso?`)) {
        accepted.birthDate = detected.birthDate;
      }
      if (detected.nuss && window.confirm(`Nº de Seguridad Social detectado:\n\n${formatSpanishSocialSecurityNumber(detected.nuss)}\n\n¿Incorporar este dato al trabajador en curso?`)) {
        accepted.nuss = detected.nuss;
      }
      if (detected.iban && window.confirm(`IBAN / Cuenta bancaria detectado:\n\n${formatIban(detected.iban)}\n\n¿Incorporar este dato al trabajador en curso?`)) {
        accepted.iban = detected.iban;
      }

      const acceptedCount = [accepted.dni, accepted.birthDate, accepted.nuss, accepted.iban].filter(Boolean).length;
      if (!acceptedCount) {
        onToast('Datos reconocidos, pero no se ha aceptado incorporar ninguno. Puedes revisar o repetir el escaneo.', 'error');
        return;
      }

      window.dispatchEvent(new CustomEvent('profea:administrative-data-recognized', {
        detail: accepted,
      }));
      onToast(`${acceptedCount} dato(s) aceptado(s) e incorporado(s) al registro en curso.`, 'success');
      handleClose();"""
if old not in text:
    raise SystemExit('scanner dispatch block not found')
text = text.replace(old, new, 1)
p.write_text(text)
