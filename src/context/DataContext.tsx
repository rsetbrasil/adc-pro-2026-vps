

'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo, useRef } from 'react';
import type { Product, Category } from '@/lib/types';
import { supabase } from '@/lib/supabase';

// This context now only handles PUBLIC data.
// Admin-related data has been moved to AdminContext for performance optimization.
interface DataContextType {
  products: Product[];
  categories: Category[];
  isLoading: boolean;
  updateProductLocally: (product: Product) => void;
  addProductLocally: (product: Product) => void;
  deleteProductLocally: (productId: string) => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  // Funções de atualização otimista (sem cache)
  const updateProductLocally = (product: Product) => {
    setProducts(prev => prev.map(p => p.id === product.id ? product : p));
  };

  const addProductLocally = (product: Product) => {
    setProducts(prev => {
      const exists = prev.some(p => p.id === product.id);
      if (exists) {
        return prev.map(p => p.id === product.id ? product : p);
      }
      return [...prev, product];
    });
  };

  const deleteProductLocally = (productId: string) => {
    setProducts(prev => prev.filter(p => p.id !== productId));
  };

  useEffect(() => {
    // Função de mapeamento de produtos do banco de dados (snake_case -> camelCase)
    const mapProductFromDB = (p: any): Product => ({
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
      onSale: p.on_sale ?? p.onSale ?? false,
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
      isHidden: p.is_hidden ?? p.isHidden ?? false,
      'data-ai-hint': p.data_ai_hint || p['data-ai-hint'],
      createdAt: p.created_at || p.createdAt,
      deletedAt: p.deleted_at || p.deletedAt,
    });

    const fetchData = async () => {
      // Fetch Products
      try {
        let allProducts: any[] = [];
        let from = 0;
        let to = 999;
        let finished = false;

        while (!finished) {
          const { data: productsChunk, error: productsError } = await supabase
            .from('products')
            .select('id, name, description, long_description, price, cost, category, subcategory, stock, min_stock, unit, original_price, on_sale, promotion_end_date, image_url, image_urls, max_installments, payment_condition, code, commission_type, commission_value, is_hidden, data_ai_hint, created_at, deleted_at')
            .is('deleted_at', null)
            .order('created_at', { ascending: true })
            .range(from, to);

          if (productsError) throw productsError;

          if (!productsChunk || productsChunk.length === 0) {
            finished = true;
          } else {
            allProducts = [...allProducts, ...productsChunk];
            if (productsChunk.length < 50) {
              finished = true;
            } else {
              from += 50;
              to += 50;
            }
          }
        }

        const mappedProducts = allProducts.map(mapProductFromDB);
        setProducts(mappedProducts);
      } catch (error) {
        console.error('Error fetching products from Supabase:', error instanceof Error ? error.message : JSON.stringify(error));
      } finally {
        setProductsLoading(false);
      }

      // Fetch Categories
      try {
        const { data: categoriesData, error: categoriesError } = await supabase
          .from('categories')
          .select('*')
          .order('order', { ascending: true });

        if (categoriesError) throw categoriesError;

        if (categoriesData) {
          setCategories(categoriesData as Category[]);
        }
      } catch (error) {
        console.error('Error fetching categories from Supabase:', error);
      } finally {
        setCategoriesLoading(false);
      }
    };

    fetchData();

    // Setup Realtime for Products usando a mesma função de mapeamento
    const productsChannel = supabase.channel('public:products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
        const newRecord = payload.new as Record<string, any> | null;
        const oldRecord = payload.old as Record<string, any> | null;

        if (payload.eventType === 'INSERT') {
          const newProduct = mapProductFromDB(newRecord);
          setProducts(prev => {
            if (prev.some(p => p.id === newProduct.id)) return prev;
            return [...prev, newProduct];
          });
        } else if (payload.eventType === 'UPDATE') {
          const updatedProduct = mapProductFromDB(newRecord);
          const hasDeletedAtColumn = newRecord && Object.prototype.hasOwnProperty.call(newRecord, 'deleted_at');
          const isDeletedInPayload = hasDeletedAtColumn && newRecord.deleted_at !== null;
          const isRestoredInPayload = hasDeletedAtColumn && newRecord.deleted_at === null;

          if (isDeletedInPayload) {
            // Se foi marcado como excluído, remove da lista
            setProducts(prev => prev.filter(p => p.id !== updatedProduct.id));
          } else {
            setProducts(prev => {
              const exists = prev.some(p => p.id === updatedProduct.id);
              if (exists) {
                // Atualiza existente
                return prev.map(p => p.id === updatedProduct.id ? updatedProduct : p);
              } else if (isRestoredInPayload) {
                // Adiciona se não existir E for uma restauração explícita
                return [...prev, updatedProduct];
              }
              // Se não existe e não é restauração, ignora (produto está na lixeira)
              return prev;
            });
          }
        } else if (payload.eventType === 'DELETE') {
          const deletedId = oldRecord?.id;
          if (deletedId) {
            setProducts(prev => prev.filter(p => p.id !== deletedId));
          }
        }
      })
      .subscribe();

    // Setup Realtime for Categories
    const categoriesChannel = supabase.channel('public:categories')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, async () => {
        // Recarregar categorias quando houver mudança
        try {
          const { data } = await supabase
            .from('categories')
            .select('*')
            .order('order', { ascending: true });
          if (data) setCategories(data as Category[]);
        } catch (error) {
          console.error('Error reloading categories:', error);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(productsChannel);
      supabase.removeChannel(categoriesChannel);
    };

  }, []);

  const isLoading = productsLoading || categoriesLoading;

  // Return ONLY active products for all public/shared views
  const activeProducts = useMemo(() => {
    return products.filter(p => !p.deletedAt);
  }, [products]);

  const value = useMemo(() => ({
    products: activeProducts,
    categories,
    isLoading,
    updateProductLocally,
    addProductLocally,
    deleteProductLocally,
  }), [
    activeProducts,
    categories,
    isLoading,
    updateProductLocally,
    addProductLocally,
    deleteProductLocally,
  ]);

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  );
}

export const useData = (): DataContextType => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
