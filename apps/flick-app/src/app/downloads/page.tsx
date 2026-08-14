import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/apiClient';
import { apiFetchServer, getSession } from '@/lib/session';
import type { DownloadRecord } from '@/types';
import DownloadsClient from './DownloadsClient';

export default async function DownloadsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  let downloads: DownloadRecord[] = [];
  let sessionExpired = false;
  try {
    downloads = await apiFetchServer<DownloadRecord[]>('/me/downloads');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      sessionExpired = true;
    } else {
      console.error('Error fetching downloads:', err);
    }
  }
  if (sessionExpired) redirect('/login');

  return <DownloadsClient initialDownloads={downloads} />;
}
