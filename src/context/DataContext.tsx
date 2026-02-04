

'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo, useRef } from 'react';
import type { Product, Category } from '@/lib/types';
import { getProductsAction, getCategoriesAction } from '@/app/actions/data';

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
  const isPolling = useRef(true);

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
    const fetchData = async (showLoading = false) => {
      if (showLoading) {
        setProductsLoading(true);
        setCategoriesLoading(true);
      }

      // Fetch Products
      try {
        const result = await getProductsAction();
        if (result.success && result.data) {
          // Mapper might be needed if DB returns snake_case but Type expects camelCase
          // Drizzle usually handles this via schema definition if configured or we map here.
          // schema.ts defined: `canBeAssigned: boolean('can_be_assigned')` results in camelCase `canBeAssigned` in returned object.
          // So we should be fine assuming schema matches types.
          setProducts(result.data as Product[]);
        } else {
          console.error(result.error);
        }
      } catch (error) {
        console.error('Error fetching products:', error);
      } finally {
        if (showLoading) setProductsLoading(false);
      }

      // Fetch Categories
      try {
        const result = await getCategoriesAction();
        if (result.success && result.data) {
          setCategories(result.data as Category[]);
        }
      } catch (error) {
        console.error('Error fetching categories:', error);
      } finally {
        if (showLoading) setCategoriesLoading(false);
      }
    };

    fetchData(true);

    // Polling interval (Replace Realtime)
    const intervalId = setInterval(() => {
      if (isPolling.current) {
        fetchData(false);
      }
    }, 10000); // 10s polling

    return () => {
      clearInterval(intervalId);
      isPolling.current = false;
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
