import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgentHub',
  description: 'AI Native Collaboration OS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
