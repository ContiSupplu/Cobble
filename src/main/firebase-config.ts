import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: 'AIzaSyDqVh8cp1_zW_BYFF55IihLBo91bMN-Tbw',
  authDomain: 'loom-cards.firebaseapp.com',
  projectId: 'loom-cards',
  storageBucket: 'loom-cards.firebasestorage.app',
  messagingSenderId: '387698383350',
  appId: '1:387698383350:web:569c2834c57aa3ee96cfd7'
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const storage = getStorage(app)
