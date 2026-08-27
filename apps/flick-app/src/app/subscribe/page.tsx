import { redirect } from 'next/navigation';
import SubscribeClient from './SubscribeClient';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { ToastProvider } from '@/components/ui/Toast';
import API_BASE_URL from '@/lib/api';
import { getSession } from '@/lib/session';
import { withNext } from '@/lib/nextParam';
import type { CoinPack, SubscriptionPlan } from '@/types';
import { decodePlans } from '@/types/api';

interface PlansResponse {
  subscriptions: SubscriptionPlan[];
  coins: CoinPack[];
}

async function getPlans(): Promise<PlansResponse> {
  const response = await fetch(`${API_BASE_URL}/plans`, { next: { revalidate: 300 } });
  if (!response.ok) throw new Error('Failed to fetch plans');
  return decodePlans(await response.json());
}

// Keep plan selection inside the authenticated membership area, even while
// paid actions are disabled pending a payment-gateway integration.
//
// Safe for the registration flow: /register only pushes here after POST
// /auth/register has already set the session cookie, so the cookie exists by
// the time this Server Component runs.
export default async function SubscribePage() {
  const session = await getSession();
  if (!session) redirect(withNext('/login', '/subscribe'));

  let data: PlansResponse | null = null;
  try {
    data = await getPlans();
  } catch (error) {
    console.error('Error fetching plans on server:', error);
  }

  if (!data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink px-6">
        <ErrorPanel message="ไม่สามารถโหลดแพ็กเกจได้" />
      </div>
    );
  }

  return (
    <ToastProvider>
      <SubscribeClient plans={data.subscriptions} coinPacks={data.coins} />
    </ToastProvider>
  );
}
