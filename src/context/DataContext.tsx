

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

const loadCache = <T,>(key: string): T | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const saveCache = (key: string, data: unknown) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
  }
};

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const lastGoodProductsRef = useRef<Product[]>([]);

  // Funções de atualização otimista
  const updateProductLocally = (product: Product) => {
    setProducts(prev => prev.map(p => p.id === product.id ? product : p));
    const updated = lastGoodProductsRef.current.map(p => p.id === product.id ? product : p);
    saveCache('productsCache', updated);
    lastGoodProductsRef.current = updated;
  };

  const addProductLocally = (product: Product) => {
    setProducts(prev => [...prev, product]);
    const updated = [...lastGoodProductsRef.current, product];
    saveCache('productsCache', updated);
    lastGoodProductsRef.current = updated;
  };

  const deleteProductLocally = (productId: string) => {
    setProducts(prev => prev.filter(p => p.id !== productId));
    const updated = lastGoodProductsRef.current.filter(p => p.id !== productId);
    saveCache('productsCache', updated);
    lastGoodProductsRef.current = updated;
  };

  useEffect(() => {
    const applyProducts = (nextProducts: Product[]) => {
      setProducts(nextProducts);
      saveCache('productsCache', nextProducts);
      lastGoodProductsRef.current = nextProducts;
    };

    const cachedProducts = loadCache<Product[]>('productsCache');
    if (cachedProducts && cachedProducts.length > 0) {
      setProducts(cachedProducts);
      lastGoodProductsRef.current = cachedProducts;
      setProductsLoading(false);
    }

    const cachedCategories = loadCache<Category[]>('categoriesCache');
    if (cachedCategories && cachedCategories.length > 0) {
      setCategories(cachedCategories);
      setCategoriesLoading(false);
    }

    const fetchData = async () => {
      // Fetch Products
      try {
        const { data: productsData, error: productsError } = await supabase
          .from('products')
          .select('*')
          .order('created_at', { ascending: true });

        if (productsError) throw productsError;

        if (productsData) {
          // Ensure field mappings if necessary (e.g. created_at -> createdAt if types demand it)
          // Returning types as is for now, assuming types.ts aligns or we map manually
          const mappedProducts = productsData.map((p: any) => ({
            ...p,
            createdAt: p.created_at || p.createdAt // Fallback
          }));
          applyProducts(mappedProducts as Product[]);
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
          saveCache('categoriesCache', categoriesData);
        }
      } catch (error) {
        console.error('Error fetching categories from Supabase:', error);
      } finally {
        setCategoriesLoading(false);
      }
    };

    fetchData();

    // Setup Realtime for Products - com atualização direta do estado
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
          saveCache('productsCache', [...lastGoodProductsRef.current, newProduct]);
          lastGoodProductsRef.current = [...lastGoodProductsRef.current, newProduct];
        } else if (payload.eventType === 'UPDATE') {
          const updatedProduct = mapProductFromDB(payload.new);
          setProducts(prev => prev.map(p => p.id === updatedProduct.id ? updatedProduct : p));
          const updated = lastGoodProductsRef.current.map(p => p.id === updatedProduct.id ? updatedProduct : p);
          saveCache('productsCache', updated);
          lastGoodProductsRef.current = updated;
        } else if (payload.eventType === 'DELETE') {
          const deletedId = oldRecord?.id;
          if (deletedId) {
            setProducts(prev => prev.filter(p => p.id !== deletedId));
            const filtered = lastGoodProductsRef.current.filter(p => p.id !== deletedId);
            saveCache('productsCache', filtered);
            lastGoodProductsRef.current = filtered;
          }
        }
      })
      .subscribe();

    // Setup Realtime for Categories
    const categoriesChannel = supabase.channel('public:categories')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => {
        fetchData();
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
