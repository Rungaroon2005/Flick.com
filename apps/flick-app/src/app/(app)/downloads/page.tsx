import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/apiClient';
import { apiFetchServer, getSession } from '@/lib/session';
import { withNext } from '@/lib/nextParam';
import type { DownloadRecord } from '@/types';
import DownloadsClient from './DownloadsClient';

export default async function DownloadsPage() {
  const session = await getSession();
  if (!session) redirect(withNext('/login', '/downloads'));

  let downloads: DownloadRecord[] = [];
  let sessionExpired = false;
  try {
    downloads = await apiFetchServer('/me/downloads');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      sessionExpired = true;
    } else {
      console.error('Error fetching downloads:', err);
    }
  }
  if (sessionExpired) redirect(withNext('/login', '/downloads'));

  return <DownloadsClient initialDownloads={downloads} />;
}
