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
  
  console.log('Connecting...');
  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash!, { connectionRetries: 1 });
  await client.connect();
  console.log('Connected!');

  const campaignSnap = await db.collection('campaigns').where('status', '==', 'Sending').get();
  if (campaignSnap.empty) return console.log('No sending campaigns');
  const campaign = campaignSnap.docs[0].data();
  
  let targetUser = '';
  try {
     const users = JSON.parse(campaign.remainingUsers);
     targetUser = users[0];
  } catch(e){}

  if (!targetUser) return console.log('No target users in campaign');

  console.log(`Attempting to send message to ${targetUser}...`);
  
  let peer: any = targetUser;
  if (/^-?\d+$/.test(targetUser)) {
      peer = BigInt(targetUser);
  }

  try {
      await client.sendMessage(peer, { message: 'Test message from backend script' });
      console.log('SUCCESS!');
  } catch(e: any) {
      console.error('FAILED TO SEND:', e?.message || e);
  }
  
  process.exit(0);
}

main().catch(console.error);
