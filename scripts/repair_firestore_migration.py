from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'src/lib/firebase.ts'
s = path.read_text()


def replace_between(text: str, start_pattern: str, end_pattern: str, replacement: str) -> str:
    pattern = re.compile(start_pattern + r'.*?(?=' + end_pattern + r')', re.S)
    updated, count = pattern.subn(replacement + '\n\n', text, count=1)
    if count != 1:
        raise RuntimeError(f'Could not repair block: {start_pattern}')
    return updated

s = replace_between(
    s,
    r'export async function getOrCreateUserWorkspace',
    r'export async function addMemberToWorkspace',
    '''export async function getOrCreateUserWorkspace(user: { uid: string; email: string; displayName?: string | null; photoURL?: string | null }): Promise<Workspace> {
  const email = (user.email || '').trim().toLowerCase();
  const id = canonicalizeEmailKey(email);
  return {
    id,
    name: `Espacio de ${user.displayName || email.split('@')[0] || 'Usuario'}`,
    ownerEmail: email,
    ownerUid: user.uid,
    ownerName: user.displayName || email.split('@')[0] || 'Usuario',
    ownerPhoto: user.photoURL || '',
    sharedWith: [],
    sharedWithEmails: [email],
    accessCode: '',
    createdAt: new Date().toISOString(),
    lastSyncAt: new Date().toISOString()
  };
}'''
)

s = replace_between(
    s,
    r'export async function fetchWorkspaceData',
    r'export function subscribeToWorkspaceWorkers',
    '''export async function fetchWorkspaceData(_workspaceId: string): Promise<{
  workers: Person[];
  trash: DeletedPerson[];
  settings: UserAccountSettings | null;
  workspace: Workspace | null;
}> {
  const data = await fetchAccountData(auth.currentUser?.uid || '');
  return {
    ...data,
    workspace: auth.currentUser ? await getOrCreateUserWorkspace(auth.currentUser) : null
  };
}'''
)

s = replace_between(
    s,
    r'export async function fetchAccountData',
    r'export function subscribeToAccountWorkers',
    '''export async function fetchAccountData(userId: string): Promise<{
  workers: Person[];
  trash: DeletedPerson[];
  settings: UserAccountSettings | null;
}> {
  const uid = auth.currentUser?.uid || userId;
  if (!uid) return { workers: [], trash: [], settings: null };
  const workersSnap = await getDocs(collection(db, 'workers'));
  const workers = workersSnap.docs
    .filter(d => d.data().ownerId === uid)
    .map(d => d.data() as Person);
  const trashSnap = await getDocs(collection(db, 'trash'));
  const trash = trashSnap.docs
    .filter(d => d.data().ownerId === uid)
    .map(d => d.data() as DeletedPerson);
  return { workers, trash, settings: null };
}'''
)

path.write_text(s)
