'use server';

import { db } from '@/lib/db';
import { Order, User } from '@/lib/types';
import { revalidatePath } from 'next/cache';

// Fetch all orders
export async function getAdminOrdersAction() {
    try {
        const allOrders = await db.order.findMany({
            orderBy: { date: 'desc' }
        });
        return { success: true, data: allOrders as unknown as Order[] };
    } catch (error: any) {
        console.error('Error fetching admin orders:', error);
        return { success: false, error: error.message };
    }
}

// Update Order Status
export async function updateOrderStatusAction(orderId: string, status: Order['status'], user: User | null) {
    try {
        await db.order.update({
            where: { id: orderId },
            data: { status }
        });
        revalidatePath('/admin/pedidos');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function moveOrderToTrashAction(orderId: string) {
    try {
        await db.order.update({
            where: { id: orderId },
            data: { status: 'Excluído' }
        });
        revalidatePath('/admin/pedidos');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function permanentlyDeleteOrderAction(orderId: string) {
    try {
        await db.order.delete({
            where: { id: orderId }
        });
        revalidatePath('/admin/pedidos');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

// Installment Payments
export async function recordInstallmentPaymentAction(orderId: string, installmentNumber: number, payment: any) {
    try {
        const order = await db.order.findUnique({
            where: { id: orderId }
        });

        if (!order) throw new Error('Order not found');

        // Handling JSON update manually
        const installments = (order.installmentDetails as any) || [];

        const updatedInstallments = installments.map((inst: any) => {
            if (inst.installmentNumber === installmentNumber) {
                const currentPaid = inst.paidAmount || 0;
                const newPaid = currentPaid + payment.amount;
                const newStatus = newPaid >= inst.amount ? 'Pago' : 'Parcial';

                return {
                    ...inst,
                    paidAmount: newPaid,
                    status: newStatus,
                    payments: [...(inst.payments || []), payment]
                };
            }
            return inst;
        });

        await db.order.update({
            where: { id: orderId },
            data: { installmentDetails: updatedInstallments }
        });

        revalidatePath('/admin/pedidos');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

// Update Order Details (General)
export async function updateOrderDetailsAction(orderId: string, data: Partial<Order>) {
    try {
        await db.order.update({
            where: { id: orderId },
            data: {
                ...data,
                // Ensure specific fields are correctly typed if spread doesn't work perfectly for JSON/Dates
                installmentDetails: data.installmentDetails as any, // Prisma handling for JSON
                firstDueDate: data.firstDueDate instanceof Date ? data.firstDueDate.toISOString() : data.firstDueDate,
                date: data.date,
            }
        });
        revalidatePath('/admin/pedidos');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
