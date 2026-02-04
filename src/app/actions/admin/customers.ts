'use server';

import { db } from '@/lib/db';
import { CustomerInfo, User } from '@/lib/types';
import { revalidatePath } from 'next/cache';

export async function addCustomerAction(customerData: CustomerInfo, user: User | null) {
    try {
        // Basic add logic
        const code = customerData.code || `CLI-${Date.now()}`;
        await db.customer.create({
            data: {
                ...customerData,
                code,
                id: customerData.id || `CUST-${Date.now()}`
            }
        });
        revalidatePath('/admin/clientes');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}


export async function getCustomersAction() {
    try {
        const customers = await db.customer.findMany({
            orderBy: { name: 'asc' }
        });
        return { success: true, data: customers as unknown as CustomerInfo[] };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function updateCustomerAction(customerData: CustomerInfo, user: User | null) {
    try {
        await db.customer.update({
            where: { id: customerData.id },
            data: customerData
        });
        revalidatePath('/admin/clientes');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function deleteCustomerAction(id: string, user: User | null) {
    try {
        await db.customer.update({
            where: { id },
            data: {
                blocked: true,
                blockedReason: 'Excluído',
                // Soft delete logic can be enhanced
            }
        });
        // Or actually delete: await db.customer.delete({ where: { id } });
        revalidatePath('/admin/clientes');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}


export async function generateCustomerCodesAction(user: User | null) {
    try {
        const customersWithoutCode = await db.customer.findMany({
            where: { OR: [{ code: null }, { code: '' }] },
            orderBy: { createdAt: 'asc' }
        });

        let updatedCount = 0;
        // Simple sequential strategy: find last code or start from 1
        // For robustness, simply using Timestamp or a counter in a transaction is better, 
        // but here we iterate. To be safe, we can use a prefix.

        // Let's rely on date largely for now to avoid collision or a complex seq table
        for (const cust of customersWithoutCode) {
            const code = `CLI-${cust.createdAt.toISOString().slice(0, 4)}-${cust.id.slice(0, 4).toUpperCase()}`;
            await db.customer.update({
                where: { id: cust.id },
                data: { code }
            });
            updatedCount++;
        }

        revalidatePath('/admin/clientes');
        return { success: true, count: updatedCount };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
