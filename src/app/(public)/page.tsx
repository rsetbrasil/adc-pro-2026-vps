

'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Product, Category } from '@/lib/types';
import ProductCard from '@/components/ProductCard';
import ProductFilters from '@/components/ProductFilters';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import Autoplay from "embla-carousel-autoplay";
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import FilterSheet from '@/components/FilterSheet';
import { useData } from '@/context/DataContext';
import { Skeleton } from '@/components/ui/skeleton';
import { useCart } from '@/context/CartContext';


const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
};


export default function Home() {
  const { products: allProducts, categories, isLoading } = useData();
  const { headerSearch, setHeaderSearch } = useCart();

  const [filters, setFilters] = useState({
    category: 'all',
    subcategory: 'all',
    search: '',
    sort: 'newest',
  });

  useEffect(() => {
    if (headerSearch) {
      setFilters(prev => ({ ...prev, search: headerSearch }));
    }
  }, [headerSearch]);

  const handleFilterChange = (
    newFilters: Partial<typeof filters>
  ) => {
    setFilters((prevFilters) => {
      const updated = { ...prevFilters, ...newFilters };
      // Reset subcategory if parent category changes
      if (newFilters.category && newFilters.category !== prevFilters.category) {
        updated.subcategory = 'all';
      }
      return updated;
    });
    // When filters are changed from the filter components, clear the header search
    if (newFilters.search !== undefined) {
      setHeaderSearch(newFilters.search);
    }
  };

  const saleProducts = useMemo(() => {
    return allProducts.filter(p => p.onSale && !p.isHidden);
  }, [allProducts]);

  // Produtos em destaque - combina promoções com produtos normais para garantir mínimo de 3
  const featuredProducts = useMemo(() => {
    const MIN_FEATURED = 3;
    const promos = allProducts.filter(p => p.onSale && !p.isHidden && p.stock > 0);

    if (promos.length >= MIN_FEATURED) {
      return promos.slice(0, 6); // Max 6 produtos
    }

    // Completar com produtos normais (não em promoção) que tenham estoque
    const normalProducts = allProducts
      .filter(p => !p.onSale && !p.isHidden && p.stock > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); // Mais recentes primeiro

    const combined = [...promos, ...normalProducts].slice(0, MIN_FEATURED);
    return combined;
  }, [allProducts]);

  const filteredAndSortedProducts = useMemo(() => {
    let filtered = [...allProducts].filter(p => !p.isHidden);

    if (filters.category !== 'all') {
      filtered = filtered.filter((p) => p.category === filters.category);
    }

    if (filters.subcategory !== 'all') {
      filtered = filtered.filter((p) => p.subcategory === filters.subcategory);
    }

    if (filters.search) {
      filtered = filtered.filter((p) =>
        p.name.toLowerCase().includes(filters.search.toLowerCase())
      );
    }

    // Split into available and unavailable
    const available = filtered.filter(p => p.stock > 0);
    const unavailable = filtered.filter(p => p.stock <= 0);

    const sortArray = (arr: Product[]) => {
      switch (filters.sort) {
        case 'price-asc':
          arr.sort((a, b) => a.price - b.price);
          break;
        case 'price-desc':
          arr.sort((a, b) => b.price - a.price);
          break;
        case 'newest':
          arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          break;
        default: // relevance
          // No specific relevance logic, using default order
          break;
      }
      return arr;
    }

    // Sort each array individually and then concatenate
    return [...sortArray(available), ...sortArray(unavailable)];

  }, [filters, allProducts]);

  const ProductGridSkeleton = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex flex-col space-y-3">
          <Skeleton className="h-[250px] w-full rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-[250px]" />
            <Skeleton className="h-4 w-[200px]" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <FilterSheet
        categories={categories}
        onFilterChange={handleFilterChange}
        currentFilters={filters}
      />
      {featuredProducts.length > 0 && (
        <section className="w-full bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5">
          <div className="container mx-auto py-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-primary flex items-center gap-2">
                <span className="text-3xl">🔥</span> Destaques
              </h2>
            </div>
            <Carousel
              opts={{
                align: "start",
                loop: featuredProducts.length > 3,
              }}
              plugins={[
                Autoplay({
                  delay: 4000,
                }),
              ]}
              className="w-full"
            >
              <CarouselContent>
                {featuredProducts.map((product) => (
                  <CarouselItem
                    key={product.id}
                    className="md:basis-1/2 lg:basis-1/3"
                  >
                    <div className="p-2 h-full">
                      <Link href={`/produtos/${product.id}`} className="block h-full">
                        <Card className="h-full overflow-hidden flex flex-col md:flex-row justify-between transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 border-2 border-transparent hover:border-accent/30">
                          <CardContent className="flex flex-col md:flex-row items-center text-center md:text-left p-6 gap-6 w-full">
                            <div className="relative w-64 h-64 md:w-44 md:h-44 flex-shrink-0 rounded-lg overflow-hidden bg-muted/50 mx-auto">
                              <Badge
                                className={`absolute top-2 left-2 z-10 ${product.onSale
                                  ? 'bg-destructive text-destructive-foreground'
                                  : 'bg-primary text-primary-foreground'
                                  }`}
                              >
                                {product.onSale ? '🏷️ Promoção' : '⭐ Destaque'}
                              </Badge>
                              <Image
                                src={(product.imageUrls && product.imageUrls.length > 0) ? product.imageUrls[0] : 'https://placehold.co/400x400.png'}
                                alt={product.name}
                                fill
                                className="object-contain p-2"
                                sizes="50vw"
                              />
                            </div>
                            <div className="flex flex-col justify-between flex-grow">
                              <div>
                                <h3 className="text-lg font-bold leading-tight line-clamp-2">{product.name}</h3>
                                <p className="text-muted-foreground text-sm mt-2 line-clamp-2">{product.description}</p>
                              </div>
                              <div className="mt-4">
                                {product.onSale && typeof product.originalPrice === 'number' && product.originalPrice > 0 && (
                                  <p className="text-sm text-muted-foreground line-through">{formatCurrency(product.price)}</p>
                                )}
                                <p className="text-2xl font-bold text-accent">
                                  {product.onSale && typeof product.originalPrice === 'number' && product.originalPrice > 0
                                    ? formatCurrency(product.originalPrice)
                                    : formatCurrency(product.price)
                                  }
                                </p>
                                <Button className="mt-3 w-full bg-accent hover:bg-accent/90">Ver Detalhes</Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {featuredProducts.length > 3 && (
                <>
                  <CarouselPrevious className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 bg-background shadow-lg" />
                  <CarouselNext className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 bg-background shadow-lg" />
                </>
              )}
            </Carousel>
          </div>
        </section>
      )}

      <div id="catalog" className="container mx-auto px-4 py-8">
        <ProductFilters
          onFilterChange={handleFilterChange}
          categories={categories}
          currentFilters={filters}
        />

        {isLoading ? (
          <ProductGridSkeleton />
        ) : filteredAndSortedProducts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {filteredAndSortedProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-lg text-muted-foreground">Nenhum produto encontrado.</p>
          </div>
        )}
      </div>
    </>
  );
}
