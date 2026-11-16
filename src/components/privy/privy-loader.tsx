"use client";

import dynamic from "next/dynamic";

/**
 * Carrega o SDK Privy somente no navegador e somente quando renderizado
 * (modo `privy`). No modo simulado este chunk nunca é solicitado.
 */
export const PrivyLoader = dynamic(() => import("./privy-root"), { ssr: false, loading: () => null });
