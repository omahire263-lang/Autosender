import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let db: Firestore;

export async function initDb() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  
  if (!serviceAccountJson) {
    console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT environment variable is missing!");
    return;
  }
  
  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    if (!getApps().length) {
      initializeApp({
        credential: cert(serviceAccount)
      });
    }
    db = getFirestore();
    console.log("🔥 Firebase Firestore initialized successfully!");
  } catch (error) {
    console.error("❌ Failed to initialize Firebase:", error);
  }
}

export function getDb() {
  if (!db) throw new Error("Firebase DB not initialized yet");
  return db;
}
