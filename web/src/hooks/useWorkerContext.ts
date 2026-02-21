/**
 * Hook: useWorkerContext
 * Fetches the authenticated user's profile and linked worker from /api/auth/me.
 */

import { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import api from '../config/api';

interface Worker {
  id: string;
  identifier: string;
  name: string;
  active: boolean;
}

interface WorkerContext {
  user: { email: string; name: string; oid: string } | null;
  worker: Worker | null;
  mapped: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useWorkerContext(): WorkerContext {
  const { accounts } = useMsal();
  const [user, setUser] = useState<WorkerContext['user']>(null);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [mapped, setMapped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const account = accounts[0];

  useEffect(() => {
    if (!account) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .get('/auth/me')
      .then(({ data }) => {
        if (cancelled) return;
        setUser(data.user);
        setWorker(data.worker);
        setMapped(data.mapped);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.error || 'Failed to load profile');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [account, trigger]);

  const refresh = () => setTrigger((t) => t + 1);

  return { user, worker, mapped, loading, error, refresh };
}
