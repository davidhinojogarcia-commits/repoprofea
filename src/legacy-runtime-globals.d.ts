export {};

declare global {
  const useCallback: typeof import('react').useCallback;
  const isOffline: boolean;
  const isSyncing: boolean;
  const groupId: string;
  const syncMode: string;
  const currentEffectiveWorkspaceId: string;
  const setIsOffline: (value: boolean) => void;
  const executeDatabaseSync: (...args: any[]) => Promise<void>;
  const handleSyncPendingToCloud: (...args: any[]) => Promise<void>;
  const handleGoogleLogin: (...args: any[]) => Promise<void>;
  const handleGoogleLogout: (...args: any[]) => Promise<void>;
}
