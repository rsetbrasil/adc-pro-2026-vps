'use client';

import React, { createContext, useContext, ReactNode, useCallback, useState, useEffect, useMemo, useRef } from 'react';
import type { Order, Product, Installment, CustomerInfo, Category, User, CommissionPayment, Payment, StockAudit, Avaria, ChatSession } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useData } from './DataContext';
import { addMonths, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from './AuthContext';
import { normalizeCpf } from '@/lib/customer-trash';
import { formatCustomerCode, reserveCustomerCodes } from '@/lib/customer-code';

// Server Actions
import { getAdminOrdersAction, updateOrderStatusAction, moveOrderToTrashAction, permanentlyDeleteOrderAction, recordInstallmentPaymentAction, updateOrderDetailsAction } from '@/app/actions/admin/orders';
import { addProductAction, updateProductAction, deleteProductAction } from '@/app/actions/admin/products';
import { saveStockAuditAction, getStockAuditsAction, addAvariaAction, updateAvariaAction, deleteAvariaAction, getAvariasAction } from '@/app/actions/admin/inventory';
import { createOrderAction } from '@/app/actions/checkout';
import { getProductsAction } from '@/app/actions/data';
import { resetOrdersAction, resetProductsAction, resetFinancialsAction, resetAllAdminDataAction, importProductsAction, importCustomersAction, emptyTrashAction, restoreProductAction, permanentlyDeleteProductWithIdAction, fetchDeletedProductsAction } from '@/app/actions/admin/system';
import { addCustomerAction, getCustomersAction, updateCustomerAction, deleteCustomerAction, generateCustomerCodesAction } from '@/app/actions/admin/customers';

type LogAction = (action: string, details: string, user: User | null) => void;

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
  restoreAdminData: (data: any, logAction: LogAction, user: User | null) => Promise<void>;
  resetOrders: (logAction: LogAction, user: User | null) => Promise<void>;
  resetProducts: (logAction: LogAction, user: User | null) => Promise<void>;
  resetFinancials: (logAction: LogAction, user: User | null) => Promise<void>;
  resetAllAdminData: (logAction: LogAction, user: User | null) => Promise<void>;
  saveStockAudit: (audit: StockAudit, logAction: LogAction, user: User | null) => Promise<void>;
  addAvaria: (avaria: any, logAction: LogAction, user: User | null) => Promise<void>;
  updateAvaria: (id: string, data: any, logAction: LogAction, user: User | null) => Promise<void>;
  deleteAvaria: (id: string, logAction: LogAction, user: User | null) => Promise<void>;
  emptyTrash: (logAction: LogAction, user: User | null) => Promise<void>;
  restoreProduct: (product: Product, logAction: LogAction, user: User | null) => Promise<void>;
  permanentlyDeleteProduct: (productId: string, logAction: LogAction, user: User | null) => Promise<void>;
  fetchDeletedProducts: () => Promise<Product[]>;
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

// Helper for installment calculation
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

export const AdminProvider = ({ children }: { children: ReactNode }) => {
  const { products: productsData, categories, updateProductLocally, addProductLocally, deleteProductLocally } = useData();
  const { toast } = useToast();
  const { user, users } = useAuth();

  // Use local state for orders, etc.
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<CustomerInfo[]>([]);
  const [commissionPayments, setCommissionPayments] = useState<CommissionPayment[]>([]);
  const [stockAudits, setStockAudits] = useState<StockAudit[]>([]);
  const [avarias, setAvarias] = useState<Avaria[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [deletedCustomers, setDeletedCustomers] = useState<CustomerInfo[]>([]);

  // Polling Function
  const fetchData = useCallback(async () => {
    // Orders
    const ordersRes = await getAdminOrdersAction();
    if (ordersRes.success && ordersRes.data) {
      setOrders(ordersRes.data);
    }

    // Customers
    const customersRes = await getCustomersAction();
    if (customersRes.success && customersRes.data) {
      setCustomers(customersRes.data);
    }

    // Commission Payments
    const commRes = await getCommissionPaymentsAction();
    if (commRes.success && commRes.data) {
      setCommissionPayments(commRes.data);
    }

    // Stock Audits
    const auditRes = await getStockAuditsAction();
    if (auditRes.success && auditRes.data) {
      setStockAudits(auditRes.data);
    }

    // Avarias
    const avariaRes = await getAvariasAction();
    if (avariaRes.success && avariaRes.data) {
      setAvarias(avariaRes.data);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // 10 seconds polling
    return () => clearInterval(interval);
  }, [fetchData]);

  const addOrder = async (order: Partial<Order> & { firstDueDate: Date }, logAction: LogAction, user: User | null): Promise<Order | null> => {
    const orderId = `PED-${Date.now().toString().slice(-6)}`;
    const subtotal = order.items?.reduce((acc, item) => acc + item.price * item.quantity, 0) || 0;
    const total = subtotal - (order.discount || 0);
    const totalFinanced = total - (order.downPayment || 0);

    let installmentDetails: Installment[] = [];
    let installmentValue = 0;

    if ((order.installments || 0) > 0 && order.firstDueDate) {
      installmentDetails = recalculateInstallments(totalFinanced, order.installments!, orderId, order.firstDueDate.toISOString());
      installmentValue = installmentDetails[0]?.amount || 0;
    }

    const orderData: Order = {
      ...order,
      id: orderId,
      total,
      subtotal,
      installmentDetails,
      installmentValue,
      status: 'Processando',
      createdAt: new Date().toISOString(),
      items: order.items || [],
      customer: order.customer!,
      sellerId: user?.id || order.sellerId || '',
      sellerName: user?.name || order.sellerName || '',
    } as Order;

    const res = await createOrderAction(orderData, order.customer);
    if (!res.success) {
      throw new Error((res as any).error || 'Failed to create order');
    }

    logAction('Criação de Pedido', `Pedido ${orderId} criado.`, user);
    setOrders(prev => [orderData, ...prev]);
    return orderData;
  };

  const deleteOrder = async (orderId: string, logAction: LogAction, user: User | null) => {
    const res = await moveOrderToTrashAction(orderId);
    if (res.success) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'Excluído' } : o));
      logAction('Exclusão de Pedido', `Pedido ${orderId} movido para lixeira.`, user);
    }
  };

  const permanentlyDeleteOrder = async (orderId: string, logAction: LogAction, user: User | null) => {
    const res = await permanentlyDeleteOrderAction(orderId);
    if (res.success) {
      setOrders(prev => prev.filter(o => o.id !== orderId));
      logAction('Exclusão Permanente', `Pedido ${orderId} excluído.`, user);
    }
  };

  const updateOrderStatus = async (orderId: string, status: Order['status'], logAction: LogAction, user: User | null) => {
    const res = await updateOrderStatusAction(orderId, status, user);
    if (res.success) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o));
      logAction('Status Atualizado', `Pedido ${orderId} alterado para ${status}.`, user);
    }
  };

  const recordInstallmentPayment = async (orderId: string, installmentNumber: number, payment: Omit<Payment, 'receivedBy'>, logAction: LogAction, user: User | null) => {
    // Implement using existing logic or action
    // For now, placeholder to allow compile
    console.log('Record payment', orderId, installmentNumber);
  };

  const addProduct = async (productData: Omit<Product, 'id' | 'data-ai-hint' | 'createdAt'>, logAction: LogAction, user: User | null) => {
    const res = await addProductAction(productData, user);
    if (res.success) {
      logAction('Produto Criado', `Produto ${productData.name} criado.`, user);
      // Optimistic update handled by DataContext polling usually, but we can trigger it.
      // For now, allow refresh.
    }
  };

  const updateProduct = async (product: Product, logAction: LogAction, user: User | null) => {
    const res = await updateProductAction(product, user);
    if (res.success) {
      logAction('Produto Atualizado', `Produto ${product.name} atualizado.`, user);
      updateProductLocally(product);
    }
  };

  const deleteProduct = async (productId: string, logAction: LogAction, user: User | null) => {
    const res = await deleteProductAction(productId, user);
    if (res.success) {
      logAction('Produto Removido', `Produto ${productId} removido.`, user);
      deleteProductLocally(productId);
    }
  };

  const addCustomer = async (customerData: CustomerInfo, logAction: LogAction, user: User | null) => {
    const res = await addCustomerAction(customerData, user);
    if (res.success) {
      logAction('Cliente Adicionado', `Cliente ${customerData.name} adicionado.`, user);
      // Add to local state
      setCustomers(prev => [...prev, customerData]);
    } else {
      toast({ title: "Erro", description: res.error, variant: 'destructive' });
    }
  };

  // Partial implementations for complex logic
  const generateCustomerCodes = async (logAction: LogAction, user: User | null) => {
    const res = await generateCustomerCodesAction(user);
    if (res.success) {
      logAction('Códigos Gerados', `Gerados códigos para ${res.count} clientes.`, user);
      return { newCustomers: res.count, updatedOrders: 0 };
    }
    return { newCustomers: 0, updatedOrders: 0 };
  };
  const reversePayment = async () => { };
  const updateInstallmentDueDate = async () => { };
  const updateInstallmentAmount = async () => { };
  const updateCustomer = async (oldCustomer: CustomerInfo, updatedCustomerData: CustomerInfo, logAction: LogAction, user: User | null) => {
    const res = await updateCustomerAction(updatedCustomerData, user);
    if (res.success) {
      logAction('Cliente Atualizado', `Cliente ${updatedCustomerData.name} atualizado.`, user);
      setCustomers(prev => prev.map(c => c.id === updatedCustomerData.id ? updatedCustomerData : c));
    } else {
      toast({ title: "Erro", description: res.error, variant: 'destructive' });
    }
  };

  const deleteCustomer = async (customer: CustomerInfo, logAction: LogAction, user: User | null) => {
    const res = await deleteCustomerAction(customer.id, user);
    if (res.success) {
      logAction('Cliente Bloqueado/Excluído', `Cliente ${customer.name} bloqueado/excluído.`, user);
      // Update local state to show as blocked or remove depending on logic (here assume moved to blocked/trash)
      setCustomers(prev => prev.map(c => c.id === customer.id ? { ...c, blocked: true, blockedReason: 'Excluído' } : c));
    } else {
      toast({ title: "Erro", description: res.error, variant: 'destructive' });
    }
  };
  const restoreCustomerFromTrash = async () => { };
  const permanentlyDeleteCustomerFromTrash = async () => { };
  const importCustomers = async (csvData: string, logAction: LogAction, user: User | null) => {
    // Assuming csvData is actually JSON string based on usual usage in this app or we parse CSV here.
    // The signature says csvData key but usage in page might be JSON. 
    // Let's assume the user passes parsed object or JSON string. 
    try {
      const parsed = JSON.parse(csvData);
      const list = Array.isArray(parsed) ? parsed : [];
      if (list.length > 0) {
        await importCustomersAction(list, user);
        logAction('Importação de Clientes', `${list.length} clientes importados.`, user);
      }
    } catch (e) {
      console.error("Invalid Import Data", e);
    }
  };
  const updateOrderDetails = async (orderId: string, details: Partial<Order> & { downPayment?: number, resetDownPayment?: boolean }, logAction: LogAction, user: User | null) => {
    const currentOrder = orders.find(o => o.id === orderId);
    if (!currentOrder) return;

    let updatedOrder = { ...currentOrder, ...details };

    // Handle Down Payment Reset
    if (details.resetDownPayment) {
      updatedOrder.downPayment = 0;
    }

    // Recalculate totals
    const subtotal = updatedOrder.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    updatedOrder.total = subtotal - (updatedOrder.discount || 0);
    const totalFinanced = updatedOrder.total - (updatedOrder.downPayment || 0);

    // Recalculate Installments if relevant fields changed
    const needsRecalculation =
      details.installments !== undefined ||
      details.discount !== undefined ||
      details.downPayment !== undefined ||
      details.resetDownPayment ||
      (details.paymentMethod === 'Crediário' && currentOrder.paymentMethod !== 'Crediário');

    if (needsRecalculation && updatedOrder.paymentMethod === 'Crediário') {
      // Default logic: keep existing first due date or default to 30 days from now if not set
      const firstDueDate = updatedOrder.installmentDetails?.[0]?.dueDate || addMonths(new Date(), 1).toISOString();

      updatedOrder.installmentDetails = recalculateInstallments(
        totalFinanced,
        updatedOrder.installments || 1,
        orderId,
        firstDueDate
      );
      updatedOrder.installmentValue = updatedOrder.installmentDetails[0]?.amount || 0;
    } else if (updatedOrder.paymentMethod !== 'Crediário') {
      updatedOrder.installmentDetails = [];
      updatedOrder.installmentValue = 0;
      updatedOrder.installments = 0;
    }

    // Call Server Action
    const res = await import('@/app/actions/admin/orders').then(mod => mod.updateOrderDetailsAction(orderId, updatedOrder));

    if (res.success) {
      setOrders(prev => prev.map(o => o.id === orderId ? updatedOrder : o));
      logAction('Atualização de Pedido', `Detalhes do pedido ${orderId} atualizados.`, user);
    } else {
      toast({ title: "Erro ao atualizar", description: res.error, variant: "destructive" });
    }
  };
}
  };
const importProducts = async (productsToImport: Product[], logAction: LogAction, user: User | null) => {
  const res = await importProductsAction(productsToImport, user);
  if (res.success) {
    logAction('Importação de Produtos', `${productsToImport.length} produtos importados.`, user);
    // Refresh handled by polling
  }
};
const addCategory = async (categoryName: string, logAction: LogAction, user: User | null) => {
  const res = await addCategoryAction(categoryName, user);
  if (res.success) {
    logAction('Categoria Criada', `Categoria ${categoryName} criada.`, user);
    // DataContext polling will update the list
  }
};
const deleteCategory = async (categoryId: string, logAction: LogAction, user: User | null) => {
  const res = await deleteCategoryAction(categoryId, user);
  if (res.success) logAction('Categoria Removida', `Categoria removida.`, user);
};
const updateCategoryName = async (categoryId: string, newName: string, logAction: LogAction, user: User | null) => {
  const res = await updateCategoryNameAction(categoryId, newName, user);
  if (res.success) logAction('Categoria Atualizada', `Categoria atualizada para ${newName}.`, user);
};
const addSubcategory = async (categoryId: string, subcategoryName: string, logAction: LogAction, user: User | null) => {
  const res = await addSubcategoryAction(categoryId, subcategoryName, user);
  if (res.success) logAction('Subcategoria Criada', `Subcategoria ${subcategoryName} criada.`, user);
};
const updateSubcategory = async (categoryId: string, oldSub: string, newSub: string, logAction: LogAction, user: User | null) => {
  const res = await updateSubcategoryAction(categoryId, oldSub, newSub, user);
  if (res.success) logAction('Subcategoria Atualizada', `Subcategoria ${oldSub} -> ${newSub}.`, user);
};
const deleteSubcategory = async (categoryId: string, subcategoryName: string, logAction: LogAction, user: User | null) => {
  const res = await deleteSubcategoryAction(categoryId, subcategoryName, user);
  if (res.success) logAction('Subcategoria Removida', `Subcategoria ${subcategoryName} removida.`, user);
};
const moveCategory = async () => { };
const reorderSubcategories = async () => { };
const moveSubcategory = async () => { };
const payCommissions = async (sellerId: string, sellerName: string, amount: number, orderIds: string[], period: string, logAction: LogAction, user: User | null) => {
  const res = await payCommissionAction(sellerId, sellerName, amount, orderIds, period, user);
  if (res.success) {
    logAction('Pagamento de Comissão', `Pagamento de R$ ${amount.toFixed(2)} para ${sellerName}.`, user);
    return res.data;
  }
  return null;
};
const reverseCommissionPayment = async (paymentId: string, logAction: LogAction, user: User | null) => {
  const res = await reverseCommissionPaymentAction(paymentId, user);
  if (res.success) logAction('Estorno de Comissão', `Pagamento ${paymentId} estornado.`, user);
};
const deleteAvaria = async (id: string, logAction: LogAction, user: User | null) => {
  const res = await deleteAvariaAction(id, user);
  if (res.success) logAction('Avaria Excluída', `Avaria excluída.`, user);
};
const emptyTrash = async (logAction: LogAction, user: User | null) => {
  await emptyTrashAction(user);
  logAction('Lixeira Esvaziada', 'Lixeira de produtos esvaziada.', user);
};
const restoreProduct = async (product: Product, logAction: LogAction, user: User | null) => {
  await restoreProductAction(product.id, user);
  logAction('Produto Restaurado', `Produto ${product.name} restaurado.`, user);
  // Local update helper if needed, but polling works
  updateProductLocally({ ...product, deletedAt: undefined });
};
const permanentlyDeleteProduct = async (productId: string, logAction: LogAction, user: User | null) => {
  await permanentlyDeleteProductWithIdAction(productId, user);
  logAction('Produto Excluído Permanentemente', `Produto ${productId} apagado.`, user);
  deleteProductLocally(productId);
};
const fetchDeletedProducts = async () => {
  const res = await fetchDeletedProductsAction();
  return res.success && res.data ? res.data : [];
};

const restoreAdminData = async () => { }; // Deprecated or specific backup restore logic
const resetOrders = async (logAction: LogAction, user: User | null) => {
  await resetOrdersAction(user);
  logAction('Reset de Pedidos', 'Todos os pedidos foram apagados.', user);
  setOrders([]);
};
const resetProducts = async (logAction: LogAction, user: User | null) => {
  await resetProductsAction(user);
  logAction('Reset de Produtos', 'Todos os produtos foram apagados.', user);
};
const resetFinancials = async (logAction: LogAction, user: User | null) => {
  await resetFinancialsAction(user);
  logAction('Reset Financeiro', 'Dados financeiros resetados.', user);
};
const resetAllAdminData = async (logAction: LogAction, user: User | null) => {
  await resetAllAdminDataAction(user);
  logAction('Reset Geral', 'Todos os dados do sistema foram apagados.', user);
  setOrders([]);
  setCustomers([]);
};

// Computed
const customersForUI = useMemo(() => customers, [customers]);
const customerOrders = useMemo(() => ({}), [orders]);
const customerFinancials = useMemo(() => ({}), [orders]);
const financialSummary = useMemo(() => ({ totalVendido: 0, totalRecebido: 0, totalPendente: 0, lucroBruto: 0, monthlyData: [] }), [orders]);
const commissionSummary = useMemo(() => ({ totalPendingCommission: 0, commissionsBySeller: [] }), [orders]);

const value = {
  addOrder, addCustomer, generateCustomerCodes, deleteOrder, permanentlyDeleteOrder, updateOrderStatus, recordInstallmentPayment, reversePayment, updateInstallmentDueDate, updateInstallmentAmount, updateCustomer, deleteCustomer, restoreCustomerFromTrash, permanentlyDeleteCustomerFromTrash, importCustomers, updateOrderDetails,
  addProduct, updateProduct, deleteProduct, importProducts,
  addCategory, deleteCategory, updateCategoryName, addSubcategory, updateSubcategory, deleteSubcategory, moveCategory, reorderSubcategories, moveSubcategory,
  payCommissions, reverseCommissionPayment,
  restoreAdminData, resetOrders, resetProducts, resetFinancials, resetAllAdminData,
  saveStockAudit, addAvaria, updateAvaria, deleteAvaria,
  emptyTrash,
  restoreProduct, permanentlyDeleteProduct, fetchDeletedProducts,
  orders, commissionPayments, stockAudits, avarias, chatSessions, customers: customersForUI, deletedCustomers, customerOrders, customerFinancials, financialSummary, commissionSummary,
};

return (
  <AdminContext.Provider value={value}>
    {children}
  </AdminContext.Provider>
);
};

export const useAdmin = () => {
  const context = useContext(AdminContext);
  if (context === undefined) throw new Error('useAdmin must be used within an AdminProvider');
  return context;
};

export const useAdminData = useAdmin;
