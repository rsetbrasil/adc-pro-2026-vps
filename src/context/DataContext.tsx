

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
    setProducts(prev => [...prev, product]);
  };

  const deleteProductLocally = (productId: string) => {
    setProducts(prev => prev.filter(p => p.id !== productId));
  };

  useEffect(() => {
    const fetchData = async () => {
      // Fetch Products
      try {
        const { data: productsData, error: productsError } = await supabase
          .from('products')
          .select('*')
          .order('created_at', { ascending: true });

        if (productsError) throw productsError;

        if (productsData) {
          const mappedProducts = productsData.map((p: any) => ({
            ...p,
            createdAt: p.created_at || p.createdAt
          }));
          setProducts(mappedProducts as Product[]);
        }
      } catch (error) {
        console.error('Error fetching products from Supabase:', error);
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

    // Setup Realtime for Products
    const mapProductFromDB = (p: any): Product => ({
      ...p,
      createdAt: p.created_at || p.createdAt
    });

    const productsChannel = supabase.channel('public:products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
        const newRecord = payload.new as Record<string, any> | null;
        const oldRecord = payload.old as Record<string, any> | null;
        console.log("Product realtime event:", payload.eventType, newRecord?.id);

        if (payload.eventType === 'INSERT') {
          const newProduct = mapProductFromDB(payload.new);
          setProducts(prev => [...prev, newProduct]);
        } else if (payload.eventType === 'UPDATE') {
          const updatedProduct = mapProductFromDB(payload.new);
          setProducts(prev => prev.map(p => p.id === updatedProduct.id ? updatedProduct : p));
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

  const value = useMemo(() => ({
    products,
    categories,
    isLoading,
    updateProductLocally,
    addProductLocally,
    deleteProductLocally,
  }), [
    products,
    categories,
    isLoading,
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
