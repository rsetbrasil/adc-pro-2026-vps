'use server';

import { db } from '@/lib/db';
import { Product, User } from '@/lib/types';
import { revalidatePath } from 'next/cache';

export async function addProductAction(productData: any, user: User | null) {
    try {
        // Logic from AdminContext
        const newProductId = `PROD-${Date.now().toString().slice(-6)}`;
        const newProductCode = Date.now().toString().slice(-6);

        const newProduct = {
            ...productData,
            id: newProductId,
            code: productData.code || newProductCode,
            dataAiHint: productData.name.toLowerCase().split(' ').slice(0, 2).join(' '),
        };

        if (!newProduct.promotionEndDate) delete newProduct.promotionEndDate;

        await db.product.create({ data: newProduct });
        revalidatePath('/admin/produtos');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function updateProductAction(product: Product, user: User | null) {
    try {
        // Prisma update
        const { id, ...data } = product;
        // Handle timestamps or other fields if strictly typed

        await db.product.update({
            where: { id },
            data: data as any
        });
        revalidatePath('/admin/produtos');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function deleteProductAction(productId: string, user: User | null) {
    try {
        // Soft delete usually or move to trash
        await db.product.update({
            where: { id: productId },
            data: { deletedAt: new Date().toISOString() } // Or whatever logic for soft delete
        });
        revalidatePath('/admin/produtos');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
