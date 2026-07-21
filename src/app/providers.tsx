"use client";
// App-wide client providers. layout.tsx stays a server component and wraps
// children with this. QueryClient lives in state so React strict-mode double
// renders never recreate the cache mid-flight.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="bottom-right" richColors />
      {process.env.NODE_ENV === "development" ? <ReactQueryDevtools initialIsOpen={false} /> : null /* guard-allow(no-raw-env): client bundle — NODE_ENV statically inlined by Next; env.ts is server-only */}
    </QueryClientProvider>
  );
}
