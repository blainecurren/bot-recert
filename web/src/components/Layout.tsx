import type { ReactNode } from 'react';
import UserBadge from './auth/UserBadge';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="flex items-center justify-between border-b bg-white px-4 py-3 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">Recert Assistant</h1>
        <UserBadge />
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
