
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { AuditLog, User } from '@/lib/types';
import { supabase } from '@/lib/supabase';

interface AuditContextType {
  auditLogs: AuditLog[];
  logAction: (action: string, details: string, user: User | null) => void;
  isLoading: boolean;
}

const AuditContext = createContext<AuditContextType | undefined>(undefined);

export const AuditProvider = ({ children }: { children: ReactNode }) => {
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false });

      if (error) throw error;

      if (data) {
        setAuditLogs(data as AuditLog[]);
      }
    } catch (error) {
      console.error("Error fetching audit logs from Supabase:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();

    // Subscribe to real-time changes
    const channel = supabase.channel('public:audit_logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, (payload) => {
        const newLog = payload.new as AuditLog;
        setAuditLogs(prev => [newLog, ...prev]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchLogs]);


  const logAction = useCallback(async (action: string, details: string, user: User | null) => {
    if (!user) return;

    const newLog = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date().toISOString(),
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action,
      details
    };

    try {
      const { error } = await supabase.from('audit_logs').insert(newLog);
      if (error) throw error;
      // Real-time listener will update the state locally
    } catch (error) {
      console.error("Error writing audit log to Supabase:", error);
    }
  }, []);

  return (
    <AuditContext.Provider value={{ auditLogs, logAction, isLoading }}>
      {children}
    </AuditContext.Provider>
  );
};

export const useAudit = () => {
  const context = useContext(AuditContext);
  if (context === undefined) {
    throw new Error('useAudit must be used within an AuditProvider');
  }
  return context;
};

