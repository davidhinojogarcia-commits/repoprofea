export function workerQrAptitude(value?: string): 'Apto' | 'Apto con limitación' | undefined {
  switch (value) {
    case 'Apto': return 'Apto';
    case 'Apto con limitación':
    case 'Apto con limitaciones': return 'Apto con limitación';
    default: return undefined;
  }
}
