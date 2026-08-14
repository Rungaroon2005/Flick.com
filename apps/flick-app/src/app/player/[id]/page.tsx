import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import PlayerClient from './PlayerClient';

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id: episodeId } = await params;
  return <PlayerClient episodeId={episodeId} />;
}
