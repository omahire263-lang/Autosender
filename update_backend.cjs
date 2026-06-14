const fs = require('fs');
let c = fs.readFileSync('backend/server.ts', 'utf8');

c = c.replace(
  /let currentCampaign: \{[\s\S]*?\} \| null = null;\r?\nlet isCampaignRunning = false;/,
  `interface CampaignState {
  dbId: string;
  message: string;
  users: string[];
  sent: number;
  failed: number;
  baseDelay: number;
  isRunning: boolean;
}
const activeCampaigns = new Map<string, CampaignState>();`
);

// Replace /api/campaign/start
const oldStart = c.substring(c.indexOf("app.post('/api/campaign/start'"), c.indexOf("app.post('/api/campaign/stop'") - 1);
const newStart = `app.post('/api/campaign/start', async (req, res) => {
  const activeClient = await getActiveClient(res);
  if (!activeClient) return;

  const messageText = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  const rawUsers: unknown[] = Array.isArray(req.body.users) ? req.body.users : [];
  const users = Array.from(new Set(rawUsers.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)));
  const totalTimeHours = Number(req.body.totalTimeHours);
  const manualDelaySeconds = Number(req.body.manualDelaySeconds);
  const isManual = req.body.manualDelaySeconds !== undefined;
  const skipCount = Math.max(0, Number(req.body.skipCount) || 0);

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
      baseDelay,
      createdAt: FieldValue.serverTimestamp(),
      sentCount: skipCount,
      failedCount: 0
    });

    const campaignState: CampaignState = {
      dbId: campaignRef.id,
      message: messageText,
      users: usersToSend,
      sent: skipCount,
      failed: 0,
      baseDelay,
      isRunning: true
    };
    
    activeCampaigns.set(campaignRef.id, campaignState);
    res.json({ success: true, campaignId: campaignRef.id });
    runCampaign(campaignRef.id);
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});
`;
c = c.replace(oldStart, newStart);

// Replace /api/campaign/stop
const oldStop = c.substring(c.indexOf("app.post('/api/campaign/stop'"), c.indexOf("app.post('/api/campaign/resume'") - 1);
const newStop = `app.post('/api/campaign/pause-all', async (req, res) => {
  const db = getDb();
  for (const [id, campaign] of activeCampaigns.entries()) {
    campaign.isRunning = false;
    await db.collection('campaigns').doc(id).update({ status: 'Paused' }).catch(() => {});
  }
  activeCampaigns.clear();

  // Also pause any stray "Sending" campaigns in DB
  const snap = await db.collection('campaigns').where('status', '==', 'Sending').get();
  for (const doc of snap.docs) {
    await db.collection('campaigns').doc(doc.id).update({ status: 'Paused' }).catch(() => {});
  }

  res.json({ success: true });
});

app.post('/api/campaign/stop', async (req, res) => {
  const db = getDb();
  for (const [id, campaign] of activeCampaigns.entries()) {
    campaign.isRunning = false;
    await db.collection('campaigns').doc(id).update({ status: 'Paused' }).catch(() => {});
  }
  activeCampaigns.clear();
  res.json({ success: true });
});
`;
c = c.replace(oldStop, newStop);

// Add /api/campaign/history
const oldResume = c.substring(c.indexOf("app.post('/api/campaign/resume'"), c.indexOf("app.post('/api/campaign/update-delay'") - 1);
const newHistory = `app.get('/api/campaign/history', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('campaigns').orderBy('createdAt', 'desc').limit(20).get();
    const history = snap.docs.map(doc => {
      const data = doc.data();
      return { id: doc.id, ...data, createdAt: data.createdAt?.toDate?.()?.toISOString() || null };
    });
    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});
`;
c = c.replace(oldResume, newHistory); // remove old resume, we will use history + new campaigns

// Update /api/campaign/status to return active ones
const oldStatus = c.substring(c.indexOf("app.get('/api/campaign/status'"), c.indexOf("const sleep =") - 1);
const newStatus = `app.get('/api/campaign/status', async (req, res) => {
  const db = getDb();
  const snap = await db.collection('campaigns').where('status', '==', 'Sending').get();
  const active = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  res.json({ status: active.length > 0 ? active[0] : null, activeCount: active.length, activeCampaigns: active });
});
`;
c = c.replace(oldStatus, newStatus);

// Update runCampaign
const oldRunCampaign = c.substring(c.indexOf("async function runCampaign() {"), c.indexOf("async function resumeCampaigns() {") - 1);
const newRunCampaign = `async function runCampaign(campaignId: string) {
  const activeClient = client;
  if (!activeClient) return;

  const campaign = activeCampaigns.get(campaignId);
  if (!campaign) return;

  const db = getDb();

  while (campaign.isRunning && campaign.users.length > 0) {
    const userId = campaign.users.shift();
    if (!userId) continue;

    try {
      const uniqueMessage = antiBanSpin(campaign.message);
      await activeClient.sendMessage(userId, { message: uniqueMessage });
      campaign.sent++;
      await db.collection('sent_users').doc(userId).set({ 
        userId, 
        sentAt: FieldValue.serverTimestamp() 
      }, { merge: true });
    } catch (error) {
      console.error('Failed to send to', userId, error);
      campaign.failed++;
    }

    try {
      await db.collection('campaigns').doc(campaign.dbId).update({
        sentCount: campaign.sent,
        failedCount: campaign.failed,
        status: campaign.users.length === 0 ? 'Completed' : 'Sending',
        remainingUsers: JSON.stringify(campaign.users)
      });
    } catch (e) {
      console.error('Failed to update DB', e);
    }

    if (campaign.users.length === 0) {
      campaign.isRunning = false;
      activeCampaigns.delete(campaignId);
      break;
    }

    const baseMs = campaign.baseDelay * 1000;
    const variation = baseMs * 0.2; // ±20% variation for natural timing
    const delay = Math.max(500, baseMs + (Math.random() * variation * 2 - variation));
    await sleep(delay);
  }
}
`;
c = c.replace(oldRunCampaign, newRunCampaign);

// Update resumeCampaigns
const oldResumeCampaigns = c.substring(c.indexOf("async function resumeCampaigns() {"), c.indexOf("initDb().then(async () => {") - 1);
const newResumeCampaigns = `async function resumeCampaigns() {
  const db = getDb();
  const cSnap = await db.collection('campaigns').where('status', '==', 'Sending').get();
  for (const doc of cSnap.docs) {
    const activeDbCampaign = { id: doc.id, ...(doc.data()) } as any;
    if (activeDbCampaign.remainingUsers) {
      try {
        const remaining = JSON.parse(activeDbCampaign.remainingUsers);
        if (remaining.length > 0) {
            const campaignState: CampaignState = {
                dbId: activeDbCampaign.id,
                message: activeDbCampaign.message,
                users: remaining,
                sent: activeDbCampaign.sentCount || 0,
                failed: activeDbCampaign.failedCount || 0,
                baseDelay: activeDbCampaign.baseDelay || ((activeDbCampaign.estimatedTime || 3600) / (activeDbCampaign.totalUsers || 1)),
                isRunning: true
            };
            activeCampaigns.set(campaignState.dbId, campaignState);
            console.log('Resuming campaign from DB', campaignState.dbId);
            runCampaign(campaignState.dbId);
        }
      } catch (e) {
        console.error('Failed to resume campaign', e);
      }
    }
  }
}
`;
c = c.replace(oldResumeCampaigns, newResumeCampaigns);

fs.writeFileSync('backend/server.ts', c);
console.log('Backend refactored for concurrent campaigns!');
