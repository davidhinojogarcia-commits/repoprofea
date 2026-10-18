type WorkResource = { recursoPreventivoNombre?: string; recursoPreventivoCategoria?: string; recursoPreventivoTelefono?: string };
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const workKey = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('es');

export function visitForemanProfile(work: { nombre?: string }, resources: Record<string, WorkResource> = {}) {
  const key = workKey(clean(work.nombre));
  if (!key) return null;
  const matches = Object.entries(resources).filter(([name]) => workKey(name) === key);
  if (matches.length !== 1) return null;
  const resource = matches[0][1];
  const name = clean(resource?.recursoPreventivoNombre);
  return name ? { nombreApellidos: name, cargo: clean(resource.recursoPreventivoCategoria) || 'Encargado de obra', telefono: clean(resource.recursoPreventivoTelefono), email: '' } : null;
}
