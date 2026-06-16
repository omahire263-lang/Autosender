import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { FieldValue } from 'firebase-admin/firestore';
import { initDb, getDb } from './models';
import { whatsappRouter } from './whatsapp';

dotenv.config();

const app = express();
const allowedOrigins = [
  'http://localhost:5173',
  process.env.FRONTEND_URL,
  'https://autosender-p3gue3tpb-omahire21s-projects.vercel.app',
  'https://autosender-web.vercel.app',
  'https://frontend-five-phi-26.vercel.app'
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

app.use('/api/whatsapp', whatsappRouter);

// Health check endpoint for Render
app.get('/', (req, res) => res.status(200).send('Autosender Backend is running!'));
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    clientConnected: connectedClients.length > 0,
    campaignRunning: isCampaignRunning,
    accountsCount: connectedClients.length,
    timestamp: new Date().toISOString()
  });
});

const PORT = Number(process.env.PORT) || 5000;
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

interface AccountClient {
  phoneNumber: string;
  sessionToken: string;
  client: TelegramClient;
  messagesSent: number;
}
let connectedClients: AccountClient[] = [];
let pendingAuthClient: TelegramClient | null = null;
let pendingPhone: string | null = null;
let activeAccountIndex = 0;

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

const getActiveClient = async (req: express.Request, res: express.Response): Promise<TelegramClient | null> => {
  const token = getSessionToken(req);
  const acc = connectedClients.find(c => c.sessionToken === token);
  if (!acc) {
    if (connectedClients.length > 0) return connectedClients[activeAccountIndex % connectedClients.length].client;
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return acc.client;
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
    pendingAuthClient = nextClient;
    pendingPhone = phone;

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  const sessionString = typeof req.body.sessionString === 'string' ? req.body.sessionString.trim() : '';

  // Session-based login (alternative when OTP is rate-limited)
  if (sessionString && !code) {
    try {
      const stringSession = new StringSession(sessionString);
      const nextClient = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
      await nextClient.connect();

      const me = await nextClient.getMe();
      if (!me) {
        return res.status(401).json({ error: 'Invalid session string' });
      }

      const sessionToken = crypto.randomUUID();
      const db = getDb();

      await db.collection('users').doc(phone || me.id?.toString() || sessionToken).set({
        phoneNumber: phone || '',
        sessionString,
        sessionToken,
        createdAt: FieldValue.serverTimestamp()
      }, { merge: true });

      pendingAuthClient = nextClient;
      pendingPhone = phone;
      setSessionCookie(res, sessionToken);

      

      res.json({
        success: true,
        user: me.username || me.firstName || 'User',
        token: sessionToken
      });
    } catch (error) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
    return;
  }

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }

  if (!pendingAuthClient) {
    return res.status(400).json({ error: 'Send OTP first' });
  }

  try {
    await pendingAuthClient.signInUser(
      { apiId, apiHash },
      {
        phoneNumber: async () => phone,
        phoneCode: async () => code,
        password: async () => '',
        onError: (err) => { throw err; }
      }
    );

    const savedSessionString = (pendingAuthClient.session as StringSession).save() as string;
    const me = await pendingAuthClient.getMe();

    if (!me) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const sessionToken = crypto.randomUUID();
    const db = getDb();
    
    await db.collection('users').doc(phone).set({
      phoneNumber: phone,
      sessionString: savedSessionString,
      sessionToken,
      createdAt: FieldValue.serverTimestamp()
    }, { merge: true });

    connectedClients.push({
      phoneNumber: phone,
      sessionToken,
      client: pendingAuthClient,
      messagesSent: 0
    });
    pendingAuthClient = null;
    pendingPhone = null;
    setSessionCookie(res, sessionToken);

    

    res.json({
      success: true,
      user: me.username || me.firstName || 'User',
      token: sessionToken,
      sessionString: savedSessionString
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

    // Prevent duplicate entries in connectedClients
    const alreadyConnected = connectedClients.some(c => c.phoneNumber === (user.phoneNumber || '') || c.sessionToken === sessionToken);
    if (!alreadyConnected) {
      connectedClients.push({
        phoneNumber: user.phoneNumber || '',
        sessionToken: sessionToken,
        client: nextClient,
        messagesSent: 0
      });
    } else {
      // Update the client reference in case it was stale
      const existingIdx = connectedClients.findIndex(c => c.sessionToken === sessionToken);
      if (existingIdx >= 0) {
        connectedClients[existingIdx].client = nextClient;
        connectedClients[existingIdx].messagesSent = connectedClients[existingIdx].messagesSent || 0;
      }
    }

    

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
  const token = getSessionToken(req);
  connectedClients = connectedClients.filter(c => c.sessionToken !== token);
  clearSessionCookie(res);
  res.json({ success: true });
});

app.post('/api/auth/save-session', async (req, res) => {
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  const sessionString = typeof req.body.sessionString === 'string' ? req.body.sessionString.trim() : '';

  if (!sessionString) {
    return res.status(400).json({ error: 'Session string is required' });
  }

  try {
    const stringSession = new StringSession(sessionString);
    const nextClient = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await nextClient.connect();

    const me = await nextClient.getMe();
    if (!me) {
      return res.status(401).json({ error: 'Invalid session string' });
    }

    const newToken = crypto.randomUUID();
    const db = getDb();

    await db.collection('users').doc(phone || me.id?.toString() || newToken).set({
      phoneNumber: phone || '',
      sessionString,
      sessionToken: newToken,
      createdAt: FieldValue.serverTimestamp()
    }, { merge: true });

    connectedClients.push({
      phoneNumber: phone || '',
      sessionToken: newToken,
      client: nextClient,
      messagesSent: 0
    });
    setSessionCookie(res, newToken);

    res.json({
      success: true,
      user: me.username || me.firstName || 'User',
      token: newToken
    });
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.get('/api/telegram/groups', async (req, res) => {
  const activeClient = await getActiveClient(req, res);
  if (!activeClient) return;

  try {
    const dialogs = await activeClient.getDialogs({});
    // Show ALL groups and supergroups - let extraction fail naturally for restricted ones
    const groups = dialogs.filter(d => {
      if (d.isGroup) return true;
      if (d.isChannel) {
        const e = d.entity as any;
        // Include all megagroups (supergroups), regardless of viewParticipants setting
        return e?.megagroup === true;
      }
      return false;
    });
    res.json({ groups: groups.map(g => ({ id: g.id?.toString(), title: g.title })) });
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/telegram/members', async (req, res) => {
  const activeClient = await getActiveClient(req, res);
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

    let allMembers: Array<{ id: string; username?: string; firstName?: string; status: string; isBot: boolean; isDeleted: boolean }> = [];

    for (const id of ids) {
      const participants = await activeClient.getParticipants(id, { limit: 5000 });
      const members = participants.map((p: any) => {
        const statusClass = p.status?.className || '';
        let status = 'unknown';
        if (p.bot) status = 'bot';
        else if (p.deleted) status = 'deleted';
        else if (statusClass === 'UserStatusOnline') status = 'activeToday';
        else if (statusClass === 'UserStatusRecently') status = 'activeToday';
        else if (statusClass === 'UserStatusLastWeek') status = 'activeWeek';
        else if (statusClass === 'UserStatusLastMonth') status = 'inactive';
        else if (statusClass === 'UserStatusEmpty') status = 'unknown';

        return {
          id: p.id?.toString() || '',
          accessHash: p.accessHash?.toString(),
          username: p.username,
          firstName: p.firstName,
          status,
          isBot: !!p.bot,
          isDeleted: !!p.deleted
        };
      }).filter((member: any) => member.id.length > 0);

      allMembers = [...allMembers, ...members];
    }

    const uniqueMembers = Array.from(new Map(allMembers.map(item => [item.id, item])).values());
    
    const stats = {
      total: uniqueMembers.length,
      activeToday: uniqueMembers.filter(m => m.status === 'activeToday').length,
      activeWeek: uniqueMembers.filter(m => m.status === 'activeWeek').length,
      inactive: uniqueMembers.filter(m => m.status === 'inactive').length,
      bots: uniqueMembers.filter(m => m.status === 'bot').length,
      deleted: uniqueMembers.filter(m => m.status === 'deleted').length,
      unknown: uniqueMembers.filter(m => m.status === 'unknown').length,
    };
    
    const db = getDb();
    const sentSnapshot = await db.collection('sent_users').get();
    const sentUserIds = new Set(sentSnapshot.docs.map((doc: any) => doc.id));

    const finalMembers = uniqueMembers.filter(m => !sentUserIds.has(m.id) && !m.isBot && !m.isDeleted);

    // Save unknown users to contacts collection in Firebase for tracking
    const unknownMembers = uniqueMembers.filter(m => m.status === 'unknown');
    if (unknownMembers.length > 0) {
      const batch = db.batch();
      for (const member of unknownMembers) {
        const contactRef = db.collection('contacts').doc(member.id);
        batch.set(contactRef, {
          userId: member.id,
          username: member.username,
          firstName: member.firstName,
          savedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
      await batch.commit().catch(() => {});
    }

res.json({ members: finalMembers, stats });
    } catch (error) {
      res.status(500).json({ error: getErrorMessage(error) });
    }
  });

  // Get unknown contacts saved in Firebase
  app.get('/api/telegram/unknown-contacts', async (req, res) => {
    const activeClient = await getActiveClient(req, res);
    if (!activeClient) return;

    try {
      const db = getDb();
      const snap = await db.collection('contacts').limit(100).get();
      const contacts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json({ contacts });
    } catch (error) {
      res.status(500).json({ error: getErrorMessage(error) });
    }
  });

  // Delete unknown contact from Firebase
  app.delete('/api/telegram/contacts/:userId', async (req, res) => {
    const activeClient = await getActiveClient(req, res);
    if (!activeClient) return;

    const userId = req.params.userId;
    try {
      const db = getDb();
      await db.collection('contacts').doc(userId).delete();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: getErrorMessage(error) });
    }
  });

interface CampaignState {
  dbId: string;
  message: string;
  users: any[];
  groupNames?: string[];
  sent: number;
  failed: number;
  baseDelay: number;
  isRunning: boolean;
  accountStats?: Record<string, number>;
}
let currentCampaign: CampaignState | null = null;
let isCampaignRunning = false;

app.post('/api/campaign/start', async (req, res) => {
  const activeClient = await getActiveClient(req, res);
  if (!activeClient) return;

  if (isCampaignRunning) {
    return res.status(400).json({ error: 'A campaign is already running' });
  }

  const messageText = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  const rawUsers: any[] = Array.isArray(req.body.users) ? req.body.users : [];
  const uniqueUsersMap = new Map();
  for (const u of rawUsers) {
    if (typeof u === 'string' && u.trim().length > 0) uniqueUsersMap.set(u, u);
    else if (typeof u === 'object' && u.id) uniqueUsersMap.set(u.id, u);
  }
  const users = Array.from(uniqueUsersMap.values());
  const totalTimeHours = Number(req.body.totalTimeHours);
  const manualDelaySeconds = Number(req.body.manualDelaySeconds);
  const isManual = req.body.manualDelaySeconds !== undefined;
  const skipCount = Math.max(0, Number(req.body.skipCount) || 0);
  const groupNames: string[] = Array.isArray(req.body.groupNames) ? req.body.groupNames : [];

  if (!messageText) return res.status(400).json({ error: 'Message is required' });
  if (users.length === 0) return res.status(400).json({ error: 'Users are required' });

  let baseDelay: number;
  let totalTimeSeconds: number;

  if (isManual) {
    if (!Number.isFinite(manualDelaySeconds) || manualDelaySeconds <= 0) return res.status(400).json({ error: 'Valid delay is required' });
    baseDelay = manualDelaySeconds;
    totalTimeSeconds = baseDelay * users.length;
  } else {
    if (!Number.isFinite(totalTimeHours) || totalTimeHours <= 0) return res.status(400).json({ error: 'Valid duration is required' });
    totalTimeSeconds = Math.max(1, Math.round(totalTimeHours * 3600));
    baseDelay = totalTimeSeconds / users.length;
  }

  try {
    const db = getDb();
    const totalUsers = users.length;
    const usersToSend = skipCount > 0 ? users.slice(skipCount) : users;
    const campaignRef = await db.collection('campaigns').add({
      message: messageText,
      status: 'Sending',
      totalUsers,
      estimatedTime: totalTimeSeconds,
      remainingUsers: JSON.stringify(usersToSend),
      groupNames: JSON.stringify(groupNames),
      accountStats: {},
      baseDelay,
      createdAt: FieldValue.serverTimestamp(),
      sentCount: skipCount,
      failedCount: 0
    });

    currentCampaign = {
      dbId: campaignRef.id,
      message: messageText,
      users: usersToSend,
      groupNames,
      sent: skipCount,
      failed: 0,
      baseDelay,
      isRunning: true,
      accountStats: {}
    };
    
    isCampaignRunning = true;
    res.json({ success: true, campaignId: campaignRef.id });
    runCampaign();
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

  // Pause the current campaign (allow resume later)
  app.post('/api/campaign/pause-all', async (req, res) => {
    isCampaignRunning = false;
    if (currentCampaign) {
      currentCampaign.isRunning = false;
      const db = getDb();
      await db.collection('campaigns').doc(currentCampaign.dbId).update({ status: 'Paused' }).catch(() => {});
    }
    res.json({ success: true });
  });

  app.post('/api/campaign/resume', async (req, res) => {
  if (isCampaignRunning) return res.json({ success: true });
  
  res.json({ success: true });
});

app.post('/api/campaign/stop-all', async (req, res) => {
  isCampaignRunning = false;
  if (currentCampaign) {
    currentCampaign.isRunning = false;
    const db = getDb();
    await db.collection('campaigns').doc(currentCampaign.dbId).update({ status: 'Stopped' }).catch(() => {});
  }
  currentCampaign = null;

  const db = getDb();
  const snap = await db.collection('campaigns').where('status', '==', 'Sending').get();
  for (const doc of snap.docs) {
    await db.collection('campaigns').doc(doc.id).update({ status: 'Stopped' }).catch(() => {});
  }

  res.json({ success: true });
});

app.get('/api/campaign/status', async (req, res) => {
  const db = getDb();
  const snap = await db.collection('campaigns').where('status', 'in', ['Sending', 'Paused (Flood)']).get();
  const active = snap.docs.map(doc => {
    const data = doc.data();
    let groupNames = [];
    if (data.groupNames) {
      try { groupNames = JSON.parse(data.groupNames); } catch(e) {}
    }
    return { id: doc.id, ...data, groupNames };
  });

  if (active.length === 0 && isCampaignRunning) {
    isCampaignRunning = false;
    currentCampaign = null;
  }

  res.json({ status: active.length > 0 ? active[0] : null, isRunning: isCampaignRunning });
});

app.post('/api/campaign/update-message', async (req, res) => {
  if (currentCampaign) {
    currentCampaign.message = req.body.message || currentCampaign.message;
    try {
      const db = getDb();
      await db.collection('campaigns').doc(currentCampaign.dbId).update({ message: currentCampaign.message });
    } catch(e) {}
  }
  res.json({ success: true });
});

app.post('/api/campaign/update-delay', async (req, res) => {
  if (currentCampaign) {
    currentCampaign.baseDelay = Number(req.body.delaySeconds) || currentCampaign.baseDelay;
    try {
      const db = getDb();
      await db.collection('campaigns').doc(currentCampaign.dbId).update({ baseDelay: currentCampaign.baseDelay });
    } catch(e) {}
  }
  res.json({ success: true });
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function antiBanSpin(text: string): string {
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
  if (connectedClients.length === 0 || !currentCampaign) {
    console.log('runCampaign: No client or campaign', { hasClient: connectedClients.length > 0, hasCampaign: !!currentCampaign });
    return;
  }

  const campaign = currentCampaign;
  const db = getDb();

  while (isCampaignRunning && campaign.isRunning && campaign.users.length > 0) {
    let activeClientWrapper = connectedClients[activeAccountIndex % connectedClients.length];
    let activeClient = activeClientWrapper.client;

    const userObj = campaign.users[0]; // peek
    if (!userObj) {
      campaign.users.shift();
      continue;
    }
    const userIdStr = typeof userObj === 'object' ? userObj.id : userObj;

    let attempts = 0;
    let sent = false;
    
    while (attempts < 3 && !sent) {
      try {
        const uniqueMessage = antiBanSpin(campaign.message);
        console.log(`Sending to ${userIdStr} (attempt ${attempts + 1})...`);
        
        // Resolve user ID to InputPeer
        let peer;
        if (typeof userObj === 'object' && userObj.id) {
            if (userObj.accessHash) {
                peer = new Api.InputPeerUser({ userId: BigInt(userObj.id) as any, accessHash: BigInt(userObj.accessHash) as any });
            } else if (userObj.username) {
                peer = userObj.username;
            } else {
                try { peer = await activeClient.getInputEntity(BigInt(userObj.id) as any); }
                catch (e) { peer = await activeClient.getInputEntity(userObj.id); }
            }
        } else {
            try { peer = await activeClient.getInputEntity(BigInt(userObj) as any); }
            catch (e) { peer = await activeClient.getInputEntity(userObj); }
        }
        
        await activeClient.sendMessage(peer, { message: uniqueMessage });
        sent = true;
        campaign.sent++;
        
        const phoneKey = activeClientWrapper.phoneNumber || 'Unknown';
        campaign.accountStats = campaign.accountStats || {};
        campaign.accountStats[phoneKey] = (campaign.accountStats[phoneKey] || 0) + 1;

        activeClientWrapper.messagesSent = (activeClientWrapper.messagesSent || 0) + 1;
        console.log(`Sent successfully from ${activeClientWrapper.phoneNumber}. Total sent: ${campaign.sent}`);
        await db.collection('sent_users').doc(userIdStr).set({ 
          userId: userIdStr, 
          sentAt: FieldValue.serverTimestamp() 
        }, { merge: true });
        campaign.users.shift(); // remove after success
      } catch (error: any) {
        const errMsg = error?.message || String(error);
        console.error('Failed to send to', userIdStr, errMsg);
        
        // Check for FLOOD_WAIT or PEER_FLOOD error
        const floodMatch = errMsg.match(/FLOOD_WAIT[_ ]*(\d+)/i);
        const isPeerFlood = /PEER_FLOOD/i.test(errMsg);
        
        if (floodMatch && attempts < 2) {
          const waitSeconds = parseInt(floodMatch[1]);
          console.log(`FLOOD_WAIT detected, waiting ${waitSeconds + 15} seconds...`);
          await sleep((waitSeconds + 15) * 1000);
          attempts++;
          continue;
        }
        // For PEER_FLOOD or any other error, retry exactly once
        if (attempts < 1 && !isPeerFlood) {
          console.log(`Error detected (${isPeerFlood ? 'PEER_FLOOD' : 'General'}), retrying 1 more time for ${userIdStr}...`);
          await sleep(5000);
          attempts++;
          continue;
        }

        if (isPeerFlood) {
          console.log(`PEER_FLOOD on account ${activeClientWrapper.phoneNumber}. Switching to next account...`);
          const prevIndex = activeAccountIndex;
          activeAccountIndex++;
          // Only pause if we've cycled through ALL accounts and all had PEER_FLOOD
          const triedAll = (activeAccountIndex - prevIndex) >= connectedClients.length ||
                           activeAccountIndex >= connectedClients.length;
          if (triedAll && connectedClients.every((_, i) => {
            // check if we've been through all accounts
            return activeAccountIndex >= connectedClients.length;
          })) {
            console.log("All accounts restricted. Pausing campaign for 1 hour...");
            activeAccountIndex = 0; // reset
            try { await db.collection('campaigns').doc(campaign.dbId).update({ status: 'Paused (Flood)' }); } catch(e) {}
            await sleep(3600 * 1000); // 1 hour pause
            console.log("Resuming campaign after 1 hour pause.");
            try { await db.collection('campaigns').doc(campaign.dbId).update({ status: 'Sending' }); } catch(e) {}
          }
          continue; // retry the same user on next account
        }
        
        campaign.users.shift(); // remove after failure
        campaign.failed++;
        try { await db.collection('campaigns').doc(campaign.dbId).update({ lastError: errMsg }); } catch(e) {}
        break;
      }
    }

    try {
      const updateData: any = {
        sentCount: campaign.sent,
        failedCount: campaign.failed,
        remainingUsers: JSON.stringify(campaign.users),
        accountStats: campaign.accountStats
      };
      if (campaign.users.length === 0) {
        updateData.status = 'Completed';
      } else if (isCampaignRunning && campaign.isRunning) {
        updateData.status = 'Sending';
      }
      await db.collection('campaigns').doc(campaign.dbId).update(updateData);
    } catch (e) {
      console.error('Failed to update DB', e);
    }

    // Delay with jitter to prevent PEER_FLOOD - minimum 8 seconds + human-like variation
    const baseMs = Math.max(8000, campaign.baseDelay * 1000);
    const jitter = Math.random() * 4000; // Random 0-4 second jitter
    const extraVariation = Math.random() > 0.7 ? 2000 + Math.random() * 3000 : 0; // Occasional extra delay
    const delay = baseMs + jitter + extraVariation;
    await sleep(delay);
  }

  campaign.isRunning = false;
  isCampaignRunning = false;
  currentCampaign = null;
}

app.get('/api/accounts', (req, res) => {
  res.json({
    accounts: connectedClients.map((c, i) => ({
      phone: c.phoneNumber,
      messagesSent: c.messagesSent || 0,
      isActive: i === (activeAccountIndex % Math.max(1, connectedClients.length))
    })),
    total: connectedClients.length
  });
});

app.post('/api/accounts/switch', (req, res) => {
  const phone = req.body.phone;
  const index = connectedClients.findIndex(c => c.phoneNumber === phone);
  if (index !== -1) {
    activeAccountIndex = index;
    res.json({ success: true, activeAccountIndex });
  } else {
    res.status(400).json({ error: 'Account not found' });
  }
});

async function resumeCampaigns() {
  if (isCampaignRunning) return;
  const db = getDb();
  const cSnap = await db.collection('campaigns').where('status', '==', 'Sending').limit(1).get();
  if (cSnap.empty) return;
  
  const doc = cSnap.docs[0];
  const activeDbCampaign = { id: doc.id, ...(doc.data()) } as any;
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
              baseDelay: activeDbCampaign.baseDelay || ((activeDbCampaign.estimatedTime || 3600) / (activeDbCampaign.totalUsers || 1)),
              isRunning: true,
              accountStats: activeDbCampaign.accountStats || {}
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

initDb().then(async () => {
  console.log('Firebase DB initialized');
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

  // Periodic client health check and reconnect
  const HEALTH_CHECK_INTERVAL = 1000 * 60 * 5; // 5 minutes
  const reconnectClient = async () => {
    for (const acc of connectedClients) {
      try {
        await acc.client.getMe();
      } catch (err) {
        console.log(`Client ${acc.phoneNumber} disconnected.`);
        // Remove from connected clients to avoid using dead sessions
        connectedClients = connectedClients.filter(c => c.sessionToken !== acc.sessionToken);
      }
    }
  };

  setInterval(reconnectClient, HEALTH_CHECK_INTERVAL);

  try {
    const db = getDb();
    const userSnap = await db.collection('users').get();
    for (const doc of userSnap.docs) {
      const user = doc.data();
      if (user.sessionString) {
        console.log(`Auto-connecting client ${user.phoneNumber} on startup...`);
        try {
          const stringSession = new StringSession(user.sessionString);
          const nextClient = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
          await nextClient.connect();
          connectedClients.push({
            phoneNumber: user.phoneNumber || '',
            sessionToken: user.sessionToken,
            client: nextClient,
            messagesSent: 0
          });
          console.log(`Auto-connected ${user.phoneNumber} successfully.`);
        } catch (err) {
          console.error(`Failed to auto-connect ${user.phoneNumber}`);
        }
      }
    }
    resumeCampaigns();
  } catch (err) {
    console.error('Auto-resume failed:', err);
  }
}).catch(console.error);