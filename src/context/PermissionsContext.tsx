
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { RolePermissions } from '@/lib/types';
import { initialPermissions } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from './AuthContext';
import { useAudit } from './AuditContext';

interface PermissionsContextType {
    permissions: RolePermissions | null;
    updatePermissions: (newPermissions: RolePermissions) => Promise<void>;
    isLoading: boolean;
    resetPermissions: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextType | undefined>(undefined);

export const PermissionsProvider = ({ children }: { children: ReactNode }) => {
    const [permissions, setPermissions] = useState<RolePermissions | null>(initialPermissions);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const { user } = useAuth();
    const { logAction } = useAudit();

    useEffect(() => {
        const fetchPermissions = async () => {
            try {
                const { data, error } = await supabase
                    .from('config')
                    .select('value')
                    .eq('key', 'rolePermissions')
                    .maybeSingle();

                if (error) throw error;

                if (data?.value) {
                    setPermissions({ ...initialPermissions, ...(data.value as any) });
                } else {
                    // Initialize with defaults if not exists
                    await supabase
                        .from('config')
                        .upsert({ key: 'rolePermissions', value: initialPermissions });
                    setPermissions(initialPermissions);
                }
            } catch (error) {
                console.error("Failed to load permissions from Supabase:", error);
                setPermissions(initialPermissions); // Fallback
            } finally {
                setIsLoading(false);
            }
        };

        fetchPermissions();

        // Subscribe to real-time changes
        const channel = supabase.channel('public:config:rolePermissions')
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'config',
                filter: "key=eq.rolePermissions"
            }, (payload) => {
                if (payload.new && (payload.new as any).value) {
                    setPermissions({ ...initialPermissions, ...((payload.new as any).value as any) });
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const updatePermissions = useCallback(async (newPermissions: RolePermissions) => {
        try {
            const { error } = await supabase
                .from('config')
                .upsert({ key: 'rolePermissions', value: newPermissions });

            if (error) throw error;

            // Real-time listener will update the state
            logAction('Atualização de Permissões', 'As permissões de acesso dos perfis foram alteradas.', user);
            toast({
                title: "Permissões Salvas!",
                description: "As regras de acesso foram atualizadas com sucesso.",
            });
        } catch (error) {
            console.error("Error updating permissions in Supabase:", error);
            toast({ title: "Erro", description: "Não foi possível salvar as permissões.", variant: "destructive" });
        }
    }, [toast, logAction, user]);

    const resetPermissions = useCallback(async () => {
        await updatePermissions(initialPermissions);
    }, [updatePermissions]);

    return (
        <PermissionsContext.Provider value={{ permissions, updatePermissions, isLoading, resetPermissions }}>
            {children}
        </PermissionsContext.Provider>
    );
};

export const usePermissions = () => {
    const context = useContext(PermissionsContext);
    if (context === undefined) {
        throw new Error('usePermissions must be used within a PermissionsProvider');
    }
    return context;
};

