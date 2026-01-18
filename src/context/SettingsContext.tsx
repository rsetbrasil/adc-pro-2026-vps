

'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useAudit } from './AuditContext';
import { useAuth } from './AuthContext';
import type { StoreSettings } from '@/lib/types';

const initialSettings: StoreSettings = {
    storeName: 'ADC Móveis',
    storeCity: '',
    storeAddress: '',
    pixKey: '',
    storePhone: '',
    logoUrl: '',
    accessControlEnabled: false,
    commercialHourStart: '08:00',
    commercialHourEnd: '18:00',
};

const SETTINGS_CACHE_KEY = 'adcpro/storeSettingsCache/v1';

const mergeWithDefaults = (maybeSettings: Partial<StoreSettings> | null | undefined): StoreSettings => {
    return {
        ...initialSettings,
        ...(maybeSettings || {}),
    };
};

const readCachedSettings = (): StoreSettings | null => {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(SETTINGS_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoreSettings;
        return mergeWithDefaults(parsed);
    } catch {
        return null;
    }
};

const writeCachedSettings = (settings: StoreSettings) => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
    } catch { }
};

const clearCachedSettings = () => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(SETTINGS_CACHE_KEY);
    } catch { }
};

interface SettingsContextType {
    settings: StoreSettings;
    updateSettings: (newSettings: Partial<StoreSettings>) => Promise<void>;
    isLoading: boolean;
    restoreSettings: (settings: StoreSettings) => Promise<void>;
    resetSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
    const [settings, setSettings] = useState<StoreSettings>(() => readCachedSettings() || initialSettings);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const { logAction } = useAudit();
    const { user } = useAuth();


    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const { data, error } = await supabase
                    .from('config')
                    .select('value')
                    .eq('key', 'storeSettings')
                    .maybeSingle();

                if (error) throw error;

                if (data?.value) {
                    const remote = mergeWithDefaults(data.value as Partial<StoreSettings>);
                    setSettings(remote);
                    writeCachedSettings(remote);
                }
            } catch (error) {
                console.error("Failed to load settings from Supabase:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchSettings();

        // Subscribe to real-time changes
        const channel = supabase.channel('public:config:storeSettings')
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'config',
                filter: "key=eq.storeSettings"
            }, (payload) => {
                if (payload.new && (payload.new as any).value) {
                    const remote = mergeWithDefaults((payload.new as any).value as Partial<StoreSettings>);
                    setSettings(remote);
                    writeCachedSettings(remote);
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const updateSettings = async (newSettings: Partial<StoreSettings>) => {
        try {
            const cleanedNewSettings = Object.fromEntries(
                Object.entries(newSettings).filter(([, value]) => value !== undefined)
            ) as Partial<StoreSettings>;

            const updatedValue = { ...settings, ...cleanedNewSettings };

            const { error } = await supabase
                .from('config')
                .upsert({ key: 'storeSettings', value: updatedValue });

            if (error) throw error;

            logAction('Atualização de Configurações', `Configurações da loja foram alteradas.`, user);
            toast({
                title: "Configurações Salvas!",
                description: "As informações da loja foram atualizadas com sucesso.",
            });
        } catch (error) {
            console.error("Error updating settings in Supabase:", error);
            toast({ title: "Erro", description: "Não foi possível salvar as configurações.", variant: "destructive" });
        }
    };

    const restoreSettings = async (settingsToRestore: StoreSettings) => {
        await updateSettings(settingsToRestore);
        logAction('Restauração de Configurações', `Configurações da loja foram restauradas de um backup.`, user);
    };

    const resetSettings = async () => {
        clearCachedSettings();
        await updateSettings(initialSettings);
        logAction('Reset de Configurações', `Configurações da loja foram restauradas para o padrão.`, user);
    };

    return (
        <SettingsContext.Provider value={{ settings, updateSettings, isLoading, restoreSettings, resetSettings }}>
            {children}
        </SettingsContext.Provider>
    );
};

export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (context === undefined) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};



