import dotenv from 'dotenv';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: '../.env' });
dotenv.config();

async function main() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    console.error("Missing FIREBASE_SERVICE_ACCOUNT");
    process.exit(1);
  }

  const serviceAccount = JSON.parse(serviceAccountJson);
  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount)
    });
  }

  const db = getFirestore();
  const snap = await db.collection('campaigns').get();
  
  for (const doc of snap.docs) {
    const data = doc.data();
    console.log(`Campaign ${doc.id} - Status: ${data.status}, Sent: ${data.sentCount}, Failed: ${data.failedCount}, Total: ${data.totalUsers}`);
  }
  
  process.exit(0);
}

main().catch(console.error);
