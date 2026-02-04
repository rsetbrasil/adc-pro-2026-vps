'use server';

import { db } from '@/lib/db';
import { CustomerInfo, Order } from '@/lib/types';

export async function findCustomerByCpfAction(cpf: string) {
    try {
        const customer = await db.customer.findUnique({
            where: { cpf }
        });
        if (customer) return { success: true, data: customer as unknown as CustomerInfo, source: 'active' };

        // Assuming CustomerTrash model is defined as 'customerTrash' via map "customers_trash"
        // In schema.prisma: model CustomerTrash ... @@map("customers_trash")
        // Prisma Client accessor: db.customerTrash (camelCase of model name) or db.customers_trash? Usually model name.
        // My model name was `CustomerTrash`.

        const trash = await db.customerTrash.findFirst({
            where: { cpf }
        });

        if (trash) return { success: true, data: trash.data as unknown as CustomerInfo, source: 'trash' };

        return { success: true, data: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function allocateNextCustomerCodeAction() {
    return { success: true, code: `CLI-${Date.now().toString().slice(-6)}` };
}

export async function createOrderAction(orderData: any, customerData: any) {
    try {
        return await db.$transaction(async (tx) => {
            // 1. Check stock
            for (const item of orderData.items) {
                const product = await tx.product.findUnique({
                    where: { id: item.id }
                });

                if (!product) throw new Error(`Produto ${item.name} não encontrado.`);
                if ((product.stock || 0) < item.quantity) {
                    throw new Error(`Estoque insuficiente para ${item.name}.`);
                }

                // 2. Deduct stock
                await tx.product.update({
                    where: { id: item.id },
                    data: { stock: (product.stock || 0) - item.quantity }
                });
            }

            // 3. Save Order
            await tx.order.create({
                data: orderData
            });

            // 4. Upsert Customer
            await tx.customer.upsert({
                where: { id: customerData.id },
                update: customerData,
                create: customerData
            });

            return { success: true, orderId: orderData.id };
        });
    } catch (error: any) {
        console.error('Order creation failed:', error);
        return { success: false, error: error.message };
    }
}
