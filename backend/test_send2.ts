import dotenv from 'dotenv';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

dotenv.config({ path: '../.env' });
dotenv.config();

async function main() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const apiId = Number(process.env.API_ID);
  const apiHash = process.env.API_HASH;

  if (!getApps().length) {
    initializeApp({
      credential: cert(JSON.parse(serviceAccountJson!))
    });
  }
  const db = getFirestore();
  
  const userSnap = await db.collection('users').limit(1).get();
  if (userSnap.empty) return console.log('No users found in db');
  const sessionString = userSnap.docs[0].data().sessionString;
  
  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash!, { connectionRetries: 1 });
  await client.connect();

  console.log('Fetching dialogs to find a group...');
  const dialogs = await client.getDialogs({});
  const group = dialogs.find(d => d.isGroup || d.isChannel);
  
  if (!group) return console.log('No group found');
  console.log(`Getting participants for ${group.title}...`);
  
  const participants = await client.getParticipants(group.id, { limit: 10 });
  if (!participants.length) return console.log('No participants found');
  
  const target = participants.find(p => !p.bot && !p.deleted);
  if (!target) return console.log('No target found');
  
  const targetIdStr = target.id!.toString();
  console.log(`Target: ${target.firstName} (${targetIdStr})`);

  try {
      console.log('Attempting to send as string...');
      await client.sendMessage(targetIdStr, { message: 'Test message string' });
      console.log('String SUCCESS!');
  } catch(e: any) {
      console.error('String FAILED:', e?.message || e);
  }

  try {
      console.log('Attempting to send as BigInt...');
      await client.sendMessage(BigInt(targetIdStr), { message: 'Test message bigint' });
      console.log('BigInt SUCCESS!');
  } catch(e: any) {
      console.error('BigInt FAILED:', e?.message || e);
  }
  
  process.exit(0);
}

main().catch(console.error);
