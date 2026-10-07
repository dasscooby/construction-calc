// The paper size for plan sets, remembered on this phone (Letter until changed).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { PaperId, paperOf } from '../report/pager';

const KEY = 'plan-paper';
let current: PaperId = 'letter';
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((v) => {
      if (v && paperOf(v).id === v) {
        current = v as PaperId;
        listeners.forEach((l) => l());
      }
    })
    .catch(() => {});
}

export function setPaper(id: PaperId) {
  current = paperOf(id).id;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, current).catch(() => {});
}

export function usePaper(): PaperId {
  const [id, setId] = useState(current);
  useEffect(() => {
    load();
    const l = () => setId(current);
    listeners.add(l);
    l();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return id;
}
