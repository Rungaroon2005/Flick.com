import { useEffect, useState } from 'react';
import type { useRouter } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/apiClient';

type MovieActions = { liked: boolean; bookmarked: boolean };
export type PendingAction = 'like' | 'favorite' | null;

export function useMovieActions(
  movieId: string | null,
  episodeId: string,
  router: ReturnType<typeof useRouter>,
  enabled = true,
) {
  const [liked, setLiked] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [actionsForMovieId, setActionsForMovieId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const movieActionsLoading = movieId === null || actionsForMovieId !== movieId;

  useEffect(() => {
    if (!movieId || !enabled || actionsForMovieId === movieId) return;

    let cancelled = false;
    void apiFetch<MovieActions>(`/me/movies/${movieId}/actions`)
      .then((actions) => {
        if (cancelled) return;
        setLiked(actions.liked);
        setBookmarked(actions.bookmarked);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) router.push('/login');
        else setNotice('ไม่สามารถโหลดสถานะถูกใจและรายการโปรดได้');
      })
      .finally(() => {
        if (!cancelled) setActionsForMovieId(movieId);
      });

    return () => {
      cancelled = true;
    };
  }, [actionsForMovieId, enabled, movieId, router]);

  const addDownload = async () => {
    setNotice(null);
    try {
      await apiFetch(`/me/downloads/${episodeId}`, { method: 'PUT' });
      setNotice('บันทึกรายการดาวน์โหลดแล้ว');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push('/login');
      else setNotice(err instanceof ApiError ? err.message : 'ไม่สามารถบันทึกรายการดาวน์โหลดได้');
    }
  };

  const toggleLike = async () => {
    if (!movieId || pendingAction) return;
    const shouldLike = !liked;
    setPendingAction('like');
    setNotice(null);
    try {
      const result = await apiFetch<{ liked: boolean }>(`/me/likes/${movieId}`, {
        method: shouldLike ? 'PUT' : 'DELETE',
      });
      setLiked(result.liked);
      setNotice(result.liked ? 'ถูกใจเรื่องนี้แล้ว' : 'ยกเลิกถูกใจแล้ว');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push('/login');
      else setNotice(err instanceof ApiError ? err.message : 'ไม่สามารถอัปเดตการถูกใจได้');
    } finally {
      setPendingAction(null);
    }
  };

  const toggleFavorite = async () => {
    if (!movieId || pendingAction) return;
    const shouldBookmark = !bookmarked;
    setPendingAction('favorite');
    setNotice(null);
    try {
      const result = await apiFetch<{ bookmarked: boolean }>(`/me/bookmarks/${movieId}`, {
        method: shouldBookmark ? 'PUT' : 'DELETE',
      });
      setBookmarked(result.bookmarked);
      setNotice(result.bookmarked ? 'เพิ่มในรายการโปรดแล้ว' : 'นำออกจากรายการโปรดแล้ว');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push('/login');
      else setNotice(err instanceof ApiError ? err.message : 'ไม่สามารถอัปเดตรายการโปรดได้');
    } finally {
      setPendingAction(null);
    }
  };

  return {
    liked,
    bookmarked,
    movieActionsLoading,
    pendingAction,
    notice,
    toggleLike,
    toggleFavorite,
    addDownload,
  };
}
