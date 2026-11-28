import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type RecordParams } from "../api/client";

export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: 60_000 });

export const useBoard = (date: string | undefined) =>
  useQuery({
    queryKey: ["board", date],
    queryFn: () => api.board(date!),
    enabled: !!date,
    refetchInterval: 120_000,
  });

export const usePlay = (id: string | null) =>
  useQuery({ queryKey: ["play", id], queryFn: () => api.play(id!), enabled: !!id });

export const useDates = (from: string, to: string, enabled: boolean) =>
  useQuery({ queryKey: ["dates", from, to], queryFn: () => api.dates(from, to), enabled });

export function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["board"] });
    qc.invalidateQueries({ queryKey: ["play"] });
    qc.invalidateQueries({ queryKey: ["dates"] });
    qc.invalidateQueries({ queryKey: ["record"] });
  };
}

export function usePlayState() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; patch: Partial<{ saved: boolean; dismissed: boolean }> }) =>
      api.setState(v.id, v.patch),
    onSuccess: inv,
  });
}

export function useSetPrice() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; odds: string | null; line?: number | null }) =>
      v.odds == null ? api.clearPrice(v.id) : api.setPrice(v.id, v.odds, v.line),
    onSuccess: inv,
  });
}

export const useRecord = (p: RecordParams) =>
  useQuery({ queryKey: ["record", p], queryFn: () => api.record(p), refetchInterval: 300_000 });

/** Log the bet you placed on a board play, or remove it. */
export function useTogglePick() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (v: { playId: string; pickId: string | null }): Promise<void> => {
      if (v.pickId) await api.deletePick(v.pickId);
      else await api.pickPlay(v.playId);
    },
    onSuccess: inv,
  });
}
