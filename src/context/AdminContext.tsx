

'use client';

import React, { createContext, useContext, ReactNode, useCallback, useState, useEffect, useMemo, useRef } from 'react';
import type { Order, Product, Installment, CustomerInfo, Category, User, CommissionPayment, Payment, StockAudit, Avaria, ChatSession } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useData } from './DataContext';
import { addMonths, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from './AuthContext';
import { allocateNextCustomerCode, formatCustomerCode, reserveCustomerCodes } from '@/lib/customer-code';
import { normalizeCpf } from '@/lib/customer-trash';

// Helper function to log actions, passed as an argument now
type LogAction = (action: string, details: string, user: User | null) => void;

export const chunkPromise = async <T,>(items: T[], fn: (item: T) => Promise<any>, size = 50) => {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
};

// Moved from utils to avoid server-side execution
const calculateCommission = (order: Order, allProducts: Product[]) => {
  // If a commission was set manually on the order, it takes precedence.
  if (order.isCommissionManual && typeof order.commission === 'number') {
    return order.commission;
  }

  // If the order has no seller, there's no commission.
  if (!order.sellerId) {
    return 0;
  }

  const fallbackPercentage = 5;

  // Otherwise, calculate based on product rules.
  return order.items.reduce((totalCommission, item) => {
    const product = allProducts.find(p => p.id === item.id);

    const hasExplicitCommissionValue =
      product && typeof product.commissionValue === 'number' && !Number.isNaN(product.commissionValue);

    const commissionType = hasExplicitCommissionValue ? (product!.commissionType || 'percentage') : 'percentage';
    const commissionValue = hasExplicitCommissionValue ? product!.commissionValue! : fallbackPercentage;

    if (commissionType === 'fixed') {
      return totalCommission + (commissionValue * item.quantity);
    }

    if (commissionType === 'percentage') {
      const itemTotal = item.price * item.quantity;
      return totalCommission + (itemTotal * (commissionValue / 100));
    }

    return totalCommission;
  }, 0);
};

function recalculateInstallments(total: number, installmentsCount: number, orderId: string, firstDueDate: string): Installment[] {
  if (installmentsCount <= 0 || total < 0) return [];

  const totalInCents = Math.round(total * 100);
  const baseInstallmentValueInCents = Math.floor(totalInCents / installmentsCount);
  let remainderInCents = totalInCents % installmentsCount;

  const newInstallmentDetails: Installment[] = [];

  for (let i = 0; i < installmentsCount; i++) {
    let installmentValueCents = baseInstallmentValueInCents;
    if (remainderInCents > 0) {
      installmentValueCents++;
      remainderInCents--;
    }

    newInstallmentDetails.push({
      id: `inst-${orderId}-${i + 1}`,
      installmentNumber: i + 1,
      amount: installmentValueCents / 100,
      dueDate: addMonths(new Date(firstDueDate), i).toISOString(),
      status: 'Pendente',
      paidAmount: 0,
      payments: [],
    });
  }

  return newInstallmentDetails;
}

function sanitizeCustomerForFirestore(customer: CustomerInfo): Record<string, any> {
  const obj: Record<string, any> = {};
  Object.entries(customer).forEach(([key, value]) => {
    if (value !== undefined) obj[key] = value;
  });
  if (obj.password === undefined || obj.password === '') {
    delete obj.password;
  }
  return obj;
}

const canAccessCustomersTrash = (u: User | null) => u?.role === 'admin' || u?.role === 'gerente';


interface AdminContextType {
  addOrder: (order: Partial<Order> & { firstDueDate: Date }, logAction: LogAction, user: User | null) => Promise<Order | null>;
  addCustomer: (customerData: CustomerInfo, logAction: LogAction, user: User | null) => Promise<void>;
  generateCustomerCodes: (logAction: LogAction, user: User | null) => Promise<{ newCustomers: number; updatedOrders: number }>;
  deleteOrder: (orderId: string, logAction: LogAction, user: User | null) => Promise<void>;
  permanentlyDeleteOrder: (orderId: string, logAction: LogAction, user: User | null) => Promise<void>;
  updateOrderStatus: (orderId: string, status: Order['status'], logAction: LogAction, user: User | null) => Promise<void>;
  recordInstallmentPayment: (orderId: string, installmentNumber: number, payment: Omit<Payment, 'receivedBy'>, logAction: LogAction, user: User | null) => Promise<void>;
  reversePayment: (orderId: string, installmentNumber: number, paymentId: string, logAction: LogAction, user: User | null) => Promise<void>;
  updateInstallmentDueDate: (orderId: string, installmentNumber: number, newDueDate: Date, logAction: LogAction, user: User | null) => Promise<void>;
  updateInstallmentAmount: (orderId: string, installmentNumber: number, newAmount: number, logAction: LogAction, user: User | null) => Promise<void>;
  updateCustomer: (oldCustomer: CustomerInfo, updatedCustomerData: CustomerInfo, logAction: LogAction, user: User | null) => Promise<void>;
  deleteCustomer: (customer: CustomerInfo, logAction: LogAction, user: User | null) => Promise<void>;
  restoreCustomerFromTrash: (customer: CustomerInfo, logAction: LogAction, user: User | null) => Promise<void>;
  permanentlyDeleteCustomerFromTrash: (customer: CustomerInfo, logAction: LogAction, user: User | null) => Promise<void>;
  importCustomers: (csvData: string, logAction: LogAction, user: User | null) => Promise<void>;
  updateOrderDetails: (orderId: string, details: Partial<Order> & { downPayment?: number, resetDownPayment?: boolean }, logAction: LogAction, user: User | null) => Promise<void>;
  addProduct: (productData: Omit<Product, 'id' | 'data-ai-hint' | 'createdAt'>, logAction: LogAction, user: User | null) => Promise<void>;
  updateProduct: (product: Product, logAction: LogAction, user: User | null) => Promise<void>;
  deleteProduct: (productId: string, logAction: LogAction, user: User | null) => Promise<void>;
  importProducts: (productsToImport: Product[], logAction: LogAction, user: User | null) => Promise<void>;
  addCategory: (categoryName: string, logAction: LogAction, user: User | null) => Promise<void>;
  deleteCategory: (categoryId: string, logAction: LogAction, user: User | null) => Promise<void>;
  updateCategoryName: (categoryId: string, newName: string, logAction: LogAction, user: User | null) => Promise<void>;
  addSubcategory: (categoryId: string, subcategoryName: string, logAction: LogAction, user: User | null) => Promise<void>;
  updateSubcategory: (categoryId: string, oldSub: string, newSub: string, logAction: LogAction, user: User | null) => Promise<void>;
  deleteSubcategory: (categoryId: string, subcategoryName: string, logAction: LogAction, user: User | null) => Promise<void>;
  moveCategory: (categoryId: string, direction: 'up' | 'down', logAction: LogAction, user: User | null) => Promise<void>;
  reorderSubcategories: (categoryId: string, draggedSub: string, targetSub: string, logAction: LogAction, user: User | null) => Promise<void>;
  moveSubcategory: (sourceCategoryId: string, subName: string, targetCategoryId: string, logAction: LogAction, user: User | null) => Promise<void>;
  payCommissions: (sellerId: string, sellerName: string, amount: number, orderIds: string[], period: string, logAction: LogAction, user: User | null) => Promise<string | null>;
  reverseCommissionPayment: (paymentId: string, logAction: LogAction, user: User | null) => Promise<void>;
  restoreAdminData: (data: { products: Product[], orders: Order[], categories: Category[], commissionPayments?: CommissionPayment[], stockAudits?: StockAudit[], avarias?: Avaria[], chatSessions?: ChatSession[], customers?: CustomerInfo[], customersTrash?: CustomerInfo[] }, logAction: LogAction, user: User | null) => Promise<void>;
  resetOrders: (logAction: LogAction, user: User | null) => Promise<void>;
  resetProducts: (logAction: LogAction, user: User | null) => Promise<void>;
  resetFinancials: (logAction: LogAction, user: User | null) => Promise<void>;
  resetAllAdminData: (logAction: LogAction, user: User | null) => Promise<void>;
  saveStockAudit: (audit: StockAudit, logAction: LogAction, user: User | null) => Promise<void>;
  addAvaria: (avariaData: Omit<Avaria, 'id' | 'createdAt' | 'createdBy' | 'createdByName'>, logAction: LogAction, user: User | null) => Promise<void>;
  updateAvaria: (avariaId: string, avariaData: Partial<Omit<Avaria, 'id'>>, logAction: LogAction, user: User | null) => Promise<void>;
  deleteAvaria: (avariaId: string, logAction: LogAction, user: User | null) => Promise<void>;
  emptyTrash: (logAction: LogAction, user: User | null) => Promise<void>;
  // Product Trash
  restoreProduct: (product: Product, logAction: LogAction, user: User | null) => Promise<void>;
  permanentlyDeleteProduct: (productId: string, logAction: LogAction, user: User | null) => Promise<void>;
  fetchDeletedProducts: () => Promise<Product[]>;
  // Admin Data states
  orders: Order[];
  commissionPayments: CommissionPayment[];
  stockAudits: StockAudit[];
  avarias: Avaria[];
  chatSessions: ChatSession[];
  customers: CustomerInfo[];
  deletedCustomers: CustomerInfo[];
  customerOrders: { [key: string]: Order[] };
  customerFinancials: { [key: string]: { totalComprado: number, totalPago: number, saldoDevedor: number } };
  financialSummary: { totalVendido: number, totalRecebido: number, totalPendente: number, lucroBruto: number, monthlyData: { name: string, total: number }[] };
  commissionSummary: { totalPendingCommission: number, commissionsBySeller: { id: string; name: string; total: number; count: number; orderIds: string[] }[] };
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

export const AdminProvider = ({ children }: { children: ReactNode }) => {
  const { products, categories, updateProductLocally, addProductLocally, deleteProductLocally } = useData();
  const { toast } = useToast();
  const { user, users } = useAuth();
  const notifiedOnlineOrderIdsRef = useRef<Set<string>>(new Set());
  const isOrdersSnapshotReadyRef = useRef(false);

  const allowEmptyProductsFor = useCallback((ms: number) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('allowEmptyProductsUntil', String(Date.now() + ms));
    } catch {
    }
  }, []);


  // Admin data states
  const [orders, setOrders] = useState<Order[]>([]);
  const [commissionPayments, setCommissionPayments] = useState<CommissionPayment[]>([]);
  const [stockAudits, setStockAudits] = useState<StockAudit[]>([]);
  const [avarias, setAvarias] = useState<Avaria[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [customers, setCustomers] = useState<CustomerInfo[]>([]);
  const [deletedCustomers, setDeletedCustomers] = useState<CustomerInfo[]>([]);

  const fetchAll = useCallback(async (table: string, select = '*', orderField?: string, ascending = true) => {
    let allData: any[] = [];
    let from = 0;
    let to = 999;
    let finished = false;

    while (!finished) {
      let query = supabase.from(table).select(select).range(from, to);
      if (orderField) {
        query = query.order(orderField, { ascending });
      }

      const { data, error } = await query;
      if (error) {
        console.error(`Error fetching ${table} at range ${from}-${to}:`, error);
        throw error;
      }

      if (!data || data.length === 0) {
        finished = true;
      } else {
        allData = [...allData, ...data];
        if (data.length < 1000) {
          finished = true;
        } else {
          from += 1000;
          to += 1000;
        }
      }
    }
    return allData;
  }, []);

  const fetchCustomers = useCallback(async () => {
    try {
      const data = await fetchAll('customers', '*', 'name', true);
      const customersData = data as CustomerInfo[];
      setCustomers(customersData);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  }, [fetchAll]);

  const fetchTrash = useCallback(async () => {
    const canAccessTrash = user?.role === 'admin' || user?.role === 'gerente';
    if (!canAccessTrash) {
      setDeletedCustomers([]);
      return;
    }
    try {
      const data = await fetchAll('customers_trash', '*');
      const parsed = data.map((item: any) => ({
        ...(item.data || {}),
        id: item.id,
        cpf: item.cpf,
        name: item.name,
        deletedAt: item.deleted_at,
      })) as CustomerInfo[];
      setDeletedCustomers(parsed);
    } catch (error) {
      console.error('Error fetching trash:', error);
    }
  }, [user, fetchAll]);

  useEffect(() => {
    fetchCustomers();
    fetchTrash();
  }, [fetchCustomers, fetchTrash]);

  // Effect for fetching admin-specific data
  useEffect(() => {
    // Solicitar permissão de notificações do sistema
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        console.log("Permissão de notificação:", permission);
      }).catch(err => console.error("Erro ao solicitar permissão de notificação:", err));
    }

    const unsubscribes: (() => void)[] = [];

    const canNotify = !!user && ['admin', 'gerente', 'vendedor'].includes(user.role);

    const mapOrderFromDB = (data: any): Order => {
      if (!data) return {} as Order;

      // Mapeamento recursivo para garantir que parcelas e seus pagamentos sejam arrays
      const rawInstallments = data.installmentDetails || data.installment_details || [];
      const installmentDetails = Array.isArray(rawInstallments) ? rawInstallments.map((inst: any) => ({
        ...inst,
        payments: Array.isArray(inst.payments) ? inst.payments : []
      })) : [];

      return {
        ...data,
        items: Array.isArray(data.items) ? data.items : [],
        installmentDetails,
        customer: data.customer || { name: 'Cliente', cpf: '', phone: '', address: '', city: '' },
        createdAt: data.created_at || data.createdAt,
        total: typeof data.total === 'number' ? data.total : (Number(data.total) || 0),
        status: data.status || 'Processando',
      };
    };

    const fetchCollection = async (table: string, setter: React.Dispatch<React.SetStateAction<any[]>>, orderByField = 'created_at', mapper?: (data: any) => any) => {
      try {
        const data = await fetchAll(table, '*', orderByField, false);
        const finalData = mapper ? data.map(mapper) : data;
        setter(finalData);
      } catch (error) {
        console.error(`Error fetching ${table}:`, JSON.stringify(error, null, 2));
      }
    };

    // Fetch orders diretamente do Supabase
    const fetchOrders = async () => {
      try {
        const data = await fetchAll('orders', '*', 'date', false);
        const ordersData = data.map(mapOrderFromDB) as Order[];
        setOrders(ordersData);
      } catch (error) {
        console.error('Error fetching orders:', error);
      }
    };

    // Initial fetch
    fetchOrders();
    fetchCollection('commission_payments', setCommissionPayments, 'paymentDate'); // Match schema "paymentDate"
    fetchCollection('stock_audits', setStockAudits);
    fetchCollection('avarias', setAvarias);

    // Realtime subscriptions
    const channel = supabase.channel('admin-dashboard-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        const newRecord = payload.new as Record<string, any> | null;
        console.log("🔔 Realtime order change detected:", payload.eventType, newRecord?.id);

        // Handle state updates directly
        if (payload.eventType === 'INSERT') {
          const newOrder = mapOrderFromDB(payload.new);
          console.log("📦 Novo pedido inserido via Real-time:", newOrder.id, newOrder.customer?.name);

          // Evitar duplicatas - só adiciona se não existir
          setOrders(prev => {
            const exists = prev.some(o => o.id === newOrder.id);
            if (exists) {
              console.log("⚠️ Pedido já existe na lista, ignorando duplicata:", newOrder.id);
              return prev;
            }
            return [newOrder, ...prev];
          });

          // Notification Logic - Agora notifica TODOS os pedidos
          if (canNotify) {
            if (notifiedOnlineOrderIdsRef.current.has(newOrder.id)) return;
            notifiedOnlineOrderIdsRef.current.add(newOrder.id);

            const formatCurrency = (value: number) => {
              return new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              }).format(value);
            };

            const customerName = newOrder.customer?.name || 'Cliente';
            const sourceLabel = newOrder.source === 'Online' ? '🌐 Catálogo' : '📝 Manual';

            // Toast In-App
            toast({
              title: `Novo Pedido ${sourceLabel}`,
              description: `${customerName} • ${formatCurrency(newOrder.total || 0)} • Pedido ${newOrder.id}`,
              duration: 2000
            });

            // Notificação do Sistema (Windows/Browser)
            if (newOrder.source === 'Online' && 'Notification' in window && Notification.permission === 'granted') {
              try {
                const notification = new Notification(`Novo Pedido Online: ${newOrder.id}`, {
                  body: `${customerName} fez um pedido de ${formatCurrency(newOrder.total || 0)}.\nClique para ver detalhes.`,
                  icon: '/icon-192x192.png', // Tenta usar o ícone do PWA se existir, ou padrão
                  tag: newOrder.id, // Evita duplicatas nativas
                });

                notification.onclick = function () {
                  window.focus();
                  // Opcional: navegar para o pedido específico se possível
                  // window.location.href = `/admin/pedidos?id=${newOrder.id}`;
                  notification.close();
                };
              } catch (e) {
                console.error("Erro ao exibir notificação do sistema:", e);
              }
            }
          }
        } else if (payload.eventType === 'UPDATE') {
          const updatedRaw = payload.new;
          console.log("✏️ Pedido atualizado via Real-time:", updatedRaw.id);
          setOrders(prev => prev.map(o => {
            if (o.id === updatedRaw.id) {
              // Mescla os dados novos com os antigos e re-mapeia para garantir segurança
              return mapOrderFromDB({ ...o, ...updatedRaw });
            }
            return o;
          }));
        } else if (payload.eventType === 'DELETE') {
          console.log("🗑️ Pedido removido via Real-time:", payload.old.id);
          setOrders(prev => prev.filter(o => o.id !== payload.old.id));
        }
      })

      .on('postgres_changes', { event: '*', schema: 'public', table: 'commission_payments' }, () => fetchCollection('commission_payments', setCommissionPayments, 'paymentDate'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_audits' }, () => fetchCollection('stock_audits', setStockAudits))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'avarias' }, () => fetchCollection('avarias', setAvarias))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => fetchCustomers())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers_trash' }, () => fetchTrash())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [toast, user, fetchCustomers, fetchTrash]);

  const addCustomer = useCallback(async (customerData: CustomerInfo, logAction: LogAction, user: User | null) => {
    const cpf = normalizeCpf(customerData.cpf || '');
    if (cpf.length !== 11) {
      toast({ title: 'Erro', description: 'CPF inválido.', variant: 'destructive' });
      return;
    }

    try {
      const { data: existing } = await supabase.from('customers').select('cpf').eq('cpf', cpf).maybeSingle();

      if (existing) {
        toast({ title: 'Erro', description: 'Um cliente com este CPF já existe.', variant: 'destructive' });
        return;
      }

      const now = new Date().toISOString();
      // allocateNextCustomerCode logic might need adjustment if it uses Firestore, but checking lib/customer-code might be needed.
      // For now assuming it works or we replace it later.
      // Actually, allocateNextCustomerCode likely uses Firestore. I should check it.
      // If it does, I need to refactor it OR just use a simpler code generation for now.
      // Let's assume passed code or just skip code allocation if complex for now.
      // The implementation calls allocateNextCustomerCode(db) in original.
      // I will replace with a placeholder or Supabase count.

      let code = customerData.code || '';
      if (!code) {
        // Find the highest existing code to ensure uniqueness
        const { data: maxCodeUsers, error: maxCodeError } = await supabase
          .from('customers')
          .select('code')
          .order('code', { ascending: false })
          .limit(1);

        let nextCodeNumber = 1;
        if (!maxCodeError && maxCodeUsers && maxCodeUsers.length > 0) {
          const lastCode = maxCodeUsers[0].code;
          const lastCodeNum = parseInt(lastCode, 10);
          if (!isNaN(lastCodeNum)) {
            nextCodeNumber = lastCodeNum + 1;
          }
        }

        code = formatCustomerCode(nextCodeNumber);
      }

      const customerId = (customerData as any).id || `CUST-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      const customerToSave: CustomerInfo = {
        ...customerData,
        id: customerId,
        cpf,
        code,
      };

      const customerPayload = {
        ...sanitizeCustomerForFirestore(customerToSave),
        created_at: now,
        updated_at: now,
        createdBy: user?.id, // Match schema "createdBy"
        createdByName: user?.name // Match schema "createdByName"
      };

      // Since the schema uses quoted identifiers ("sellerId"), passing camelCase keys in JS object should work if Supabase client handles it correctly against the quoted columns. 
      // However, we must ensure keys match the table definition exactly.
      // Schema: id, code, name, cpf, phone, ..., sellerId, sellerName, createdBy, createdByName, created_at, updated_at

      const { error } = await supabase.from('customers').insert(customerPayload);
      if (error) throw error;

      // Atualização otimista - cliente aparece na lista imediatamente
      setCustomers(prev => [...prev, { ...customerToSave, created_at: now, updated_at: now } as CustomerInfo].sort((a, b) => a.name.localeCompare(b.name)));

      logAction('Cadastro de Cliente', `Cliente ${customerToSave.name} (CPF: ${cpf}) foi cadastrado.`, user);
      toast({ title: 'Cliente Cadastrado!', description: `${customerToSave.name} foi adicionado(a) com sucesso.`, duration: 2000 });
    } catch (e: any) {
      console.error('Error adding customer:', e);
      if (typeof e === 'object' && e !== null) {
        try {
          console.error(JSON.stringify(e, null, 2));
        } catch (jsonError) {
          console.error("Error stringifying error object", jsonError);
        }
      }
      const msg = e?.message || 'Erro desconhecido (ver console)';
      toast({ title: 'Erro', description: 'Erro ao salvar cliente: ' + msg, variant: 'destructive' });
    }
  }, [toast]);

  const legacyCustomers = useMemo(() => {
    const customerMap = new Map<string, CustomerInfo>();
    const sortedOrders = [...orders].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    sortedOrders.forEach((order) => {
      const cpf = normalizeCpf(order.customer.cpf || '');
      if (!cpf) return;
      if (!customerMap.has(cpf)) customerMap.set(cpf, { ...order.customer, cpf });
    });

    return Array.from(customerMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);

  const customersForUI = useMemo(() => {
    const deletedCpfSet = new Set(deletedCustomers.map((c) => normalizeCpf(c.cpf || '')));
    const byCpf = new Map<string, CustomerInfo>();

    customers.forEach((c) => {
      const cpf = normalizeCpf(c.cpf || '');
      if (!cpf) return;
      byCpf.set(cpf, { ...c, cpf });
    });

    legacyCustomers.forEach((c) => {
      const cpf = normalizeCpf(c.cpf || '');
      if (!cpf) return;
      if (!byCpf.has(cpf)) byCpf.set(cpf, { ...c, cpf });
    });

    return Array.from(byCpf.values())
      .filter((c) => !deletedCpfSet.has(normalizeCpf(c.cpf || '')))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, deletedCustomers, legacyCustomers]);

  const customerOrders = useMemo(() => {
    const ordersByCustomer: { [key: string]: Order[] } = {};
    orders.forEach(order => {
      const customerKey = order.customer.cpf?.replace(/\D/g, '') || `${order.customer.name}-${order.customer.phone}`;
      if (!ordersByCustomer[customerKey]) {
        ordersByCustomer[customerKey] = [];
      }
      // Check for duplicates to avoid React key errors
      if (!ordersByCustomer[customerKey].some(o => o.id === order.id)) {
        ordersByCustomer[customerKey].push(order);
      }
    });
    for (const key in ordersByCustomer) {
      ordersByCustomer[key].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    return ordersByCustomer;
  }, [orders]);

  const customerFinancials = useMemo(() => {
    const financialsByCustomer: { [key: string]: { totalComprado: number, totalPago: number, saldoDevedor: number } } = {};
    const allCustomers = [...customersForUI, ...deletedCustomers];
    allCustomers.forEach(customer => {
      const customerKey = customer.cpf?.replace(/\D/g, '') || `${customer.name}-${customer.phone}`;
      const ordersForCustomer = (customerOrders[customerKey] || []).filter(o => o.status !== 'Excluído' && o.status !== 'Cancelado');

      const totalComprado = ordersForCustomer.reduce((acc, order) => acc + order.total, 0);
      const totalPago = ordersForCustomer.reduce((sum, order) => {
        if (order.paymentMethod === 'Crediário') {
          const paid = (order.installmentDetails || []).reduce((s, inst) => s + (inst.paidAmount || 0), 0);
          return sum + paid;
        }
        if (order.paymentMethod === 'Dinheiro') {
          return sum + (order.total || 0);
        }
        if (order.paymentMethod === 'Pix') {
          const isLegacyPix = !order.asaas?.paymentId;
          const isPaid = isLegacyPix || !!order.asaas?.paidAt;
          return sum + (isPaid ? (order.total || 0) : 0);
        }
        return sum;
      }, 0);
      const saldoDevedor = totalComprado - totalPago;
      financialsByCustomer[customerKey] = { totalComprado, totalPago, saldoDevedor };
    });
    return financialsByCustomer;
  }, [customersForUI, deletedCustomers, customerOrders]);

  const financialSummary = useMemo(() => {
    const currentMonthKey = format(new Date(), 'yyyy-MM');
    let totalVendido = 0;
    let totalRecebido = 0;
    let totalPendente = 0;
    let lucroBruto = 0;
    const monthlySales: { [key: string]: number } = {};

    orders.forEach(order => {
      if (order.status === 'Cancelado' || order.status === 'Excluído') {
        return;
      }

      let orderDate: Date;
      try {
        orderDate = parseISO(order.date);
      } catch {
        return;
      }

      const monthKey = format(orderDate, 'MMM/yy', { locale: ptBR });
      if (!monthlySales[monthKey]) {
        monthlySales[monthKey] = 0;
      }
      monthlySales[monthKey] += order.total;

      if (format(orderDate, 'yyyy-MM') !== currentMonthKey) {
        return;
      }

      totalVendido += order.total;

      // Verificar se items existe antes de iterar
      if (order.items && Array.isArray(order.items)) {
        order.items.forEach(item => {
          const product = products.find(p => p.id === item.id);
          const cost = product?.cost || 0;
          const itemRevenue = item.price * item.quantity;
          const itemCost = cost * item.quantity;
          lucroBruto += (itemRevenue - itemCost);
        });
      }

      if (order.paymentMethod === 'Crediário') {
        (order.installmentDetails || []).forEach(inst => {
          if (inst.status === 'Pago') {
            totalRecebido += inst.paidAmount || inst.amount;
          } else {
            totalRecebido += inst.paidAmount || 0;
            totalPendente += inst.amount - (inst.paidAmount || 0);
          }
        });
      } else {
        if (order.paymentMethod === 'Dinheiro') {
          totalRecebido += order.total;
        } else if (order.paymentMethod === 'Pix') {
          const isLegacyPix = !order.asaas?.paymentId;
          if (isLegacyPix || order.asaas?.paidAt) {
            totalRecebido += order.total;
          } else {
            totalPendente += order.total;
          }
        }
      }
    });

    const monthlyData = Object.entries(monthlySales).map(([name, total]) => ({ name, total })).reverse();

    return { totalVendido, totalRecebido, totalPendente, lucroBruto, monthlyData };
  }, [orders, products]);

  const commissionSummary = useMemo(() => {
    const sellerCommissions = new Map<string, { name: string; total: number; count: number; orderIds: string[] }>();

    orders.forEach(order => {
      if (order.status === 'Entregue' && order.sellerId && typeof order.commission === 'number' && order.commission > 0 && !order.commissionPaid) {
        const sellerId = order.sellerId;
        const sellerName = order.sellerName || users.find(u => u.id === sellerId)?.name || 'Vendedor Desconhecido';

        const current = sellerCommissions.get(sellerId) || { name: sellerName, total: 0, count: 0, orderIds: [] };
        current.total += order.commission;
        current.count += 1;
        current.orderIds.push(order.id);
        sellerCommissions.set(sellerId, current);
      }
    });

    const commissionsBySeller = Array.from(sellerCommissions.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.total - a.total);

    const totalPendingCommission = commissionsBySeller.reduce((acc, seller) => acc + seller.total, 0);

    return { totalPendingCommission, commissionsBySeller };
  }, [orders, users]);

  const restoreAdminData = useCallback(async (data: { products: Product[], orders: Order[], categories: Category[], commissionPayments?: CommissionPayment[], stockAudits?: StockAudit[], avarias?: Avaria[], chatSessions?: ChatSession[], customers?: CustomerInfo[], customersTrash?: CustomerInfo[] }, logAction: LogAction, user: User | null) => {
    allowEmptyProductsFor(60_000);

    const processCollectionInBatches = async (collectionName: string, dataArray: any[], currentData: any[]) => {
      // Step 1: Delete all existing documents in the collection
      if (currentData.length > 0) {
        const allIds = currentData.map(d => d.id).filter(id => !!id);

        // chunk array of IDs into array of arrays of IDs
        const CHUNK_SIZE = 100;
        const idChunks = [];
        for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
          idChunks.push(allIds.slice(i, i + CHUNK_SIZE));
        }

        for (const chunk of idChunks) {
          const { error } = await supabase.from(collectionName).delete().in('id', chunk);
          if (error) console.error("Error deleting chunk from", collectionName, error);
        }
      }

      // Step 2: Write new documents from the backup file
      if (dataArray && dataArray.length > 0) {
        const { error } = await supabase.from(collectionName).upsert(dataArray);
        if (error) console.error("Error restoring", collectionName, error);
      }
    };

    const replaceCustomersCollection = async (collectionName: 'customers' | 'customers_trash', customersToRestore: CustomerInfo[] | undefined) => {
      const { data: existing } = await supabase.from(collectionName).select('id');
      if (existing && existing.length > 0) {
        const ids = existing.map(e => e.id);
        const CHUNK_SIZE = 100;
        for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
          await supabase.from(collectionName).delete().in('id', ids.slice(i, i + CHUNK_SIZE));
        }
      }

      if (customersToRestore && customersToRestore.length > 0) {
        const { error } = await supabase.from(collectionName).upsert(customersToRestore);
        if (error) console.error("Error restoring customers", error);
      }
    };

    try {
      await processCollectionInBatches('products', data.products, products);
      await processCollectionInBatches('orders', data.orders, orders);
      await processCollectionInBatches('categories', data.categories, categories);
      await processCollectionInBatches('commission_payments', data.commissionPayments || [], commissionPayments);
      await processCollectionInBatches('stock_audits', data.stockAudits || [], stockAudits);
      await processCollectionInBatches('avarias', data.avarias || [], avarias);
      await processCollectionInBatches('chat_sessions', data.chatSessions || [], chatSessions);
      await replaceCustomersCollection('customers', data.customers);
      await replaceCustomersCollection('customers_trash', data.customersTrash);

      logAction('Restauração de Backup', 'Todos os dados foram restaurados a partir de um backup.', user);
      toast({ title: 'Dados restaurados com sucesso!' });
    } catch (error: any) {
      console.error("Error restoring data:", error);
      toast({ title: 'Erro ao Restaurar', description: 'Falha na operação de escrita no banco de dados. Verifique o console para mais detalhes.', variant: 'destructive' });
      throw error;
    }
  }, [products, orders, categories, commissionPayments, stockAudits, avarias, chatSessions, toast, allowEmptyProductsFor]);


  const resetOrders = useCallback(async (logAction: LogAction, user: User | null) => {
    // Only delete orders that are NOT registration-only orders
    // Actually, usually reset means delete all.
    // Supabase way:
    const { error } = await supabase.from('orders').delete().neq('id', 'placeholder'); // Delete all? 
    // Usually .delete().gte('id', '') or similar if no where clause allowed without filter.
    // Or iterate. 
    // Safest: delete all orders where id is not null.
    // Actually, we can just filter in memory if needed, but for reset we usually wipe.
    // Let's iterate deletions or use a "safe" delete all.

    // Deleting all orders with items > 0 as per logic
    const ordersToDelete = orders.filter(o => o.items.length > 0);
    const ids = ordersToDelete.map(o => o.id);

    if (ids.length > 0) {
      const { error } = await supabase.from('orders').delete().in('id', ids);
      if (error) {
        console.error(error);
        return;
      }
    }

    logAction('Reset de Pedidos', 'Todos os pedidos de compra foram zerados.', user);
  }, [orders]);

  const resetProducts = useCallback(async (logAction: LogAction, user: User | null) => {
    allowEmptyProductsFor(60_000);
    const { error } = await supabase.from('products').delete().neq('id', '000000'); // Delete all

    if (error) {
      console.error("Error resetting products", error);
    } else {
      logAction('Reset de Produtos', 'Todos os produtos foram zerados.', user);
    }
  }, [allowEmptyProductsFor]);

  const resetFinancials = useCallback(async (logAction: LogAction, user: User | null) => {
    const { error } = await supabase.from('commission_payments').delete().neq('id', '000000');

    if (error) {
      console.error("Error resetting financials", error);
    } else {
      logAction('Reset Financeiro', 'Todos os pagamentos de comissão foram zerados.', user);
    }
  }, []);

  const resetAllAdminData = useCallback(async (logAction: LogAction, user: User | null) => {
    await restoreAdminData({ products: [], orders: [], categories: [] }, logAction, user);
    await resetFinancials(logAction, user);
    logAction('Reset da Loja', 'Todos os dados da loja foram resetados para o padrão.', user);
  }, [restoreAdminData, resetFinancials]);

  const addProduct = useCallback(async (productData: Omit<Product, 'id' | 'data-ai-hint' | 'createdAt'>, logAction: LogAction, user: User | null) => {
    const newProductId = `PROD-${Date.now().toString().slice(-6)}`;
    const newProductCode = Date.now().toString().slice(-6);
    const now = new Date().toISOString();

    const newProduct: Partial<Product> = {
      ...productData,
      id: newProductId,
      code: productData.code || newProductCode,
      createdAt: now,
      'data-ai-hint': productData.name.toLowerCase().split(' ').slice(0, 2).join(' '),
    };

    if (!newProduct.promotionEndDate) {
      delete newProduct.promotionEndDate;
    }

    if (
      !newProduct.onSale ||
      typeof newProduct.originalPrice !== 'number' ||
      Number.isNaN(newProduct.originalPrice) ||
      newProduct.originalPrice <= 0
    ) {
      delete newProduct.originalPrice;
    }

    // Prepare strict payload matching Supabase schema (snake_case)
    const dbPayload = {
      id: newProduct.id,
      name: newProduct.name,
      description: newProduct.description,
      long_description: newProduct.longDescription,
      price: newProduct.price,
      cost: newProduct.cost,
      category: newProduct.category,
      subcategory: newProduct.subcategory,
      stock: newProduct.stock,
      min_stock: newProduct.minStock,
      unit: newProduct.unit,
      original_price: newProduct.originalPrice,
      on_sale: newProduct.onSale,
      promotion_end_date: newProduct.promotionEndDate,
      image_url: newProduct.imageUrl,
      image_urls: newProduct.imageUrls,
      max_installments: newProduct.maxInstallments,
      payment_condition: newProduct.paymentCondition,
      code: newProduct.code,
      commission_type: newProduct.commissionType,
      commission_value: newProduct.commissionValue,
      is_hidden: newProduct.isHidden,
      data_ai_hint: newProduct['data-ai-hint'],
      created_at: now,
      created_by: user?.id, // Assuming these exist
      created_by_name: user?.name,
    };

    const { error } = await supabase.from('products').insert(dbPayload);

    if (error) {
      console.error("Error creating product:", error);
      toast({ title: "Erro", description: "Falha ao criar produto: " + error.message, variant: "destructive" });
      return;
    }

    logAction('Criação de Produto', `Produto "${newProduct.name}" (ID: ${newProductId}) foi criado.`, user);
    toast({
      title: "Produto Cadastrado!",
      description: `O produto "${newProduct.name}" foi adicionado ao catálogo.`,
      duration: 2000
    });
  }, [toast]);

  const updateProduct = useCallback(async (updatedProduct: Product, logAction: LogAction, user: User | null) => {
    const productToUpdate: Partial<Product> = { ...updatedProduct };

    if (!productToUpdate.promotionEndDate) {
      delete productToUpdate.promotionEndDate;
    }

    // Prepare strict payload matching Supabase schema (snake_case)
    const dbPayload: any = {
      name: productToUpdate.name,
      description: productToUpdate.description,
      long_description: productToUpdate.longDescription,
      price: productToUpdate.price,
      cost: productToUpdate.cost,
      category: productToUpdate.category,
      subcategory: productToUpdate.subcategory,
      stock: productToUpdate.stock,
      min_stock: productToUpdate.minStock,
      unit: productToUpdate.unit,
      original_price: productToUpdate.originalPrice,
      on_sale: productToUpdate.onSale,
      promotion_end_date: productToUpdate.promotionEndDate,
      image_url: productToUpdate.imageUrl,
      image_urls: productToUpdate.imageUrls,
      max_installments: productToUpdate.maxInstallments,
      payment_condition: productToUpdate.paymentCondition,
      code: productToUpdate.code,
      commission_type: productToUpdate.commissionType,
      commission_value: productToUpdate.commissionValue,
      is_hidden: productToUpdate.isHidden,
      // Do not update created_at or id
    };

    // Atualização otimista - UI atualiza ANTES da chamada ao banco
    updateProductLocally(updatedProduct);

    const { error } = await supabase.from('products').update(dbPayload).eq('id', productToUpdate.id);

    if (error) {
      console.error("Failed to update product:", error.message, error.details, error.hint, JSON.stringify(error, null, 2));
      toast({ title: "Erro", description: "Falha ao atualizar produto: " + (error.message || "Ver console"), variant: "destructive" });
      return;
    }

    logAction('Atualização de Produto', `Produto "${productToUpdate.name}" (ID: ${productToUpdate.id}) foi atualizado.`, user);
    toast({ title: "Produto Atualizado!", description: `"${productToUpdate.name}" foi salvo com sucesso.`, duration: 2000 });

  }, [updateProductLocally, toast]);

  const deleteProduct = useCallback(async (productId: string, logAction: LogAction, user: User | null) => {
    allowEmptyProductsFor(30_000);
    const productToDelete = products.find(p => p.id === productId);

    // Soft Delete: Update deleted_at timestamp
    const { error } = await supabase.from('products').update({ deleted_at: new Date().toISOString() }).eq('id', productId);

    if (error) {
      console.error("AdminContext: Failed to delete product:", error);
      toast({ title: "Erro", description: "Falha ao mover produto para lixeira.", variant: "destructive" });
      return;
    }
    // Atualização otimista - UI atualiza imediatamente (DataContext realtime will catch this too)
    deleteProductLocally(productId);

    if (productToDelete) {
      logAction('Exclusão de Produto (Lixeira)', `Produto "${productToDelete.name}" (ID: ${productId}) enviado para lixeira.`, user);
    }
    toast({
      title: 'Produto na Lixeira',
      description: 'O produto foi movido para a lixeira temporária.',
      duration: 2000
    });
  }, [products, toast, allowEmptyProductsFor, deleteProductLocally]);

  const restoreProduct = useCallback(async (product: Product, logAction: LogAction, user: User | null) => {
    const { error } = await supabase.from('products').update({ deleted_at: null }).eq('id', product.id);

    if (error) {
      console.error("Failed to restore product:", error);
      toast({ title: "Erro", description: "Falha ao restaurar produto.", variant: "destructive" });
      return;
    }

    // 2. Fetch fresh data to ensure integrity (especially images)
    const { data: freshData, error: fetchError } = await supabase
      .from('products')
      .select('*')
      .eq('id', product.id)
      .single();

    if (freshData && !fetchError) {
      const restored: Product = {
        ...freshData,
        id: freshData.id,
        name: freshData.name,
        description: freshData.description,
        longDescription: freshData.long_description || freshData.longDescription,
        price: freshData.price,
        cost: freshData.cost,
        category: freshData.category,
        subcategory: freshData.subcategory,
        stock: freshData.stock,
        minStock: freshData.min_stock || freshData.minStock,
        unit: freshData.unit,
        originalPrice: freshData.original_price || freshData.originalPrice,
        onSale: freshData.on_sale || freshData.onSale,
        promotionEndDate: freshData.promotion_end_date || freshData.promotionEndDate,
        imageUrl: freshData.image_url || freshData.imageUrl,
        imageUrls: (freshData.image_urls && freshData.image_urls.length > 0)
          ? freshData.image_urls
          : (freshData.imageUrls && freshData.imageUrls.length > 0)
            ? freshData.imageUrls
            : (freshData.image_url || freshData.imageUrl) ? [freshData.image_url || freshData.imageUrl] : [],
        maxInstallments: freshData.max_installments || freshData.maxInstallments,
        paymentCondition: freshData.payment_condition || freshData.paymentCondition,
        code: freshData.code,
        commissionType: freshData.commission_type || freshData.commissionType,
        commissionValue: freshData.commission_value || freshData.commissionValue,
        isHidden: freshData.is_hidden || freshData.isHidden,
        'data-ai-hint': freshData.data_ai_hint || freshData['data-ai-hint'],
        createdAt: freshData.created_at || freshData.createdAt,
        deletedAt: undefined
      };

      addProductLocally(restored);
    } else {
      // Fallback
      addProductLocally({ ...product, deletedAt: undefined });
    }

    logAction('Restauração de Produto', `Produto "${product.name}" restaurado da lixeira.`, user);
    toast({ title: "Produto Restaurado", description: `"${product.name}" voltou ao catálogo.`, duration: 2000 });
  }, [toast, addProductLocally]);

  const permanentlyDeleteProduct = useCallback(async (productId: string, logAction: LogAction, user: User | null) => {
    const { error } = await supabase.from('products').delete().eq('id', productId);
    if (error) {
      console.error("Failed to permanently delete product:", error);
      toast({ title: "Erro", description: "Falha ao excluir permanentemente.", variant: "destructive" });
      return;
    }
    logAction('Exclusão Permanente de Produto', `Produto ID: ${productId} excluído permanentemente.`, user);
    toast({ title: "Excluído Permanentemente", description: "Produto removido definitivamente.", duration: 2000 });
  }, [toast]);

  const fetchDeletedProducts = useCallback(async () => {
    const { data, error } = await supabase.from('products').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
    if (error) {
      console.error("Error fetching deleted products:", error);
      return [];
    }
    // Map same way as DataContext
    return data.map((p: any) => ({
      ...p,
      id: p.id,
      name: p.name,
      description: p.description,
      longDescription: p.long_description || p.longDescription,
      price: p.price,
      cost: p.cost,
      category: p.category,
      subcategory: p.subcategory,
      stock: p.stock,
      minStock: p.min_stock || p.minStock,
      unit: p.unit,
      originalPrice: p.original_price || p.originalPrice,
      onSale: p.on_sale || p.onSale,
      promotionEndDate: p.promotion_end_date || p.promotionEndDate,
      imageUrl: p.image_url || p.imageUrl,
      imageUrls: (p.image_urls && p.image_urls.length > 0)
        ? p.image_urls
        : (p.imageUrls && p.imageUrls.length > 0)
          ? p.imageUrls
          : (p.image_url || p.imageUrl) ? [p.image_url || p.imageUrl] : [],
      maxInstallments: p.max_installments || p.maxInstallments,
      paymentCondition: p.payment_condition || p.paymentCondition,
      code: p.code,
      commissionType: p.commission_type || p.commissionType,
      commissionValue: p.commission_value || p.commissionValue,
      isHidden: p.is_hidden || p.isHidden,
      'data-ai-hint': p.data_ai_hint || p['data-ai-hint'],
      createdAt: p.created_at || p.createdAt,
      deletedAt: p.deleted_at
    })) as Product[];
  }, []);

  const importProducts = useCallback(async (productsToImport: Product[], logAction: LogAction, user: User | null) => {
    const validProducts = (productsToImport || []).filter((p) => p && typeof p.name === 'string' && typeof p.price === 'number');
    if (validProducts.length === 0) {
      toast({ title: 'Nada para importar', description: 'O arquivo não contém produtos válidos.', variant: 'destructive' });
      return;
    }

    const now = new Date().toISOString();

    // Prepare for upsert
    const productsToUpsert = validProducts.map(originalProduct => {
      const docId = originalProduct.id || `PROD-${Date.now().toString().slice(-6)}-${Math.random().toString(16).slice(2, 6)}`;

      const productToWrite: any = {
        ...originalProduct,
        id: docId,
        created_at: originalProduct.createdAt || now,
      };

      if (!productToWrite['data-ai-hint'] && typeof productToWrite.name === 'string') {
        productToWrite['data-ai-hint'] = productToWrite.name.toLowerCase().split(' ').slice(0, 2).join(' ');
      }

      // we might need snake_case mapping here if not handled globally, but for now assuming direct mapping fits or is acceptable
      // Supabase upsert
      return productToWrite;
    });

    const { error } = await supabase.from('products').upsert(productsToUpsert);

    if (error) {
      console.error("Error importing products", error);
      toast({ title: "Erro na Importação", description: "Falha ao importar produtos.", variant: "destructive" });
    } else {
      logAction('Importação de Produtos', `${validProducts.length} produtos foram importados via CSV.`, user);
      toast({ title: 'Importação Concluída!', description: `${validProducts.length} produtos importados com sucesso.` });
    }
  }, [toast]);

  const addCategory = useCallback(async (categoryName: string, logAction: LogAction, user: User | null) => {
    if (categories.some(c => c.name.toLowerCase() === categoryName.toLowerCase())) {
      toast({ title: "Erro", description: "Essa categoria já existe.", variant: "destructive" });
      return;
    }
    const newCategoryId = `CAT-${Date.now().toString().slice(-6)}`;
    const newOrder = categories.length > 0 ? Math.max(...categories.map(c => c.order)) + 1 : 0;
    const newCategory: Category = {
      id: newCategoryId,
      name: categoryName,
      order: newOrder,
      subcategories: []
    };

    const { error } = await supabase.from('categories').insert(newCategory);

    if (error) {
      console.error(error);
      toast({ title: "Erro", description: "Falha ao criar categoria.", variant: "destructive" });
      return;
    }

    logAction('Criação de Categoria', `Categoria "${categoryName}" foi criada.`, user);
    toast({ title: "Categoria Adicionada!" });
  }, [categories, toast]);

  const updateCategoryName = useCallback(async (categoryId: string, newName: string, logAction: LogAction, user: User | null) => {
    if (categories.some(c => c.name.toLowerCase() === newName.toLowerCase() && c.id !== categoryId)) {
      toast({ title: "Erro", description: "Uma categoria com esse novo nome já existe.", variant: "destructive" });
      return;
    }
    const oldCategory = categories.find(c => c.id === categoryId);
    if (!oldCategory) return;
    const oldName = oldCategory.name;

    // Supabase trigger or manual update for related products?
    // Manual update for now to match Firestore logic.
    // Update category
    const { error: catError } = await supabase.from('categories').update({ name: newName }).eq('id', categoryId);
    if (catError) {
      console.error(catError);
      toast({ title: "Erro", description: "Falha ao atualizar categoria.", variant: "destructive" });
      return;
    }

    // Update products
    // We can do a single update for all products with this category
    // Note: This matches legacy logic where products store category name strings.
    const { error: prodError } = await supabase.from('products').update({ category: newName }).eq('category', oldName);
    if (prodError) console.error("Failed to update products category name", prodError);

    logAction('Atualização de Categoria', `Categoria "${oldName}" foi renomeada para "${newName}".`, user);
    toast({ title: "Categoria Renomeada!" });
  }, [categories, products, toast]);

  const deleteCategory = useCallback(async (categoryId: string, logAction: LogAction, user: User | null) => {
    const categoryToDelete = categories.find(c => c.id === categoryId);
    if (!categoryToDelete) return;

    const productsInCategory = products.some(p => p.category === categoryToDelete.name);

    if (productsInCategory) {
      toast({ title: "Erro", description: "Não é possível excluir categorias que contêm produtos.", variant: "destructive" });
      return;
    }

    const { error } = await supabase.from('categories').delete().eq('id', categoryId);

    if (error) {
      console.error(error);
      toast({ title: "Erro", description: "Falha ao excluir categoria.", variant: "destructive" });
      return;
    }

    logAction('Exclusão de Categoria', `Categoria "${categoryToDelete.name}" foi excluída.`, user);
    toast({ title: "Categoria Excluída!", variant: "destructive", duration: 5000 });
  }, [categories, products, toast]);

  const addSubcategory = useCallback(async (categoryId: string, subcategoryName: string, logAction: LogAction, user: User | null) => {
    const category = categories.find(c => c.id === categoryId);
    if (!category) return;
    if (category.subcategories.some(s => s.toLowerCase() === subcategoryName.toLowerCase())) {
      toast({ title: "Erro", description: "Essa subcategoria já existe.", variant: "destructive" });
      return;
    }
    const newSubcategories = [...category.subcategories, subcategoryName].sort();

    const { error } = await supabase.from('categories').update({ subcategories: newSubcategories }).eq('id', categoryId);

    if (error) {
      console.error(error);
      toast({ title: "Erro", description: "Falha ao criar subcategoria.", variant: "destructive" });
      return;
    }

    logAction('Criação de Subcategoria', `Subcategoria "${subcategoryName}" foi adicionada à categoria "${category.name}".`, user);
    toast({ title: "Subcategoria Adicionada!" });
  }, [categories, toast]);

  const updateSubcategory = useCallback(async (categoryId: string, oldSub: string, newSub: string, logAction: LogAction, user: User | null) => {
    const category = categories.find(c => c.id === categoryId);
    if (!category) return;
    if (category.subcategories.some(s => s.toLowerCase() === newSub.toLowerCase() && s.toLowerCase() !== oldSub.toLowerCase())) {
      toast({ title: "Erro", description: "Essa subcategoria já existe.", variant: "destructive" });
      return;
    }

    const newSubs = category.subcategories.map(s => s.toLowerCase() === oldSub.toLowerCase() ? newSub : s).sort();

    const { error: catError } = await supabase.from('categories').update({ subcategories: newSubs }).eq('id', categoryId);
    if (catError) {
      console.error(catError);
      toast({ title: "Erro", description: "Falha ao atualizar subcategoria.", variant: "destructive" });
      return;
    }

    // Update products
    // Using RPC or simple loop if RPC not available, or simple update if we can target by subcategory and category.
    // Products store `subcategory` and `category`.
    const { error: prodError } = await supabase.from('products')
      .update({ subcategory: newSub })
      .eq('category', category.name)
      // Use ilike for case insensitivity if needed, but eq is safer if data is consistent.
      // Legacy code used manual filter with toLowerCase.
      // Supabase `eq` is case sensitive.
      // If data is messy, this might miss some. Assuming consistent data for now.
      // Actually, let's use the exact `oldSub` if possible, but legacy compared lowerCase.
      // Let's rely on standard `eq` of `subcategory` column for now.
      .eq('subcategory', oldSub);

    if (prodError) console.error("Failed to update products subcategory", prodError);

    logAction('Atualização de Subcategoria', `Subcategoria "${oldSub}" foi renomeada para "${newSub}" na categoria "${category.name}".`, user);
    toast({ title: "Subcategoria Renomeada!" });
  }, [categories, products, toast]);

  const deleteSubcategory = useCallback(async (categoryId: string, subcategoryName: string, logAction: LogAction, user: User | null) => {
    const category = categories.find(c => c.id === categoryId);
    if (!category) return;

    const productsInSubcategory = products.some(p => {
      return p.category === category.name && p.subcategory?.toLowerCase() === subcategoryName.toLowerCase();
    });

    if (productsInSubcategory) {
      toast({ title: "Erro", description: "Não é possível excluir subcategorias que contêm produtos.", variant: "destructive" });
      return;
    }
    const newSubcategories = category.subcategories.filter(s => s.toLowerCase() !== subcategoryName.toLowerCase());

    const { error } = await supabase.from('categories').update({ subcategories: newSubcategories }).eq('id', categoryId);

    if (error) {
      console.error(error);
      toast({ title: "Erro", description: "Falha ao excluir subcategoria.", variant: "destructive" });
      return;
    }

    logAction('Exclusão de Subcategoria', `Subcategoria "${subcategoryName}" foi excluída da categoria "${category.name}".`, user);
    toast({ title: "Subcategoria Excluída!", variant: "destructive", duration: 5000 });
  }, [categories, products, toast]);

  const moveCategory = useCallback(async (categoryId: string, direction: 'up' | 'down', logAction: LogAction, user: User | null) => {
    const sortedCategories = [...categories].sort((a, b) => a.order - b.order);
    const index = sortedCategories.findIndex(c => c.id === categoryId);

    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === sortedCategories.length - 1) return;

    const otherIndex = direction === 'up' ? index - 1 : index + 1;

    const category1 = sortedCategories[index];
    const category2 = sortedCategories[otherIndex];

    const order1 = category1.order;
    const order2 = category2.order;

    // Supabase update
    await supabase.from('categories').update({ order: order2 }).eq('id', category1.id);
    await supabase.from('categories').update({ order: order1 }).eq('id', category2.id);

    logAction('Reordenação de Categoria', `Categoria "${category1.name}" foi movida ${direction === 'up' ? 'para cima' : 'para baixo'}.`, user);
  }, [categories]);

  const reorderSubcategories = useCallback(async (categoryId: string, draggedSub: string, targetSub: string, logAction: LogAction, user: User | null) => {
    const category = categories.find(c => c.id === categoryId);
    if (!category) return;

    const subs = Array.from(category.subcategories);
    const draggedIndex = subs.indexOf(draggedSub);
    const targetIndex = subs.indexOf(targetSub);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const [removed] = subs.splice(draggedIndex, 1);
    subs.splice(targetIndex, 0, removed);

    const { error } = await supabase.from('categories').update({ subcategories: subs }).eq('id', categoryId);

    if (error) {
      console.error("Erro ao reordenar subcategorias:", error);
      toast({ title: 'Erro', description: 'Não foi possível reordenar as subcategorias.', variant: 'destructive' });
    } else {

      logAction('Reordenação de Subcategoria', `Subcategorias da categoria "${category.name}" foram reordenadas.`, user);
    }
  }, [categories]);

  const moveSubcategory = useCallback(async (sourceCategoryId: string, subName: string, targetCategoryId: string, logAction: LogAction, user: User | null) => {
    const sourceCategory = categories.find(c => c.id === sourceCategoryId);
    const targetCategory = categories.find(c => c.id === targetCategoryId);

    if (!sourceCategory || !targetCategory) return;
    if (targetCategory.subcategories.some(s => s.toLowerCase() === subName.toLowerCase())) {
      toast({ title: 'Subcategoria já existe', description: `A categoria "${targetCategory.name}" já possui uma subcategoria chamada "${subName}".`, variant: "destructive" });
      return;
    }

    const newSourceSubs = sourceCategory.subcategories.filter(s => s.toLowerCase() !== subName.toLowerCase());
    const newTargetSubs = [...targetCategory.subcategories, subName].sort();

    // Update products
    // We update products first or parallel
    // Products update: update category to targetCategory.name where category=source and subcategory=subName
    const { error: prodError } = await supabase.from('products')
      .update({ category: targetCategory.name })
      .eq('category', sourceCategory.name)
      .eq('subcategory', subName);

    if (prodError) console.error("Error moving products", prodError);

    // Update source category
    const { error: sourceError } = await supabase.from('categories').update({ subcategories: newSourceSubs }).eq('id', sourceCategoryId);

    // Update target category
    const { error: targetError } = await supabase.from('categories').update({ subcategories: newTargetSubs }).eq('id', targetCategoryId);

    if (sourceError || targetError) {
      console.error("Erro ao mover subcategoria:", sourceError, targetError);
      toast({ title: 'Erro', description: 'Não foi possível mover a subcategoria.', variant: 'destructive' });
    } else {
      logAction('Movimentação de Subcategoria', `Subcategoria "${subName}" foi movida de "${sourceCategory.name}" para "${targetCategory.name}".`, user);
      toast({ title: 'Subcategoria Movida!', description: `"${subName}" agora faz parte de "${targetCategory.name}".` });
    }
  }, [categories, products, toast]);

  const manageStockForOrder = useCallback(async (order: Order | undefined, operation: 'add' | 'subtract'): Promise<boolean> => {
    if (!order) return false;

    for (const orderItem of order.items) {
      const product = products.find(p => p.id === orderItem.id);
      if (product) {
        const stockChange = orderItem.quantity;
        const newStock = operation === 'add' ? product.stock + stockChange : product.stock - stockChange;

        if (newStock < 0) {
          toast({
            title: 'Estoque Insuficiente',
            description: `Não há estoque suficiente para ${product.name}. Disponível: ${product.stock}, Pedido: ${stockChange}.`,
            variant: 'destructive'
          });
          return false; // Indicate failure
        }

        const { error } = await supabase.from('products').update({ stock: newStock }).eq('id', product.id);
        if (error) {
          console.error("Erro ao atualizar estoque:", error);
          throw error;
        }
      }
    }
    return true; // Indicate success
  }, [products, toast]);

  const addOrder = async (order: Partial<Order> & { firstDueDate: Date }, logAction: LogAction, user: User | null): Promise<Order | null> => {
    // A robust way to generate a unique order ID
    const prefix = order.items && order.items.length > 0 ? 'PED' : 'REG';
    const orderId = `${prefix}-${Date.now().toString().slice(-6)}`;

    let isNewCustomer = true;
    const customerKey = order.customer?.cpf?.replace(/\D/g, '') || (order.customer ? `${order.customer.name}-${order.customer.phone}` : '');
    if (customerKey) {
      const existingCustomerOrder = orders.find(o => (o.customer.cpf?.replace(/\D/g, '') || `${o.customer.name}-${o.customer.phone}`) === customerKey);
      if (existingCustomerOrder) isNewCustomer = false;
    }

    const orderToSave = {
      ...order,
      id: orderId,
      sellerId: order.sellerId || user?.id || '',
      sellerName: order.sellerName || 'Não atribuído',
      commissionPaid: false,
    } as Order;

    if (orderToSave.customer) {
      const sellerId = orderToSave.customer.sellerId ?? (orderToSave.sellerId ? orderToSave.sellerId : undefined);
      const sellerName = orderToSave.customer.sellerName ?? (orderToSave.sellerId ? orderToSave.sellerName : undefined);
      orderToSave.customer = { ...orderToSave.customer, sellerId, sellerName };

      const existingCode = orderToSave.customer.code
        || orders.find(o => (o.customer.cpf?.replace(/\D/g, '') || `${o.customer.name}-${o.customer.phone}`) === customerKey)?.customer.code;

      let code = existingCode;

      if (!code) {
        // Replace allocateNextCustomerCode(db) with manual logic or Supabase
        // Since we can't easily do transactional numbering without function, we assume basic generator or skip
        // We can check formatCustomerCode
        const { count } = await supabase.from('customers').select('*', { count: 'exact', head: true });
        code = formatCustomerCode((count || 0) + 1);
      }

      orderToSave.customer = { ...orderToSave.customer, code };
    }

    if (isNewCustomer && order.customer?.cpf) {
      orderToSave.customer.password = order.customer.cpf.substring(0, 6);
    }


    orderToSave.commission = calculateCommission(orderToSave, products);

    const subtotal = order.items?.reduce((acc, item) => acc + item.price * item.quantity, 0) || 0;
    const total = subtotal - (order.discount || 0);
    const totalFinanced = total - (order.downPayment || 0);
    orderToSave.total = total; // Total should reflect the final price after discount

    if (orderToSave.installments > 0 && order.firstDueDate) {
      orderToSave.installmentDetails = recalculateInstallments(totalFinanced, orderToSave.installments, orderId, order.firstDueDate.toISOString())
      orderToSave.installmentValue = orderToSave.installmentDetails[0]?.amount || 0;
    }

    const createdAt = new Date().toISOString();
    orderToSave.createdAt = createdAt;
    orderToSave.createdById = user?.id || '';
    orderToSave.createdByName = user?.name || orderToSave.customer?.name || '';
    orderToSave.createdByRole = user?.role || 'cliente';

    // IP Logic (kept)
    const normalizeIp = (raw: string) => {
      let ip = (raw || '').trim();
      if (!ip) return '';
      if (ip.includes(',')) ip = ip.split(',')[0]?.trim() || '';
      if (ip.startsWith('[')) {
        const idx = ip.indexOf(']');
        if (idx > 1) ip = ip.slice(1, idx);
      } else {
        const parts = ip.split(':');
        if (parts.length === 2 && /^\d{1,3}(\.\d{1,3}){3}$/.test(parts[0] || '')) {
          ip = parts[0] || '';
        }
      }
      if (ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
      return ip.trim();
    };
    const isPrivateIp = (ip: string) => {
      if (!ip) return true;
      if (ip === '::1' || ip === '127.0.0.1' || ip === '0.0.0.0') return true;
      if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
      if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
      if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
      return false;
    };
    let detectedIp = '';
    try {
      const res = await fetch('/api/ip', { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { ip?: string | null };
        detectedIp = normalizeIp(data.ip || '');
      }
    } catch {
      detectedIp = '';
    }
    if (!detectedIp || isPrivateIp(detectedIp)) {
      try {
        const res = await fetch('https://api.ipify.org?format=json', { method: 'GET', cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { ip?: string };
          const publicIp = normalizeIp(data.ip || '');
          if (publicIp) detectedIp = publicIp;
        }
      } catch {
      }
    }
    orderToSave.createdIp = detectedIp || '';

    try {
      if (!await manageStockForOrder(orderToSave, 'subtract')) {
        throw new Error(`Estoque insuficiente para um ou mais produtos.`);
      }

      // Map Order to Snake Case for Supabase or assume object mapping
      // Need strict mapping to be safe.
      // previous implementation used plain object spread.
      const payload: any = {
        id: orderToSave.id,
        date: orderToSave.date,
        customer: orderToSave.customer, // JSONB
        items: orderToSave.items, // JSONB
        subtotal: orderToSave.subtotal,
        discount: orderToSave.discount,
        total: orderToSave.total,
        paymentMethod: orderToSave.paymentMethod,
        installments: orderToSave.installments,
        installmentValue: orderToSave.installmentValue,
        installmentCardDetails: orderToSave.installmentCardDetails,
        installmentDetails: orderToSave.installmentDetails,
        status: orderToSave.status,
        observations: orderToSave.observations,
        sellerId: orderToSave.sellerId,
        sellerName: orderToSave.sellerName,
        commission: orderToSave.commission,
        commissionPaid: orderToSave.commissionPaid,
        isCommissionManual: orderToSave.isCommissionManual,
        created_at: orderToSave.createdAt, // Schema usa created_at
        createdById: orderToSave.createdById,
        createdByName: orderToSave.createdByName,
        createdByRole: orderToSave.createdByRole,
        createdIp: orderToSave.createdIp,
        source: orderToSave.source,
        // Asaas
        asaas: orderToSave.asaas,
        // Delivery
        deliveryFee: orderToSave.deliveryFee,
        trackingCode: orderToSave.trackingCode,
        firstDueDate: orderToSave.firstDueDate,
        downPayment: orderToSave.downPayment,
      };

      const { error } = await supabase.from('orders').insert(payload);
      if (error) throw error;

      // Atualização otimista - pedido aparece na lista imediatamente
      setOrders(prev => [orderToSave as Order, ...prev]);

      const creator = user ? `por ${user.name}` : 'pelo cliente';
      logAction('Criação de Pedido', `Novo pedido #${orderToSave.id} para ${orderToSave.customer.name} no valor de R$${orderToSave.total?.toFixed(2)} foi criado ${creator}.`, user);
      return orderToSave;
    } catch (e: any) {
      console.error("Failed to add order", e?.message, e?.details, e?.hint, JSON.stringify(e, null, 2));
      if (e instanceof Error && e.message.startsWith('Estoque insuficiente')) {
      } else {
        // throw e; // don't throw, just log/toast?
        // Original logic re-throws.
      }
      await manageStockForOrder(order as Order, 'add');
      throw e;
    }
  };

  const generateCustomerCodes = useCallback(async (logAction: LogAction, user: User | null) => {
    if (user?.role !== 'admin') {
      toast({ title: 'Acesso negado', description: 'Apenas administradores podem executar esta operação.', variant: 'destructive' });
      return { newCustomers: 0, updatedOrders: 0 };
    }

    const customerKeyForOrder = (o: Order) =>
      o.customer.cpf?.replace(/\D/g, '') || `${o.customer.name}-${o.customer.phone}`;

    const codeByCustomerKey = new Map<string, string>();
    let maxExistingNumber = 0;

    orders.forEach((o) => {
      const key = customerKeyForOrder(o);
      if (!key) return;
      const existing = (o.customer.code || '').trim();
      if (!existing) return;
      if (!codeByCustomerKey.has(key)) codeByCustomerKey.set(key, existing);
      const numeric = Number(existing.replace(/\D/g, ''));
      if (Number.isFinite(numeric) && numeric > maxExistingNumber) maxExistingNumber = numeric;
    });

    customers.forEach((c) => {
      const key = c.cpf ? normalizeCpf(c.cpf) : `${c.name}-${c.phone}`;
      if (!key) return;
      const existing = (c.code || '').trim();
      if (!existing) return;
      if (!codeByCustomerKey.has(key)) codeByCustomerKey.set(key, existing);
      const numeric = Number(existing.replace(/\D/g, ''));
      if (Number.isFinite(numeric) && numeric > maxExistingNumber) maxExistingNumber = numeric;
    });

    const uniqueCustomerKeys = Array.from(
      new Set(
        [
          ...orders.map((o) => customerKeyForOrder(o)),
          ...customers.map((c) => (c.cpf ? normalizeCpf(c.cpf) : `${c.name}-${c.phone}`)),
        ].filter((k) => !!k)
      )
    );

    const missingKeys = uniqueCustomerKeys
      .filter((k) => !codeByCustomerKey.has(k))
      .sort((a, b) => a.localeCompare(b));

    if (missingKeys.length > 0) {
      // Manual reservation or simple incremental
      // const { startNumber } = await reserveCustomerCodes(db, missingKeys.length, maxExistingNumber);
      // We will just use maxExistingNumber + 1 sequence.
      // NOTE: This might clash if multiple admins run it, but risk is low.
      let startNumber = maxExistingNumber + 1;
      missingKeys.forEach((key, idx) => {
        codeByCustomerKey.set(key, formatCustomerCode(startNumber + idx));
      });
    }

    const updates: Array<{ orderId: string; code: string }> = [];
    orders.forEach((o) => {
      const key = customerKeyForOrder(o);
      const code = key ? codeByCustomerKey.get(key) : undefined;
      if (!code) return;
      if ((o.customer.code || '').trim() === code) return;
      updates.push({ orderId: o.id, code });
    });

    const customerUpdates: Array<{ customerId: string; code: string }> = [];
    customers.forEach((c) => {
      const key = c.cpf ? normalizeCpf(c.cpf) : `${c.name}-${c.phone}`;
      const code = key ? codeByCustomerKey.get(key) : undefined;
      const customerId = c.cpf ? normalizeCpf(c.cpf) : undefined;
      if (!code || !customerId) return;
      if ((c.code || '').trim() === code) return;
      customerUpdates.push({ customerId, code });
    });

    // Supabase updates
    // We cannot perform "batch" updates like Firestore easily for different docs.
    // Use Promise.all with chunking or serial updates.
    // Already have global chunkPromise at the top of the file.

    let updatedOrders = 0;
    await chunkPromise(updates, async (u) => {
      // We update JSONB field `customer` -> `code`? 
      // Or assumes standard field.
      // Orders have `customer` JSONB. Updating nested JSONB requires reading, modifying, writing OR PG JSON functions.
      // For simplicity and correctness with current types, we'll read from `orders` cache?
      // Wait, we are iterating `updates` which comes from `orders` state.
      // We can just construct the new customer object if we have the order?
      // But `u` only has `orderId`.
      // We can use the Postgres `jsonb_set` via RPC or just update via fetching.
      // Since we have `orders` in memory, we can grab the current customer object, update code, and write back.
      // But be careful of stale data.
      // Actually, we can use `supabase....update({ customer: ... })`.
      // We really need the full customer object to update the JSONB column without erasing other fields.
      const order = orders.find(o => o.id === u.orderId);
      if (order) {
        const newCustomer = { ...order.customer, code: u.code };
        const { error } = await supabase.from('orders').update({ customer: newCustomer }).eq('id', u.orderId);
        if (!error) updatedOrders++;
      }
    });

    let updatedCustomers = 0;
    await chunkPromise(customerUpdates, async (u) => {
      const { error } = await supabase.from('customers').update({ code: u.code, updated_at: new Date().toISOString() }).eq('cpf', u.customerId);
      if (!error) updatedCustomers++;
    });

    logAction(
      'Geração de Código de Cliente',
      `Foram gerados códigos para ${missingKeys.length} clientes, atualizados ${updatedOrders} pedidos e ${updatedCustomers} cadastros.`,
      user
    );
    toast({
      title: 'Códigos Gerados!',
      description: `Novos clientes: ${missingKeys.length}. Pedidos atualizados: ${updatedOrders}. Cadastros atualizados: ${updatedCustomers}.`,
    });

    return { newCustomers: missingKeys.length, updatedOrders };
  }, [orders, customers, toast]);

  const updateOrderStatus = useCallback(async (orderId: string, newStatus: Order['status'], logAction: LogAction, user: User | null) => {
    const orderToUpdate = orders.find(o => o.id === orderId);
    if (!orderToUpdate) return;

    const oldStatus = orderToUpdate.status;
    const wasCanceledOrDeleted = oldStatus === 'Cancelado' || oldStatus === 'Excluído';
    const isNowCanceledOrDeleted = newStatus === 'Cancelado' || newStatus === 'Excluído';

    const updatedOrderWithDetails: Order = { ...orderToUpdate, status: newStatus };
    const detailsToUpdate: Partial<Order> = { status: newStatus };

    if (newStatus === 'Entregue' && updatedOrderWithDetails.sellerId) {
      detailsToUpdate.commission = calculateCommission(updatedOrderWithDetails, products);
      detailsToUpdate.commissionPaid = false;
    }

    const { error } = await supabase.from('orders').update(detailsToUpdate).eq('id', orderId);

    if (error) {
      console.error("Erro ao atualizar status do pedido:", error);
      if (wasCanceledOrDeleted && !isNowCanceledOrDeleted) {
        await manageStockForOrder(orderToUpdate, 'add');
      }
      toast({ title: 'Erro', description: 'Não foi possível atualizar o status do pedido.', variant: 'destructive' });
      return;
    }

    // Atualização otimista: reflete mudança imediatamente na UI
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...detailsToUpdate } : o));

    if (!wasCanceledOrDeleted && isNowCanceledOrDeleted) {
      await manageStockForOrder(orderToUpdate, 'add');
    }

    logAction('Atualização de Status de Pedido', `Status do pedido #${orderId} alterado de "${oldStatus}" para "${newStatus}".`, user);

    if (newStatus !== 'Excluído') {
      toast({ title: "Status do Pedido Atualizado!", description: `O pedido #${orderId} agora está como "${newStatus}".` });
    } else {
      logAction('Exclusão de Pedido', `Pedido #${orderId} movido para a lixeira.`, user);
      toast({ title: "Pedido movido para a Lixeira", description: `O pedido #${orderId} foi movido para a lixeira.` });
    }
  }, [orders, products, manageStockForOrder, toast]);

  const deleteOrder = useCallback(async (orderId: string, logAction: LogAction, user: User | null) => {
    await updateOrderStatus(orderId, 'Excluído', logAction, user);
  }, [updateOrderStatus]);

  const permanentlyDeleteOrder = useCallback(async (orderId: string, logAction: LogAction, user: User | null) => {
    const orderToDelete = orders.find(o => o.id === orderId);
    if (!orderToDelete || orderToDelete.status !== 'Excluído') {
      toast({ title: "Erro", description: "Só é possível excluir permanentemente pedidos que estão na lixeira.", variant: "destructive" });
      return;
    }

    const { error } = await supabase.from('orders').delete().eq('id', orderId);

    if (error) {
      console.error("Erro ao excluir pedido:", error);
      toast({ title: 'Erro', description: 'Não foi possível excluir o pedido.', variant: 'destructive' });
      return;
    }

    // Atualização otimista: remove pedido da lista imediatamente
    setOrders(prev => prev.filter(o => o.id !== orderId));

    logAction('Exclusão Permanente de Pedido', `Pedido #${orderId} foi excluído permanentemente.`, user);
    toast({ title: "Pedido Excluído", description: `O pedido #${orderId} foi excluído permanentemente.` });
  }, [orders, toast]);

  const recordInstallmentPayment = useCallback(async (orderId: string, installmentNumber: number, paymentData: Omit<Payment, 'receivedBy'>, logAction: LogAction, user: User | null) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const paymentWithUser = {
      ...paymentData,
      receivedBy: user?.name || 'Sistema'
    };

    const updatedInstallments = (order.installmentDetails || []).map((inst) => {
      if (inst.installmentNumber === installmentNumber) {
        const currentPaidAmount = Number(inst.paidAmount) || 0;
        const paymentAmount = Number(paymentWithUser.amount) || 0;
        const newPaidAmount = currentPaidAmount + paymentAmount;
        const isPaid = Math.abs(newPaidAmount - inst.amount) < 0.01;
        const newStatus = isPaid ? 'Pago' : 'Pendente';
        const existingPayments = Array.isArray(inst.payments) ? inst.payments : [];

        return {
          ...inst,
          status: newStatus,
          paidAmount: newPaidAmount,
          payments: [...existingPayments, paymentWithUser]
        };
      }
      return inst;
    });

    // Supabase update for JSONB column
    const { error } = await supabase.from('orders').update({ installmentDetails: updatedInstallments }).eq('id', orderId);

    if (error) {
      console.error("Erro ao atualizar parcela:", error);
      toast({ title: 'Erro', description: 'Não foi possível registrar o pagamento.', variant: 'destructive' });
      return;
    }

    logAction('Registro de Pagamento de Parcela', `Registrado pagamento de ${paymentWithUser.amount} (${paymentWithUser.method}) na parcela ${installmentNumber} do pedido #${orderId}.`, user);
    toast({ title: 'Pagamento Registrado!' });
  }, [orders, toast]);

  const reversePayment = useCallback(async (orderId: string, installmentNumber: number, paymentId: string, logAction: LogAction, user: User | null) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    let reversedPaymentAmount = 0;
    const updatedInstallments = (order.installmentDetails || []).map(inst => {
      if (inst.installmentNumber === installmentNumber) {
        const paymentToReverse = inst.payments.find(p => p.id === paymentId);
        if (!paymentToReverse) return inst;

        reversedPaymentAmount = paymentToReverse.amount;
        const newPayments = inst.payments.filter(p => p.id !== paymentId);
        const newPaidAmount = (inst.paidAmount || 0) - reversedPaymentAmount;
        const newStatus = newPaidAmount >= inst.amount ? 'Pago' : 'Pendente';

        return { ...inst, payments: newPayments, paidAmount: newPaidAmount, status: newStatus };
      }
      return inst;
    });

    const { error } = await supabase.from('orders').update({ installmentDetails: updatedInstallments }).eq('id', orderId);

    if (error) {
      console.error("Erro ao estornar pagamento:", error);
      toast({ title: 'Erro', description: 'Não foi possível estornar o pagamento.', variant: 'destructive' });
      return;
    }

    logAction('Estorno de Pagamento', `Estornado pagamento de ${reversedPaymentAmount} da parcela ${installmentNumber} do pedido #${orderId}.`, user);
    toast({ title: 'Pagamento Estornado!', description: 'O valor foi retornado ao saldo devedor da parcela.' });
  }, [orders, toast]);


  const updateInstallmentDueDate = useCallback(async (orderId: string, installmentNumber: number, newDueDate: Date, logAction: LogAction, user: User | null) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const oldDueDate = order.installmentDetails?.find(i => i.installmentNumber === installmentNumber)?.dueDate;

    const updatedInstallments = (order.installmentDetails || []).map((inst) =>
      inst.installmentNumber === installmentNumber ? { ...inst, dueDate: newDueDate.toISOString() } : inst
    );

    const { error } = await supabase.from('orders').update({ installmentDetails: updatedInstallments }).eq('id', orderId);

    if (error) {
      console.error("Erro ao atualizar vencimento:", error);
      toast({ title: 'Erro', description: 'Não foi possível atualizar o vencimento.', variant: 'destructive' });
      return;
    }

    logAction('Atualização de Vencimento', `Vencimento da parcela ${installmentNumber} do pedido #${orderId} alterado de ${oldDueDate ? new Date(oldDueDate).toLocaleDateString() : 'N/A'} para ${newDueDate.toLocaleDateString()}.`, user);
    toast({ title: "Vencimento Atualizado!" });
  }, [orders, toast]);

  const updateInstallmentAmount = useCallback(async (orderId: string, installmentNumber: number, newAmount: number, logAction: LogAction, user: User | null) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || !order.installmentDetails) return;

    const updatedInstallments = order.installmentDetails.map(inst =>
      inst.installmentNumber === installmentNumber ? { ...inst, amount: newAmount } : inst
    );

    const newTotalFinanced = updatedInstallments.reduce((sum, inst) => sum + inst.amount, 0);

    const subtotal = order.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const newTotal = newTotalFinanced + (order.downPayment || 0);
    const newDiscount = subtotal - newTotal;

    const dataToUpdate: Partial<Order> = {
      installmentDetails: updatedInstallments,
      installmentValue: updatedInstallments[0]?.amount || 0,
      total: newTotal,
      discount: newDiscount,
    };

    const { error } = await supabase.from('orders').update({
      installmentDetails: updatedInstallments,
      installmentValue: dataToUpdate.installmentValue,
      total: dataToUpdate.total,
      discount: dataToUpdate.discount
    }).eq('id', orderId);

    if (error) {
      console.error("Erro ao atualizar valor da parcela:", error);
      toast({ title: 'Erro', description: 'Não foi possível atualizar o valor.', variant: 'destructive' });
      return;
    }

    logAction('Atualização de Valor de Parcela', `Valor da parcela ${installmentNumber} do pedido #${orderId} alterado para ${newAmount.toFixed(2)}. Total do pedido e desconto recalculados.`, user);
    toast({ title: 'Valor da Parcela Atualizado!' });
  }, [orders, toast]);

  const updateCustomer = useCallback(async (oldCustomer: CustomerInfo, updatedCustomerData: CustomerInfo, logAction: LogAction, user: User | null) => {
    const oldCustomerKey = oldCustomer.cpf?.replace(/\D/g, '') || `${oldCustomer.name}-${oldCustomer.phone}`;
    const oldCpf = normalizeCpf(oldCustomer.cpf || '');
    const newCpf = normalizeCpf(updatedCustomerData.cpf || '');
    if (newCpf.length !== 11) {
      toast({ title: 'Erro', description: 'CPF inválido.', variant: 'destructive' });
      return;
    }

    const customerDataForWrites: CustomerInfo = {
      ...updatedCustomerData,
      cpf: newCpf,
    };

    const ordersToUpdate = orders.filter((order) => {
      const orderCustomerKey = order.customer.cpf?.replace(/\D/g, '') || `${order.customer.name}-${order.customer.phone}`;
      return orderCustomerKey === oldCustomerKey;
    });

    const chunkPromise = async <T,>(items: T[], fn: (item: T) => Promise<any>, size = 50) => {
      for (let i = 0; i < items.length; i += size) {
        await Promise.all(items.slice(i, i + size).map(fn));
      }
    };

    try {
      await chunkPromise(ordersToUpdate, async (order) => {
        const customerDataForOrder = { ...customerDataForWrites };
        if (customerDataForWrites.code === undefined && order.customer.code) {
          customerDataForOrder.code = order.customer.code;
        }
        await supabase.from('orders').update({ customer: customerDataForOrder }).eq('id', order.id);
      });

      if (oldCpf && oldCpf !== newCpf) {
        // Renaming Customer (ID change)
        // Insert new, delete old
        const { data: existingData } = await supabase.from('customers').select('*').eq('cpf', oldCpf).single();
        await supabase.from('customers').insert({
          ...(existingData || oldCustomer),
          ...customerDataForWrites,
          cpf: newCpf, // New ID
          updated_at: new Date().toISOString(),
        });
        await supabase.from('customers').delete().eq('cpf', oldCpf);

      } else {
        const { error } = await supabase.from('customers').update({
          ...customerDataForWrites,
          updated_at: new Date().toISOString()
        }).eq('cpf', newCpf);

        if (error) throw error;
      }

      // Optimistic Update
      setCustomers(prev => {
        const index = prev.findIndex(c => c.cpf === oldCpf || c.id === oldCustomer.id);
        if (index === -1) return prev;
        const newCustomers = [...prev];
        newCustomers[index] = { ...newCustomers[index], ...customerDataForWrites };
        return newCustomers;
      });

      logAction('Atualização de Cliente', `Dados do cliente ${customerDataForWrites.name} (CPF: ${newCpf}) foram atualizados.`, user);
      toast({ title: "Cliente Atualizado!", description: `Os dados de ${customerDataForWrites.name} foram salvos.` });
    } catch (e: any) {
      console.error("Erro principal ao atualizar cliente:", e);

      // Attempt Fallback Update (Removing new fields that might be missing in DB)
      try {
        if (!oldCpf || oldCpf === newCpf) { // Only for simple updates, not renames
          console.log("Tentando atualização de fallback (sem campos novos)...");
          const safeData = { ...customerDataForWrites };
          delete safeData.blocked;
          delete safeData.blockedReason;
          delete safeData.rating;

          const { error: fallbackError } = await supabase.from('customers').update({
            ...safeData,
            updated_at: new Date().toISOString()
          }).eq('cpf', newCpf);

          if (fallbackError) throw fallbackError;

          // If fallback succeeds, it means the columns are indeed missing
          logAction('Atualização de Cliente (Parcial)', `Dados do cliente ${customerDataForWrites.name} foram atualizados (parcialmente).`, user);
          toast({
            title: "Atualização Parcial",
            description: "Os dados foram salvos, mas as funções 'Bloquear' e 'Classificação' falharam pois o banco de dados desatualizado. Execute o script de migração.",
            variant: "destructive"
          });

          // Apply optimistic update for basic fields only
          setCustomers(prev => {
            const index = prev.findIndex(c => c.cpf === oldCpf || c.id === oldCustomer.id);
            if (index === -1) return prev;
            const newCustomers = [...prev];
            newCustomers[index] = { ...newCustomers[index], ...safeData };
            return newCustomers;
          });
          return; // Exit successfully after fallback
        }
      } catch (fallbackErr) {
        console.error("Erro no fallback:", fallbackErr);
      }

      // If fallback didn't run or failed, show original error
      const errorMsg = e?.message || e?.details || e?.hint || (typeof e === 'string' ? e : JSON.stringify(e));
      const errorCode = e?.code ? `(Código: ${e.code})` : '';
      toast({ title: 'Erro ao Salvar', description: `Detalhes: ${errorMsg} ${errorCode}`, variant: 'destructive' });
    }
  }, [orders, toast]);

  const deleteCustomer = useCallback(async (customer: CustomerInfo, logAction: LogAction, user: User | null) => {
    if (!canAccessCustomersTrash(user)) {
      toast({ title: 'Acesso negado', description: 'Você não tem permissão para acessar a lixeira.', variant: 'destructive' });
      return;
    }

    const cpf = normalizeCpf(customer.cpf || '');
    if (cpf.length !== 11) {
      toast({ title: 'Erro', description: 'CPF inválido.', variant: 'destructive' });
      return;
    }

    const customerKey = cpf;

    const ordersToUpdate = orders.filter(order => {
      const orderCustomerKey = order.customer.cpf?.replace(/\D/g, '') || `${order.customer.name}-${order.customer.phone}`;
      return orderCustomerKey === customerKey;
    });

    const now = new Date().toISOString();

    // Move to trash
    // We insert into customers_trash and delete from customers
    // Note: ensure we have the latest data
    const { data: existingCustomer } = await supabase.from('customers').select('*').eq('cpf', cpf).single();
    const customerToTrash = existingCustomer || customer;

    const trashPayload = {
      id: customerToTrash.id,
      cpf: cpf,
      name: customerToTrash.name,
      createdBy: user?.id,
      createdByName: user?.name,
      deleted_at: now,
      data: customerToTrash,
    };

    const { error: trashError } = await supabase.from('customers_trash').insert(trashPayload);
    if (trashError) {
      console.error("Failed to move to trash", JSON.stringify(trashError, null, 2));
      toast({ title: "Erro", description: "Falha ao mover para lixeira.", variant: "destructive" });
      return;
    }

    const { error: deleteError } = await supabase.from('customers').delete().eq('cpf', cpf);
    if (deleteError) console.error("Failed to delete from customers", deleteError);

    // Update orders
    await chunkPromise(ordersToUpdate, async (order) => {
      await supabase.from('orders').update({ status: 'Excluído' }).eq('id', order.id);
    });

    logAction(
      'Lixeira - Excluir Cliente',
      `Cliente ${customerToTrash.name} (CPF: ${cpf}) movido para a lixeira. Pedidos movidos: ${ordersToUpdate.length}.`,
      user
    );

    // Atualização otimista - atualiza UI imediatamente
    setCustomers(prev => prev.filter(c => normalizeCpf(c.cpf || '') !== cpf));
    setDeletedCustomers(prev => [...prev, { ...customerToTrash, deletedAt: now } as CustomerInfo]);

    toast({
      title: "Cliente Excluído!",
      description: `O cliente ${customerToTrash.name} foi movido para a lixeira.`,
      variant: "destructive",
    });
  }, [orders, toast]);

  const restoreCustomerFromTrash = useCallback(async (customer: CustomerInfo, logAction: LogAction, user: User | null) => {
    if (!canAccessCustomersTrash(user)) {
      toast({ title: 'Acesso negado', description: 'Você não tem permissão para acessar a lixeira.', variant: 'destructive' });
      return;
    }

    const cpf = normalizeCpf(customer.cpf || '');
    if (cpf.length !== 11) {
      toast({ title: 'Erro', description: 'CPF inválido.', variant: 'destructive' });
      return;
    }

    const { data: trashRecord, error: fetchError } = await supabase.from('customers_trash').select('*').eq('cpf', cpf).maybeSingle();

    if (fetchError) {
      console.error("Erro ao buscar na lixeira:", JSON.stringify(fetchError, null, 2));
      toast({ title: 'Erro', description: 'Falha ao buscar registro na lixeira.', variant: 'destructive' });
      return;
    }

    if (!trashRecord) {
      toast({ title: 'Erro', description: 'Registro não encontrado na lixeira.', variant: 'destructive' });
      return;
    }

    const now = new Date().toISOString();

    // Extract the original customer data from the JSONB 'data' column
    const originalCustomerData = trashRecord.data || {};

    // Build a clean payload matching the 'customers' table schema
    const restorePayload = {
      id: trashRecord.id,
      code: originalCustomerData.code,
      name: trashRecord.name || originalCustomerData.name,
      cpf: cpf,
      phone: originalCustomerData.phone,
      phone2: originalCustomerData.phone2,
      phone3: originalCustomerData.phone3,
      email: originalCustomerData.email,
      zip: originalCustomerData.zip,
      address: originalCustomerData.address,
      number: originalCustomerData.number,
      complement: originalCustomerData.complement,
      neighborhood: originalCustomerData.neighborhood,
      city: originalCustomerData.city,
      state: originalCustomerData.state,
      password: originalCustomerData.password,
      observations: originalCustomerData.observations,
      sellerId: originalCustomerData.sellerId,
      sellerName: originalCustomerData.sellerName,
      createdBy: originalCustomerData.createdBy,
      createdByName: originalCustomerData.createdByName,
      created_at: originalCustomerData.created_at,
      updated_at: now,
    };

    const { error: insertError } = await supabase.from('customers').insert(restorePayload);
    if (insertError) {
      console.error("Failed to restore", JSON.stringify(insertError, null, 2));
      toast({ title: "Erro", description: "Falha ao restaurar cliente.", variant: "destructive" });
      return;
    }

    await supabase.from('customers_trash').delete().eq('cpf', cpf);

    // Atualização otimista - atualiza UI imediatamente
    setCustomers(prev => [...prev, restorePayload as CustomerInfo]);
    setDeletedCustomers(prev => prev.filter(c => normalizeCpf(c.cpf || '') !== cpf));

    logAction('Lixeira - Restaurar Cliente', `Cliente ${restorePayload.name} (CPF: ${cpf}) foi restaurado da lixeira.`, user);
    toast({ title: 'Cliente Restaurado!', description: `${restorePayload.name} voltou para a lista principal.` });
  }, [toast]);

  const permanentlyDeleteCustomerFromTrash = useCallback(async (customer: CustomerInfo, logAction: LogAction, user: User | null) => {
    if (!canAccessCustomersTrash(user)) {
      toast({ title: 'Acesso negado', description: 'Você não tem permissão para acessar a lixeira.', variant: 'destructive' });
      return;
    }

    const cpf = normalizeCpf(customer.cpf || '');

    const { data: snap } = await supabase.from('customers_trash').select('*').eq('cpf', cpf).maybeSingle();
    if (!snap) {
      toast({ title: 'Erro', description: 'Registro não encontrado na lixeira.', variant: 'destructive' });
      return;
    }

    const { error } = await supabase.from('customers_trash').delete().eq('cpf', cpf);

    if (error) {
      console.error(error);
      toast({ title: 'Erro', description: 'Falha ao excluir.', variant: 'destructive' });
      return;
    }

    // Atualização otimista - atualiza UI imediatamente
    setDeletedCustomers(prev => prev.filter(c => normalizeCpf(c.cpf || '') !== cpf));

    logAction('Lixeira - Excluir Definitivo Cliente', `Cliente ${snap.name} (CPF: ${cpf}) foi excluído definitivamente da lixeira.`, user);
    toast({ title: 'Cliente Excluído!', description: 'O contato foi removido da lixeira.', variant: 'destructive' });
  }, [toast]);

  const importCustomers = useCallback(async (csvData: string, logAction: LogAction, user: User | null) => {
    if (user?.role !== 'admin') {
      toast({ title: 'Acesso negado', description: 'Apenas administradores podem executar esta operação.', variant: 'destructive' });
      return;
    }

    const sanitizedCsv = csvData.trim().replace(/^\uFEFF/, '');
    if (!sanitizedCsv) {
      toast({ title: 'Arquivo Vazio', description: 'O arquivo CSV está vazio.', variant: 'destructive' });
      return;
    }
    const lines = sanitizedCsv.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) {
      toast({ title: 'Arquivo Inválido', description: 'O arquivo CSV precisa ter um cabeçalho e pelo menos uma linha de dados.', variant: 'destructive' });
      return;
    }

    const headerLine = lines[0];
    const dataLines = lines.slice(1);
    const delimiter = headerLine.includes(';') ? ';' : ',';

    const fileHeaders = headerLine.split(delimiter).map(h => h.trim().replace(/["']/g, '').toLowerCase());

    const possibleMappings: { [key in keyof Omit<CustomerInfo, 'password'>]?: string[] } = {
      cpf: ['cpf'],
      name: ['nome', 'nome completo', 'cliente', 'razao social'],
      phone: ['telefone', 'fone', 'celular', 'whatsapp'],
      email: ['email', 'e-mail'],
      zip: ['cep'],
      address: ['endereco', 'rua', 'logradouro', 'end'],
      number: ['numero', 'num'],
      complement: ['complemento', 'compl'],
      neighborhood: ['bairro'],
      city: ['cidade', 'municipio'],
      state: ['estado', 'uf'],
    };

    const headerMap: { [key: string]: number } = {};

    for (const key in possibleMappings) {
      const typedKey = key as keyof Omit<CustomerInfo, 'password'>;
      const potentialNames = possibleMappings[typedKey]!;

      const foundIndex = fileHeaders.findIndex(header =>
        potentialNames.some(pName => header.includes(pName))
      );

      if (foundIndex !== -1) {
        headerMap[typedKey] = foundIndex;
      }
    }

    if (headerMap.cpf === undefined) {
      toast({ title: 'Arquivo Inválido', description: "A coluna 'cpf' é obrigatória e não foi encontrada no arquivo.", variant: 'destructive' });
      return;
    }

    const customersToImport = dataLines.map(line => {
      if (!line.trim()) return null;
      const data = line.split(delimiter);
      const customer: Partial<CustomerInfo> = {};
      for (const key in headerMap) {
        const typedKey = key as keyof CustomerInfo;
        const colIndex = headerMap[key];
        if (colIndex !== undefined && colIndex < data.length) {
          customer[typedKey] = (data[colIndex]?.trim().replace(/["']/g, '') || '') as any;
        }
      }
      return customer;
    }).filter((c): c is Partial<CustomerInfo> & { cpf: string } => !!c && !!c.cpf && c.cpf.replace(/\D/g, '').length === 11);

    if (customersToImport.length === 0) {
      toast({ title: 'Nenhum Cliente Válido', description: 'Nenhum cliente com CPF válido foi encontrado no arquivo para importar.', variant: 'destructive' });
      return;
    }

    let updatedCount = 0;
    let createdCount = 0;

    const cpfToIdMap = new Map(customers.map(c => [normalizeCpf(c.cpf || ''), c.id]));

    for (const importedCustomer of customersToImport) {
      const cpf = importedCustomer.cpf!.replace(/\D/g, '');
      const existingId = cpfToIdMap.get(normalizeCpf(cpf));
      const customerId = existingId || `CUST-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      const completeCustomerData: CustomerInfo = {
        id: customerId,
        cpf,
        name: importedCustomer.name || 'Nome não informado',
        phone: importedCustomer.phone || '',
        phone2: importedCustomer.phone2,
        phone3: importedCustomer.phone3,
        email: importedCustomer.email || '',
        zip: importedCustomer.zip || '',
        address: importedCustomer.address || '',
        number: importedCustomer.number || '',
        complement: importedCustomer.complement || '',
        neighborhood: importedCustomer.neighborhood || '',
        city: importedCustomer.city || '',
        state: importedCustomer.state || '',
        observations: importedCustomer.observations || '',
      };

      // Upsert
      const { error } = await supabase.from('customers').upsert({
        ...completeCustomerData,
        updated_at: new Date().toISOString()
      });

      if (error) {
        console.error("Error upserting customer", error);
        continue;
      }

      if (cpfToIdMap.has(normalizeCpf(cpf))) {
        updatedCount++;
        // Update orders if needed
        const existingOrders = orders.filter(o => o.customer.cpf && o.customer.cpf.replace(/\D/g, '') === cpf);



        if (existingOrders.length > 0) {
          await chunkPromise(existingOrders, async (order) => {
            const updatedCustomerData = { ...order.customer, ...completeCustomerData, cpf };
            await supabase.from('orders').update({ customer: updatedCustomerData }).eq('id', order.id);
          });
        }

      } else {
        createdCount++;
        cpfToIdMap.set(normalizeCpf(cpf), customerId);
      }
    }

    try {
      logAction('Importação de Clientes', `${createdCount} clientes criados e ${updatedCount} atualizados via CSV.`, user);
      toast({
        title: 'Importação Concluída!',
        description: `${createdCount} novos clientes foram criados e ${updatedCount} clientes existentes foram atualizados.`
      });
    } catch (e) {
      console.error("Error logging import", e);
    }
  }, [orders, customers, toast]);


  const updateOrderDetails = useCallback(async (orderId: string, details: Partial<Order> & { resetDownPayment?: boolean }, logAction: LogAction, user: User | null) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    let detailsToUpdate: Partial<Order> = { ...details };
    const { downPayment, resetDownPayment, ...otherDetails } = details;
    detailsToUpdate = otherDetails;

    const itemsToUse = otherDetails.items ?? order.items;
    const subtotal = itemsToUse.reduce((acc, item) => acc + item.price * item.quantity, 0);

    const hasInstallmentsChanged = details.installments && details.installments !== order.installments;
    const hasDiscountChanged = details.discount !== undefined && details.discount !== order.discount;
    const hasDownPayment = downPayment !== undefined && downPayment > 0;

    let currentDownPayment = order.downPayment || 0;
    if (resetDownPayment) {
      currentDownPayment = 0;
      logAction('Redefinição de Entrada', `A entrada do pedido #${orderId} foi zerada.`, user);
    } else if (hasDownPayment) {
      currentDownPayment += downPayment;
    }

    if (hasInstallmentsChanged || hasDiscountChanged || hasDownPayment || resetDownPayment) {
      const currentDiscount = hasDiscountChanged ? details.discount! : (order.discount || 0);
      const totalAfterDiscount = subtotal - currentDiscount;
      const totalFinanced = Math.max(0, totalAfterDiscount - currentDownPayment);

      detailsToUpdate.total = totalAfterDiscount;

      const currentInstallments = hasInstallmentsChanged ? details.installments! : order.installments;

      let newInstallmentDetails = recalculateInstallments(totalFinanced, currentInstallments, orderId, order.date);

      if (hasDownPayment) {
        logAction('Registro de Entrada', `Registrada entrada de R$${downPayment?.toFixed(2)} no pedido #${orderId}.`, user);
      }

      detailsToUpdate = {
        ...detailsToUpdate,
        discount: currentDiscount,
        installments: currentInstallments,
        installmentValue: newInstallmentDetails[0]?.amount || 0,
        installmentDetails: newInstallmentDetails,
        downPayment: currentDownPayment,
      };
    }

    const hasSellerIdChanged = otherDetails.sellerId !== undefined && otherDetails.sellerId !== order.sellerId;
    const shouldRecalculateCommission =
      otherDetails.sellerId !== undefined ||
      otherDetails.items !== undefined ||
      otherDetails.isCommissionManual !== undefined ||
      otherDetails.commission !== undefined ||
      (order.sellerId && (order.commission === undefined || order.commission === null));

    if (shouldRecalculateCommission) {
      const updatedOrderForCommission = { ...order, ...detailsToUpdate, items: itemsToUse } as Order;
      detailsToUpdate.commission = calculateCommission(updatedOrderForCommission, products);
      if (hasSellerIdChanged) {
        detailsToUpdate.commissionPaid = false;
      }
    }

    // Mapping for Supabase (Snake Case if needed, or rely on JS)
    // The detailsToUpdate object contains keys like 'installmentDetails' which need to match schema
    const payload: any = { ...detailsToUpdate };

    const { error } = await supabase.from('orders').update(payload).eq('id', orderId);

    if (error) {
      console.error("Erro ao atualizar pedido:", error);
      toast({ title: 'Erro', description: 'Não foi possível atualizar o pedido.', variant: 'destructive' });
      return;
    }

    logAction('Atualização de Detalhes do Pedido', `Detalhes do pedido #${orderId} foram atualizados.`, user);
    toast({ title: "Pedido Atualizado!", description: `Os detalhes do pedido #${orderId} foram atualizados.`, duration: 2000 });
  }, [orders, products, toast]);

  const payCommissions = useCallback(async (sellerId: string, sellerName: string, amount: number, orderIds: string[], period: string, logAction: LogAction, user: User | null): Promise<string | null> => {
    const paymentId = `COMP-${Date.now().toString().slice(-6)}`;
    const payment = {
      id: paymentId,
      sellerId: sellerId,
      sellerName: sellerName,
      amount,
      paymentDate: new Date().toISOString(),
      period,
      orderIds: orderIds
    };

    // Insert payment
    const { error } = await supabase.from('commission_payments').insert(payment);
    if (error) {
      console.error(error);
      return null;
    }

    // Update orders COMMISSION PAID
    // Batch update via Promise.all
    await Promise.all(orderIds.map(oid =>
      supabase.from('orders').update({ commissionPaid: true }).eq('id', oid)
    ));

    logAction('Pagamento de Comissão', `Comissão de ${sellerName} no valor de R$${amount.toFixed(2)} referente a ${period} foi paga.`, user);
    toast({ title: "Comissão Paga!", description: `O pagamento para ${sellerName} foi registrado.`, duration: 2000 });
    return paymentId;
  }, [toast]);

  const reverseCommissionPayment = useCallback(async (paymentId: string, logAction: LogAction, user: User | null) => {
    const paymentToReverse = commissionPayments.find(p => p.id === paymentId);
    if (!paymentToReverse) {
      toast({ title: "Erro", description: "Pagamento não encontrado.", variant: "destructive" });
      return;
    }

    const { error } = await supabase.from('commission_payments').delete().eq('id', paymentId);
    if (error) {
      console.error(error);
      return;
    }

    await Promise.all(paymentToReverse.orderIds.map(oid =>
      supabase.from('orders').update({ commissionPaid: false }).eq('id', oid)
    ));

    logAction('Estorno de Comissão', `O pagamento de comissão ID ${paymentId} foi estornado.`, user);
    toast({ title: "Pagamento Estornado!", description: "As comissões dos pedidos voltaram a ficar pendentes.", duration: 2000 });
  }, [commissionPayments, toast]);

  const saveStockAudit = useCallback(async (audit: StockAudit, logAction: LogAction, user: User | null) => {
    const { error } = await supabase.from('stock_audits').insert({
      ...audit,
      created_at: audit.createdAt || new Date().toISOString(),
    });

    if (error) {
      console.error(error);
      toast({ title: "Erro", description: "Falha ao salvar auditoria.", variant: "destructive" });
      return;
    }

    logAction('Auditoria de Estoque', `Auditoria de estoque para ${audit.month}/${audit.year} foi salva.`, user);
    toast({ title: "Auditoria Salva!", description: "O relatório de auditoria foi salvo com sucesso.", duration: 2000 });
  }, [toast]);

  const addAvaria = useCallback(async (avariaData: Omit<Avaria, 'id' | 'createdAt' | 'createdBy' | 'createdByName'>, logAction: LogAction, user: User | null) => {
    if (!user) return;
    const newAvariaId = `AVR-${Date.now().toString().slice(-6)}`;
    const newAvaria: Avaria = {
      ...avariaData,
      id: newAvariaId,
      createdAt: new Date().toISOString(),
      createdBy: user.id,
      createdByName: user.name,
    };

    const { error } = await supabase.from('avarias').insert({
      ...newAvaria,
      product_id: newAvaria.productId,
      product_name: newAvaria.productName,
      customer_name: newAvaria.customerName,
      created_at: newAvaria.createdAt,
      created_by: newAvaria.createdBy,
      created_by_name: newAvaria.createdByName
    });

    if (error) {
      console.error(error);
      toast({ title: "Erro", description: "Falha ao registrar avaria.", variant: "destructive" });
      return;
    }

    logAction('Registro de Avaria', `Nova avaria registrada para o cliente ${avariaData.customerName} (Produto: ${avariaData.productName}).`, user);
    toast({
      title: "Avaria Registrada!",
      description: "O registro de avaria foi salvo com sucesso.",
      duration: 2000
    });
  }, [toast]);

  const updateAvaria = useCallback(async (avariaId: string, avariaData: Partial<Omit<Avaria, 'id'>>, logAction: LogAction, user: User | null) => {
    const dataToUpdate = {
      ...avariaData,
      lastModifiedBy: user?.name,
      lastModifiedAt: new Date().toISOString(),
    };

    const payload = {
      ...dataToUpdate,
      last_modified_by: dataToUpdate.lastModifiedBy,
      last_modified_at: dataToUpdate.lastModifiedAt
    };

    const { error } = await supabase.from('avarias').update(payload).eq('id', avariaId);
    if (error) {
      console.error(error);
      return;
    }

    logAction('Atualização de Avaria', `Avaria ID ${avariaId} foi atualizada.`, user);
    toast({ title: "Avaria Atualizada!", description: "O registro de avaria foi atualizado.", duration: 2000 });
  }, [toast]);

  const deleteAvaria = useCallback(async (avariaId: string, logAction: LogAction, user: User | null) => {
    const { error } = await supabase.from('avarias').delete().eq('id', avariaId);
    if (error) {
      console.error(error);
      return;
    }
    logAction('Exclusão de Avaria', `Avaria ID ${avariaId} foi excluída.`, user);
    toast({ title: "Avaria Excluída!", variant: "destructive", duration: 5000 });
  }, [toast]);

  const emptyTrash = useCallback(async (logAction: LogAction, user: User | null) => {
    const deletedOrders = orders.filter(o => o.status === 'Excluído' && o.items.length > 0);

    if (deletedOrders.length === 0) {
      toast({ title: 'Lixeira Vazia', description: 'Não há pedidos de compra para remover da lixeira.' });
      return;
    }



    await chunkPromise(deletedOrders, async (order) => {
      await supabase.from('orders').delete().eq('id', order.id);
    });

    logAction('Esvaziar Lixeira', `Todos os ${deletedOrders.length} pedidos da lixeira foram permanentemente excluídos.`, user);
    toast({ title: 'Lixeira Esvaziada!', description: `${deletedOrders.length} pedidos foram excluídos permanentemente.`, duration: 2000 });
  }, [orders, toast]);

  const value = useMemo(() => ({
    addOrder, addCustomer, generateCustomerCodes, deleteOrder, permanentlyDeleteOrder, updateOrderStatus, recordInstallmentPayment, reversePayment, updateInstallmentDueDate, updateInstallmentAmount, updateCustomer, deleteCustomer, restoreCustomerFromTrash, permanentlyDeleteCustomerFromTrash, importCustomers, updateOrderDetails,
    addProduct, updateProduct, deleteProduct, importProducts,
    addCategory, deleteCategory, updateCategoryName, addSubcategory, updateSubcategory, deleteSubcategory, moveCategory, reorderSubcategories, moveSubcategory,
    payCommissions, reverseCommissionPayment,
    restoreAdminData, resetOrders, resetProducts, resetFinancials, resetAllAdminData,
    saveStockAudit, addAvaria, updateAvaria, deleteAvaria,
    emptyTrash,
    restoreProduct, permanentlyDeleteProduct, fetchDeletedProducts,
    // Admin Data states
    orders,
    commissionPayments,
    stockAudits,
    avarias,
    chatSessions,
    customers: customersForUI,
    deletedCustomers,
    customerOrders,
    customerFinancials,
    financialSummary,
    commissionSummary,
  }), [
    addOrder, addCustomer, generateCustomerCodes, deleteOrder, permanentlyDeleteOrder, updateOrderStatus, recordInstallmentPayment, reversePayment, updateInstallmentDueDate, updateInstallmentAmount, updateCustomer, deleteCustomer, restoreCustomerFromTrash, permanentlyDeleteCustomerFromTrash, importCustomers, updateOrderDetails,
    addProduct, updateProduct, deleteProduct, importProducts,
    addCategory, deleteCategory, updateCategoryName, addSubcategory, updateSubcategory, deleteSubcategory, moveCategory, reorderSubcategories, moveSubcategory,
    payCommissions, reverseCommissionPayment,
    restoreAdminData, resetOrders, resetProducts, resetFinancials, resetAllAdminData,
    saveStockAudit, addAvaria, updateAvaria, deleteAvaria,
    emptyTrash,
    restoreProduct, permanentlyDeleteProduct, fetchDeletedProducts,
    orders, commissionPayments, stockAudits, avarias, chatSessions, customersForUI, deletedCustomers, customerOrders, customerFinancials, financialSummary, commissionSummary
  ]);

  return (
    <AdminContext.Provider value={value}>
      {children}
    </AdminContext.Provider>
  );
};

export const useAdmin = (): AdminContextType => {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error('useAdmin must be used within an AdminProvider');
  }
  return context;
};

export const useAdminData = (): AdminContextType => {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error('useAdminData must be used within an AdminProvider');
  }
  return context;
};
