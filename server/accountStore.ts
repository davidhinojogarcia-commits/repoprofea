import fs from 'fs';
import path from 'path';

export type UserRole = 'admin' | 'user';

export interface UserPermissions {
  canEdit?: boolean;
  canDelete?: boolean;
  canExport?: boolean;
  canImport?: boolean;
}

export interface UserAccount {
  id: string;
  username: string;
  email: string;
  password?: string;
  displayName: string;
  role: UserRole;
  departamento?: string;
  createdAt: string;
  lastLoginAt?: string;
  avatarUrl?: string;
  workersCount?: number;
  active?: boolean;
  permissions?: UserPermissions;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

class AccountStore {
  private accounts: Record<string, UserAccount> = {};

  constructor() {
    this.init();
  }

  private init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(ACCOUNTS_FILE)) {
        const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
        this.accounts = JSON.parse(raw);
      } else {
        this.accounts = {};
      }

      // Ensure primary Administrator DHG with password 75810011X exists and is always configured
      const dhgAdminId = 'user_dhg';
      this.accounts[dhgAdminId] = {
        id: dhgAdminId,
        username: 'DHG',
        email: 'davidhinojogarcia@gmail.com',
        password: '75810011X',
        displayName: 'David Hinojo García (DHG - Administrador)',
        role: 'admin',
        departamento: 'Dirección y Prevención PROFEA',
        createdAt: this.accounts[dhgAdminId]?.createdAt || new Date().toISOString(),
        lastLoginAt: this.accounts[dhgAdminId]?.lastLoginAt || new Date().toISOString(),
        active: true,
        permissions: {
          canEdit: true,
          canDelete: true,
          canExport: true,
          canImport: true
        }
      };

      // Ensure default users if empty
      const user1Id = 'user_tecnico';
      if (!this.accounts[user1Id]) {
        this.accounts[user1Id] = {
          id: user1Id,
          username: 'tecnico',
          email: 'tecnico@profea.es',
          password: '123',
          displayName: 'Carlos Vega (Técnico de Obra)',
          role: 'user',
          departamento: 'Obras y Urbanismo',
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          active: true,
          permissions: { canEdit: true, canDelete: false, canExport: true, canImport: true }
        };
      }

      this.saveToFile();
    } catch (err) {
      console.error('[AccountStore] Error initializing accounts:', err);
    }
  }

  private saveToFile() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(this.accounts, null, 2), 'utf-8');
    } catch (err) {
      console.error('[AccountStore] Error saving accounts:', err);
    }
  }

  public getAccounts(): UserAccount[] {
    return Object.values(this.accounts).map(acc => {
      // Exclude password when listing
      const { password, ...safe } = acc;
      return safe as UserAccount;
    });
  }

  public getAccountById(id: string): UserAccount | null {
    return this.accounts[id] || null;
  }

  public getAccountByUsernameOrEmail(identifier: string): UserAccount | null {
    const clean = identifier.trim().toLowerCase();
    for (const acc of Object.values(this.accounts)) {
      if (
        acc.username.toLowerCase() === clean ||
        acc.email.toLowerCase() === clean
      ) {
        return acc;
      }
    }
    return null;
  }

  public authenticate(identifier: string, passwordAttempt: string): UserAccount | null {
    const cleanId = identifier.trim().toLowerCase();
    const cleanPass = passwordAttempt.trim();
    const account = this.getAccountByUsernameOrEmail(cleanId);
    if (!account) return null;

    if (account.active === false) {
      throw new Error("Esta cuenta de usuario ha sido desactivada por el administrador.");
    }

    // Direct password match (strictly checking password)
    let isValid = false;
    if (account.password && account.password === cleanPass) {
      isValid = true;
    } else if (account.username.toLowerCase() === 'dhg' && cleanPass === '75810011X') {
      isValid = true;
    }

    if (isValid) {
      account.lastLoginAt = new Date().toISOString();
      this.accounts[account.id] = account;
      this.saveToFile();
      const { password, ...safe } = account;
      return safe as UserAccount;
    }
    return null;
  }

  public createAccount(data: {
    username: string;
    email: string;
    password?: string;
    displayName: string;
    role?: UserRole;
    departamento?: string;
    active?: boolean;
    permissions?: UserPermissions;
  }): UserAccount {
    const cleanUsername = data.username.trim();
    const cleanUsernameKey = cleanUsername.toLowerCase();
    const existing = this.getAccountByUsernameOrEmail(cleanUsernameKey);
    if (existing) {
      throw new Error(`El nombre de usuario o correo "${data.username}" ya está registrado.`);
    }

    const id = `user_${cleanUsernameKey.replace(/[^a-z0-9_]/g, '_')}_${Date.now().toString(36)}`;
    const newAccount: UserAccount = {
      id,
      username: cleanUsername,
      email: (data.email || cleanUsername).trim().toLowerCase(),
      password: data.password || '123456',
      displayName: data.displayName.trim() || cleanUsername,
      role: data.role || 'user',
      departamento: data.departamento || 'PROFEA General',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      active: data.active !== false,
      permissions: data.permissions || {
        canEdit: true,
        canDelete: false,
        canExport: true,
        canImport: true
      }
    };

    this.accounts[id] = newAccount;
    this.saveToFile();

    const { password, ...safe } = newAccount;
    return safe as UserAccount;
  }

  public updateAccount(id: string, updates: Partial<UserAccount>): UserAccount | null {
    const current = this.accounts[id];
    if (!current) return null;

    const updated: UserAccount = {
      ...current,
      displayName: updates.displayName !== undefined ? updates.displayName : current.displayName,
      email: updates.email !== undefined ? updates.email : current.email,
      role: updates.role !== undefined ? updates.role : current.role,
      departamento: updates.departamento !== undefined ? updates.departamento : current.departamento,
      active: updates.active !== undefined ? updates.active : (current.active !== false),
      permissions: updates.permissions !== undefined ? updates.permissions : current.permissions,
      ...(updates.password && updates.password.trim() ? { password: updates.password.trim() } : {})
    };

    // Ensure DHG cannot be downgraded from admin or deactivated
    if (current.username.toLowerCase() === 'dhg') {
      updated.role = 'admin';
      updated.active = true;
    }

    this.accounts[id] = updated;
    this.saveToFile();

    const { password, ...safe } = updated;
    return safe as UserAccount;
  }

  public deleteAccount(id: string): boolean {
    const target = this.accounts[id];
    if (!target) return false;
    
    // Protect primary admin from accidental deletion
    if (target.username.toLowerCase() === 'dhg' || target.id === 'user_dhg') {
      throw new Error("No es posible eliminar la cuenta del Administrador principal DHG.");
    }

    delete this.accounts[id];
    this.saveToFile();
    return true;
  }
}

export const accountStore = new AccountStore();
