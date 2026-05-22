import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { announcementApi } from '../services/api';
import type { Announcement } from '../types';

const READ_IDS_KEY = 'mumu_announcements_read_ids';
const LAST_SYNC_KEY = 'mumu_announcements_last_sync_at';
const CACHE_ITEMS_KEY = 'mumu_announcements_cached_items';
const LAST_FULL_SYNC_KEY = 'mumu_announcements_last_full_sync_at';
const DEFAULT_SYNC_INTERVAL = 5 * 60 * 1000;
const FULL_SYNC_INTERVAL = 60 * 60 * 1000;

const loadReadIds = (): string[] => {
  try {
    const raw = localStorage.getItem(READ_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch (error) {
    console.warn('读取公告已读缓存失败:', error);
    return [];
  }
};

const saveReadIds = (ids: string[]) => {
  try {
    localStorage.setItem(READ_IDS_KEY, JSON.stringify(Array.from(new Set(ids))));
  } catch (error) {
    console.warn('保存公告已读缓存失败:', error);
  }
};

const loadLastSyncAt = (): string | undefined => {
  try {
    return localStorage.getItem(LAST_SYNC_KEY) || undefined;
  } catch (error) {
    console.warn('读取公告同步缓存失败:', error);
    return undefined;
  }
};

const saveLastSyncAt = (value?: string | null) => {
  if (!value) return;
  try {
    localStorage.setItem(LAST_SYNC_KEY, value);
  } catch (error) {
    console.warn('保存公告同步缓存失败:', error);
  }
};

const loadLastFullSyncAt = (): number => {
  try {
    const raw = localStorage.getItem(LAST_FULL_SYNC_KEY);
    return raw ? Number(raw) || 0 : 0;
  } catch (error) {
    console.warn('读取公告全量同步缓存失败:', error);
    return 0;
  }
};

const saveLastFullSyncAt = (value: number) => {
  try {
    localStorage.setItem(LAST_FULL_SYNC_KEY, String(value));
  } catch (error) {
    console.warn('保存公告全量同步缓存失败:', error);
  }
};

const loadCachedAnnouncements = (): Announcement[] => {
  try {
    const raw = localStorage.getItem(CACHE_ITEMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Announcement => Boolean(item?.id && item?.title && item?.content));
  } catch (error) {
    console.warn('读取公告列表缓存失败:', error);
    return [];
  }
};

const saveCachedAnnouncements = (items: Announcement[]) => {
  try {
    localStorage.setItem(CACHE_ITEMS_KEY, JSON.stringify(items.slice(0, 100)));
  } catch (error) {
    console.warn('保存公告列表缓存失败:', error);
  }
};

const sortAnnouncements = (items: Announcement[]) => {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const aTime = new Date(a.publish_at || a.created_at || a.updated_at || 0).getTime();
    const bTime = new Date(b.publish_at || b.created_at || b.updated_at || 0).getTime();
    return bTime - aTime;
  });
};

const pruneByActiveIds = (items: Announcement[], activeIds?: string[]) => {
  if (!activeIds) {
    return items;
  }
  const activeSet = new Set(activeIds);
  return items.filter(item => activeSet.has(item.id));
};

const mergeAnnouncements = (current: Announcement[], incoming: Announcement[], activeIds?: string[]) => {
  const map = new Map<string, Announcement>();
  pruneByActiveIds(current, activeIds).forEach(item => map.set(item.id, item));
  incoming.forEach(item => map.set(item.id, item));
  return sortAnnouncements(Array.from(map.values()));
};

const shouldFullSync = (lastFullSyncAt: number) => {
  return Date.now() - lastFullSyncAt > FULL_SYNC_INTERVAL;
};

export function useAnnouncements(syncInterval: number = DEFAULT_SYNC_INTERVAL) {
  const [announcements, setAnnouncements] = useState<Announcement[]>(() => sortAnnouncements(loadCachedAnnouncements()));
  const [loading, setLoading] = useState(false);
  const [readIds, setReadIds] = useState<string[]>(() => loadReadIds());
  const lastSyncAtRef = useRef<string | undefined>(loadLastSyncAt());
  const lastFullSyncAtRef = useRef<number>(loadLastFullSyncAt());
  const syncingRef = useRef(false);

  const hasUnread = useMemo(
    () => announcements.some(item => !readIds.includes(item.id)),
    [announcements, readIds],
  );

  const refresh = useCallback(async (options?: { full?: boolean }) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setLoading(true);

    try {
      const full = Boolean(options?.full || !lastSyncAtRef.current || shouldFullSync(lastFullSyncAtRef.current));
      const response = full
        ? await announcementApi.list({ page: 1, limit: 100 })
        : await announcementApi.sync({ since: lastSyncAtRef.current, limit: 100 });

      const items = response.data?.items || [];
      const activeIds = response.data?.active_ids;
      let nextAnnouncements: Announcement[] = [];
      setAnnouncements(prev => {
        nextAnnouncements = full ? sortAnnouncements(items) : mergeAnnouncements(prev, items, activeIds);
        saveCachedAnnouncements(nextAnnouncements);
        return nextAnnouncements;
      });

      if (activeIds) {
        setReadIds(prev => {
          const activeSet = new Set(activeIds);
          const nextIds = prev.filter(id => activeSet.has(id));
          saveReadIds(nextIds);
          return nextIds;
        });
      }

      const latest = response.data?.latest_updated_at || response.data?.server_time;
      if (latest) {
        lastSyncAtRef.current = latest;
        saveLastSyncAt(latest);
      }

      if (full) {
        const now = Date.now();
        lastFullSyncAtRef.current = now;
        saveLastFullSyncAt(now);
      }
    } catch (error) {
      console.warn('同步公告失败:', error);
    } finally {
      syncingRef.current = false;
      setLoading(false);
    }
  }, []);

  const markAllRead = useCallback(() => {
    const nextIds = Array.from(new Set([...readIds, ...announcements.map(item => item.id)]));
    setReadIds(nextIds);
    saveReadIds(nextIds);
  }, [announcements, readIds]);

  useEffect(() => {
    void refresh({ full: announcements.length === 0 || shouldFullSync(lastFullSyncAtRef.current) });

    const timer = window.setInterval(() => {
      void refresh();
    }, syncInterval);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void refresh({ full: shouldFullSync(lastFullSyncAtRef.current) });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [announcements.length, refresh, syncInterval]);

  return {
    announcements,
    loading,
    hasUnread,
    refresh,
    markAllRead,
  };
}
