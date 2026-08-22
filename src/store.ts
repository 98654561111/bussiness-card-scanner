/* ============================================================
 * 資料儲存：IndexedDB（localStorage 後備）+ 設定檔
 * ============================================================ */

import { Card, DEFAULT_SETTINGS, Settings } from './types'

const DB_NAME = 'bcs-db'
const STORE = 'cards'
const LS_FALLBACK = 'bcs-cards-v1'
const LS_SETTINGS = 'bcs-settings-v1'

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (!('indexedDB' in window)) return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function lsAll(): Card[] {
  try {
    return JSON.parse(localStorage.getItem(LS_FALLBACK) || '[]')
  } catch {
    return []
  }
}
function lsSaveAll(cards: Card[]): void {
  localStorage.setItem(LS_FALLBACK, JSON.stringify(cards))
}

export async function saveCard(card: Card): Promise<void> {
  const db = await openDB()
  if (db) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(card)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return
  }
  const all = lsAll()
  const i = all.findIndex((c) => c.id === card.id)
  if (i >= 0) all[i] = card
  else all.unshift(card)
  lsSaveAll(all)
}

export async function deleteCard(id: string): Promise<void> {
  const db = await openDB()
  if (db) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return
  }
  lsSaveAll(lsAll().filter((c) => c.id !== id))
}

export async function getAllCards(): Promise<Card[]> {
  const db = await openDB()
  if (db) {
    const cards = await new Promise<Card[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve(req.result as Card[])
      req.onerror = () => reject(req.error)
    })
    return cards.sort((a, b) => b.createdAt - a.createdAt)
  }
  return lsAll().sort((a, b) => b.createdAt - a.createdAt)
}

export async function clearAllCards(): Promise<void> {
  const db = await openDB()
  if (db) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return
  }
  lsSaveAll([])
}

export async function importCards(cards: Card[]): Promise<number> {
  const existing = new Set((await getAllCards()).map((c) => `${c.name}|${c.company}|${c.createdAt}`))
  let n = 0
  for (const raw of cards) {
    if (!raw || typeof raw !== 'object') continue
    const card: Card = {
      ...raw,
      id: uid(),
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Date.now(),
      phones: raw.phones ?? [],
      faxes: raw.faxes ?? [],
      emails: raw.emails ?? [],
      tags: raw.tags ?? [],
      imageCropped: raw.imageCropped || '',
      imageOriginal: raw.imageOriginal || '',
    } as Card
    const key = `${card.name}|${card.company}|${card.createdAt}`
    if (existing.has(key)) continue
    existing.add(key)
    await saveCard(card)
    n++
  }
  return n
}

/* ---------- 設定 ---------- */

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}')
    const merged: Settings = {
      ...DEFAULT_SETTINGS,
      ...raw,
      openai: { ...DEFAULT_SETTINGS.openai, ...(raw.openai || {}) },
      gemini: { ...DEFAULT_SETTINGS.gemini, ...(raw.gemini || {}) },
      custom: { ...DEFAULT_SETTINGS.custom, ...(raw.custom || {}) },
    }
    // 舊版 autoShutter 遷移到 captureMode
    if (!raw.captureMode && raw.autoShutter) merged.captureMode = 'stable'
    if (!['manual', 'stable', 'best'].includes(merged.captureMode)) merged.captureMode = 'stable'
    return merged
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(s))
}
