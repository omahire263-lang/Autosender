import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as admin from 'firebase-admin';
import { initDb, getDb } from './models';

dotenv.config();

const app = express();
const allowedOrigins = [
  'http://localhost:5173',
  process.env.FRONTEND_URL,
  'https://autosender-p3gue3tpb-omahire21s-projects.vercel.app',
  'https://autosender-web.vercel.app'
].filter(Boolean);

app.use(cors({ 
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }, 
  credentials: true 
}));
app.use(express.json());

const PORT = process.env.PORT || 5000;
const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const SESSION_COOKIE = 'tg_session_token';
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

if (!process.env.API_ID || !apiHash) {
  throw new Error('API_ID and API_HASH are required in .env');
}

if (!Number.isFinite(apiId) || apiId <= 0) {
  throw new Error('API_ID must be a valid positive number');
}

let client: TelegramClient | null = null;
let activeSessionToken: string | null = null;

const getErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : 'Unknown error';
};

const parseCookies = (cookieHeader: string | undefined) => {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach(cookie => {
    const [rawName, ...rawValue] = cookie.trim().split('=');
    if (rawName) {
      cookies[rawName] = rawValue.join('=');
    }
  });

  return cookies;
};

const getSessionToken = (req: express.Request) => {
  const cookieToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const headerToken = req.headers.authorization?.split(' ')[1];
  return cookieToken || headerToken || null;
};

const setSessionCookie = (res: express.Response, token: string) => {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`
  );
};

const clearSessionCookie = (res: express.Response) => {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
};

const getActiveClient = async (res: express.Response): Promise<TelegramClient | null> => {
  if (!client || !activeSessionToken) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }

  return client;
};

app.post('/api/auth/send-code', async (req, res) => {
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';

  if (phone.length < 8) {
    return res.status(400).json({ error: 'Valid phone number is required' });
  }

  try {
    const stringSession = new StringSession('');
    const nextClient = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await nextClient.connect();

    await nextClient.sendCode({ apiId, apiHash }, phone);
    client = nextClient;
    activeSessionToken = null;

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }

  if (!client) {
    return res.status(400).json({ error: 'Send OTP first' });
  }

  try {
    await client.signInUser(
      { apiId, apiHash },
      {
        phoneNumber: async () => phone,
        phoneCode: async () => code,
        password: async () => '',
        onError: (err) => { throw err; }
      }
    );

    const sessionString = (client.session as StringSession).save() as string;
    const me = await client.getMe();

    if (!me) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const sessionToken = crypto.randomUUID();
    const db = getDb();
    
    await db.collection('users').doc(phone).set({
      phoneNumber: phone,
      sessionString,
      sessionToken,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    activeSessionToken = sessionToken;
    setSessionCookie(res, sessionToken);

    if (!isCampaignRunning) resumeCampaigns();

    res.json({
      success: true,
      user: me.username || me.firstName || 'User',
      token: sessionToken
    });
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/auth/init', async (req, res) => {
  const sessionToken = getSessionToken(req);

  if (!sessionToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const db = getDb();
    const userSnap = await db.collection('users').where('sessionToken', '==', sessionToken).limit(1).get();

    if (userSnap.empty) {
      return res.status(401).json({ error: 'Invalid session' });
    }
    
    const user = userSnap.docs[0].data();

    if (!user.sessionString) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const stringSession = new StringSession(user.sessionString);
    const nextClient = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await nextClient.connect();

    const me = await nextClient.getMe();

    if (!me) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    client = nextClient;
    activeSessionToken = sessionToken;

    if (!isCampaignRunning) resumeCampaigns();

    res.json({
      success: true,
      user: me.username || me.firstName || 'User',
      token: sessionToken
    });
  } catch (error) {
    res.status(401).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  client = null;
  activeSessionToken = null;
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/telegram/groups', async (req, res) => {
  const activeClient = await getActiveClient(res);
  if (!activeClient) return;

  try {
    const dialogs = await activeClient.getDialogs({});
    const groups = dialogs.filter(d => d.isGroup || d.isChannel);
    res.json({ groups: groups.map(g => ({ id: g.id?.toString(), title: g.title })) });
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/telegram/members', async (req, res) => {
  const activeClient = await getActiveClient(res);
  if (!activeClient) return;

  try {
    const rawGroupIds: unknown[] = Array.isArray(req.body.groupIds)
      ? req.body.groupIds
      : req.body.groupId
        ? [req.body.groupId]
        : [];

    const ids = rawGroupIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

    if (ids.length === 0) {
      return res.status(400).json({ error: 'Select at least one group' });
    }

    let allMembers: Array<{ id: string; username?: string; firstName?: string }> = [];

    for (const id of ids) {
      const participants = await activeClient.getParticipants(id, { limit: 5000 });
      const members = participants.map(p => ({
        id: p.id?.toString() || '',
        username: p.username,
        firstName: p.firstName
      })).filter(member => member.id.length > 0);

      allMembers = [...allMembers, ...members];
    }

    const uniqueMembers = Array.from(new Map(allMembers.map(item => [item.id, item])).values());
    
    const db = getDb();
    const sentSnapshot = await db.collection('sent_users').get();
    const sentUserIds = new Set(sentSnapshot.docs.map(doc => doc.id));

    const finalMembers = uniqueMembers.filter(m => !sentUserIds.has(m.id));

    res.json({ members: finalMembers });
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

let currentCampaign: {
  dbId: string;
  message: string;
  users: string[];
  sent: number;
  failed: number;
  baseDelay: number;
} | null = null;
let isCampaignRunning = false;

app.post('/api/campaign/start', async (req, res) => {
  const activeClient = await getActiveClient(res);
  if (!activeClient) return;

  const messageText = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  const rawUsers: unknown[] = Array.isArray(req.body.users) ? req.body.users : [];
  const users = Array.from(new Set(rawUsers.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)));
  const totalTimeHours = Number(req.body.totalTimeHours);

  if (!messageText) {
    return res.status(400).json({ error: 'Message is required' });
  }

  if (users.length === 0) {
    return res.status(400).json({ error: 'Users are required' });
  }

  if (!Number.isFinite(totalTimeHours) || totalTimeHours <= 0) {
    return res.status(400).json({ error: 'Valid duration in hours is required' });
  }

  const totalUsers = users.length;
  const totalTimeSeconds = Math.max(1, Math.round(totalTimeHours * 3600));
  const baseDelay = totalTimeSeconds / totalUsers;

  try {
    const db = getDb();
    const campaignRef = await db.collection('campaigns').add({
      message: messageText,
      status: 'Sending',
      totalUsers,
      estimatedTime: totalTimeSeconds,
      remainingUsers: JSON.stringify(users),
      baseDelay,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sentCount: 0,
      failedCount: 0
    });

    currentCampaign = {
      dbId: campaignRef.id,
      message: messageText,
      users,
      sent: 0,
      failed: 0,
      baseDelay
    };
    isCampaignRunning = true;

    res.json({ success: true, campaignId: campaignRef.id });

    runCampaign();
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/campaign/stop', async (req, res) => {
  isCampaignRunning = false;

  if (currentCampaign) {
    const db = getDb();
    await db.collection('campaigns').doc(currentCampaign.dbId).update({ status: 'Paused' });
  }

  res.json({ success: true });
});

app.post('/api/campaign/resume', async (req, res) => {
  if (!currentCampaign) {
    return res.status(400).json({ error: 'No paused campaign to resume' });
  }
  
  if (!isCampaignRunning) {
    isCampaignRunning = true;
    const db = getDb();
    await db.collection('campaigns').doc(currentCampaign.dbId).update({ status: 'Sending' });
    runCampaign();
  }

  res.json({ success: true });
});

app.post('/api/campaign/update-message', async (req, res) => {
  const messageText = typeof req.body.message === 'string' ? req.body.message.trim() : '';

  if (!messageText) {
    return res.status(400).json({ error: 'Message is required' });
  }

  if (currentCampaign) {
    currentCampaign.message = messageText;
    const db = getDb();
    await db.collection('campaigns').doc(currentCampaign.dbId).update({ message: messageText });
  }

  res.json({ success: true });
});

app.get('/api/campaign/status', async (req, res) => {
  if (!currentCampaign) return res.json({ status: null });

  const db = getDb();
  const doc = await db.collection('campaigns').doc(currentCampaign.dbId).get();
  res.json({ status: doc.exists ? doc.data() : null });
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function antiBanSpin(text: string): string {
  const homoglyphs: Record<string, string[]> = {
      'a': ['а'], 'c': ['с'], 'e': ['е'], 'o': ['о'], 
      'p': ['р'], 'x': ['х'], 'y': ['у'], 'i': ['і']
  };
  
  let result = '';
  let inUrl = false;
  
  for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      if (text.substring(i, i + 4) === 'http' || text.substring(i, i + 4) === 'www.' || text.substring(i, i + 4) === 't.me') {
          inUrl = true;
      }
      if (inUrl && (char === ' ' || char === '\n' || char === '\t')) {
          inUrl = false;
      }

      if (!inUrl && homoglyphs[char] && Math.random() > 0.4) {
          const options = homoglyphs[char];
          result += options[Math.floor(Math.random() * options.length)];
      } else {
          result += char;
      }
  }
  
  const lines = result.split('\n');
  const spinnedLines = lines.map(line => {
      if (line.includes('http') || line.includes('www.') || line.includes('t.me')) return line;
      
      const words = line.split(' ');
      return words.map(w => {
          if (w.trim() !== '' && Math.random() > 0.6) {
              const zws = ['\u200B', '\u200C', '\u200D'];
              return w + zws[Math.floor(Math.random() * zws.length)];
          }
          return w;
      }).join(' ');
  });
  
  let finalMsg = spinnedLines.join('\n');
  
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomId = '';
  for (let i = 0; i < 6; i++) {
      randomId += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  finalMsg += `\n\n\u200C[#${randomId}]`;
  
  return finalMsg;
}

async function runCampaign() {
  const activeClient = client;
  if (!activeClient || !currentCampaign) return;

  const campaign = currentCampaign;
  const db = getDb();

  while (isCampaignRunning && campaign.users.length > 0) {
    const userId = campaign.users.shift();
    if (!userId) continue;

    try {
      const uniqueMessage = antiBanSpin(campaign.message);
      await activeClient.sendMessage(userId, { message: uniqueMessage });
      campaign.sent++;
      await db.collection('sent_users').doc(userId).set({ 
        userId, 
        sentAt: admin.firestore.FieldValue.serverTimestamp() 
      }, { merge: true });
    } catch (error) {
      console.error('Failed to send to', userId, error);
      campaign.failed++;
    }

    await db.collection('campaigns').doc(campaign.dbId).update({
      sentCount: campaign.sent,
      failedCount: campaign.failed,
      status: campaign.users.length === 0 ? 'Completed' : 'Sending',
      remainingUsers: JSON.stringify(campaign.users)
    });

    if (campaign.users.length === 0) {
      isCampaignRunning = false;
      break;
    }

    const delay = campaign.baseDelay * 1000 + (Math.random() * 10000 - 5000);
    await sleep(Math.max(1000, delay));
  }
}

async function resumeCampaigns() {
  const db = getDb();
  const cSnap = await db.collection('campaigns').where('status', '==', 'Sending').limit(1).get();
  if (!cSnap.empty) {
      const activeDbCampaign = { id: cSnap.docs[0].id, ...(cSnap.docs[0].data()) } as any;
      if (activeDbCampaign.remainingUsers) {
          try {
            const remaining = JSON.parse(activeDbCampaign.remainingUsers);
            if (remaining.length > 0) {
                currentCampaign = {
                    dbId: activeDbCampaign.id,
                    message: activeDbCampaign.message,
                    users: remaining,
                    sent: activeDbCampaign.sentCount || 0,
                    failed: activeDbCampaign.failedCount || 0,
                    baseDelay: activeDbCampaign.baseDelay || ((activeDbCampaign.estimatedTime || 3600) / (activeDbCampaign.totalUsers || 1))
                };
                isCampaignRunning = true;
                console.log('Resuming campaign from DB', currentCampaign.dbId);
                runCampaign();
            }
          } catch (e) {
            console.error('Failed to resume campaign', e);
          }
      }
  }
}

initDb().then(async () => {
  console.log('Firebase DB initialized');
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

  try {
    const db = getDb();
    const userSnap = await db.collection('users').orderBy('createdAt', 'desc').limit(1).get();
    if (!userSnap.empty) {
      const user = userSnap.docs[0].data();
      if (user.sessionString) {
        console.log('Auto-connecting client on startup...');
        const stringSession = new StringSession(user.sessionString);
        const nextClient = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
        await nextClient.connect();
        client = nextClient;
        activeSessionToken = user.sessionToken;
        console.log('Auto-connected client successfully.');
        
        await resumeCampaigns();
      }
    }
  } catch (err) {
    console.error('Auto-resume failed:', err);
  }

  setInterval(() => {}, 1000 * 60 * 60);
}).catch(console.error);
