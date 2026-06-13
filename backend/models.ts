import * as admin from 'firebase-admin';

let db: admin.firestore.Firestore;

export async function initDb() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  
  if (!serviceAccountJson) {
    console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT environment variable is missing!");
    console.warn("Please add it to your .env file to enable the database.");
    return;
  }
  
  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    db = admin.firestore();
    console.log("🔥 Firebase Firestore initialized successfully!");
  } catch (error) {
    console.error("❌ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON. Please check its format.", error);
  }
}

export function getDb() {
  if (!db) throw new Error("Firebase DB not initialized yet");
  return db;
}
