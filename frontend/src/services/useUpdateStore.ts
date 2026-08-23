import { useSyncExternalStore } from 'react';
import { updateStore, UpdateState } from './updateStore';

export function useUpdateStore(): UpdateState {
  return useSyncExternalStore(updateStore.subscribe, updateStore.getState);
}
