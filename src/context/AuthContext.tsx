
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import type { User } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { useAudit } from './AuditContext';

const initialUsers: User[] = [
  { id: 'user-1', username: 'admin', password: 'adminpassword', name: 'Administrador', role: 'admin', canBeAssigned: true },
  { id: 'user-2', username: 'gerente', password: 'gerentepassword', name: 'Gerente Loja', role: 'gerente', canBeAssigned: true },
  { id: 'user-3', username: 'vendedor', password: 'vendedorpassword', name: 'Vendedor Teste', role: 'vendedor', canBeAssigned: true },
];

interface AuthContextType {
  user: User | null;
  users: User[];
  login: (user: string, pass: string) => void;
  logout: () => void;
  addUser: (data: Omit<User, 'id'>) => Promise<boolean>;
  updateUser: (userId: string, data: Partial<Omit<User, 'id'>>) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  changeMyPassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  isLoading: boolean;
  isAuthenticated: boolean;
  restoreUsers: (users: User[]) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { toast } = useToast();
  const { logAction } = useAudit();


  useEffect(() => {
    setIsLoading(true);

    const fetchUsers = async () => {
      const { data, error }: { data: User[] | null; error: any } = await supabase.from('users').select('*');

      if (error) {
        console.error('Error fetching users:', error);
        return;
      }

      if (data) {
        setUsers(data);

        // Validar sessão armazenada contra o banco de dados em tempo real
        try {
          const storedUser = localStorage.getItem('user');
          if (storedUser) {
            const parsedUser = JSON.parse(storedUser) as User;
            // Verificar se o usuário ainda existe no banco
            const validUser = data.find(u => u.id === parsedUser.id);
            if (validUser) {
              // Atualizar dados do usuário com informações mais recentes do banco
              const updatedUser = { ...validUser };
              delete updatedUser.password; // Nunca armazenar senha
              setUser(updatedUser);
              localStorage.setItem('user', JSON.stringify(updatedUser));
            } else {
              // Usuário não existe mais, limpar sessão
              localStorage.removeItem('user');
              setUser(null);
            }
          }
        } catch (error) {
          console.error("Failed to validate session:", error);
          localStorage.removeItem('user');
          setUser(null);
        }
      }
    };

    fetchUsers();

    // Realtime Subscription - atualiza sessão quando usuário mudar no banco
    const channel = supabase.channel('users-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, (payload) => {
        const record = payload.new as Record<string, any> | null;
        const oldRecord = payload.old as Record<string, any> | null;

        // Atualizar lista de usuários
        fetchUsers();

        // Se o usuário logado foi modificado ou deletado, atualizar sessão
        if (payload.eventType === 'UPDATE' && record && user && record.id === user.id) {
          const updatedUser = { ...record } as User;
          delete updatedUser.password;
          setUser(updatedUser);
          localStorage.setItem('user', JSON.stringify(updatedUser));
        } else if (payload.eventType === 'DELETE' && oldRecord && user && oldRecord.id === user.id) {
          // Usuário foi deletado, fazer logout
          setUser(null);
          localStorage.removeItem('user');
        }
      })
      .subscribe();

    setIsLoading(false);

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const login = (username: string, pass: string) => {
    // Basic auth logic using the users list fetched
    // In production, this should be a direct DB query or Supabase Auth
    const foundUser = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!foundUser) {
      toast({ title: 'Falha no Login', description: 'Usuário não encontrado.', variant: 'destructive' });
      return;
    }

    // Passwords stored as plain text currently
    if (!foundUser.password) {
      toast({ title: 'Falha no Login', description: 'Usuário sem senha cadastrada.', variant: 'destructive' });
      return;
    }

    const isPasswordValid = foundUser.password === pass;
    if (isPasswordValid) {
      const userToStore = { ...foundUser };
      // Ensure password is not stored in state or localStorage for security
      delete userToStore.password;

      setUser(userToStore);
      localStorage.setItem('user', JSON.stringify(userToStore));
      logAction('Login', `Usuário "${foundUser.name}" realizou login.`, userToStore);
      router.push('/admin');
      toast({
        title: 'Login bem-sucedido!',
        description: `Bem-vindo(a), ${foundUser.name}.`,
      });
    } else {
      toast({
        title: 'Falha no Login',
        description: 'Senha inválida.',
        variant: 'destructive',
      });
    }
  };

  const logout = () => {
    if (user) {
      logAction('Logout', `Usuário "${user.name}" realizou logout.`, user);
    }
    setUser(null);
    localStorage.removeItem('user');
    router.push('/login');
  };

  const addUser = async (data: Omit<User, 'id'>): Promise<boolean> => {
    const isUsernameTaken = users.some(u => u.username.toLowerCase() === data.username.toLowerCase());
    if (isUsernameTaken) {
      toast({
        title: 'Erro ao Criar Usuário',
        description: 'Este nome de usuário já está em uso.',
        variant: 'destructive',
      });
      return false;
    }

    // Using random UUID or similar for ID, Supabase can handle this but we want to mimic current logic
    const newUserId = `user-${Date.now()}`;
    const newUser: User = { ...data, canBeAssigned: data.canBeAssigned ?? true, id: newUserId };

    try {
      const { error } = await supabase.from('users').insert(newUser);

      if (error) throw error;

      setUsers((prev) => [...prev, newUser]);
      logAction('Criação de Usuário', `Novo usuário "${data.name}" (Perfil: ${data.role}) foi criado.`, user);
      toast({
        title: 'Usuário Criado!',
        description: `O usuário ${data.name} foi criado com sucesso.`,
      });
      return true;
    } catch (error: any) {
      toast({
        title: 'Erro ao Criar Usuário',
        description: 'Não foi possível salvar o novo usuário. ' + error.message,
        variant: 'destructive',
      });
      return false;
    }
  };

  const updateUser = async (userId: string, data: Partial<Omit<User, 'id'>>) => {
    if (data.username) {
      const isUsernameTaken = users.some(u => u.id !== userId && u.username.toLowerCase() === data.username?.toLowerCase());
      if (isUsernameTaken) {
        toast({
          title: 'Erro ao Atualizar',
          description: 'Este nome de usuário já está em uso por outra conta.',
          variant: 'destructive',
        });
        return;
      }
    }

    const updatedUser = users.find(u => u.id === userId);
    if (updatedUser) {
      let details = `Dados do usuário "${updatedUser.name}" foram alterados.`;
      if (data.name && data.name !== updatedUser.name) details += ` Nome: de "${updatedUser.name}" para "${data.name}".`;
      // ... build details string same as before
      logAction('Atualização de Usuário', details, user);
    }

    try {
      const { error } = await supabase.from('users').update(data).eq('id', userId);
      if (error) throw error;

      setUsers((prev) => prev.map((u) => (u.id === userId ? ({ ...u, ...data } as User) : u)));

      if (user?.id === userId) {
        const updatedCurrentUser = { ...user, ...data };
        delete updatedCurrentUser.password;
        setUser(updatedCurrentUser);
        localStorage.setItem('user', JSON.stringify(updatedCurrentUser));
      }

      toast({
        title: 'Usuário Atualizado!',
        description: 'As informações do usuário foram salvas com sucesso.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao Atualizar',
        description: 'Não foi possível salvar as alterações do usuário. ' + error.message,
        variant: 'destructive',
      });
      throw error;
    }
  };

  const deleteUser = async (userId: string) => {
    if (user?.id === userId) {
      toast({
        title: 'Ação não permitida',
        description: 'Você não pode excluir seu próprio usuário.',
        variant: 'destructive',
      });
      return;
    }

    const userToDelete = users.find(u => u.id === userId);

    try {
      const { error } = await supabase.from('users').delete().eq('id', userId);
      if (error) throw error;

      setUsers((prev) => prev.filter((u) => u.id !== userId));
      if (userToDelete) {
        logAction('Exclusão de Usuário', `Usuário "${userToDelete.name}" foi excluído.`, user);
      }
      toast({
        title: 'Usuário Excluído!',
        description: 'O usuário foi removido do sistema.',
        variant: 'destructive',
        duration: 5000,
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao Excluir',
        description: 'Não foi possível excluir o usuário. ' + error.message,
        variant: 'destructive',
      });
      throw error;
    }
  };

  const changeMyPassword = async (currentPassword: string, newPassword: string): Promise<boolean> => {
    if (!user) {
      toast({ title: "Erro", description: "Você não está logado.", variant: "destructive" });
      return false;
    }

    const currentUserInDB = users.find(u => u.id === user.id);

    if (!currentUserInDB || currentUserInDB.password !== currentPassword) {
      toast({ title: "Erro", description: "A senha atual está incorreta.", variant: "destructive" });
      return false;
    }

    await updateUser(user.id, { password: newPassword });
    logAction('Alteração de Senha', `O usuário "${user.name}" alterou a própria senha.`, user);
    toast({ title: "Senha Alterada!", description: "Sua senha foi atualizada com sucesso." });
    return true;
  };

  const restoreUsers = async (usersToRestore: User[]) => {
    // Deleting all current users and inserting new ones
    // This is risky in Supabase due to foreign keys, but we'll try simplistic approach for now
    // Or better: Upsert
    try {
      // Upsert allows updating existing and inserting new
      const { error } = await supabase.from('users').upsert(usersToRestore);
      if (error) throw error;

      logAction('Restauração de Usuários', 'Todos os usuários foram restaurados a partir de um backup.', user);
      toast({ title: "Usuários Restaurados!", description: "A lista de usuários foi substituída com sucesso." });
    } catch (error: any) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    }
  };

  return (
    <AuthContext.Provider value={{ user, users, login, logout, addUser, updateUser, deleteUser, changeMyPassword, isLoading, isAuthenticated: !!user, restoreUsers }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
