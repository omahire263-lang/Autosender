const fs = require('fs');
let c = fs.readFileSync('src/App.tsx', 'utf8');

c = c.replace(/\r\n/g, '\n');

// 1. Add history and activeCampaigns state
c = c.replace(
  "  const [campaignStatus, setCampaignStatus] = useState<CampaignStatus | null>(null);\n  const [isRunning, setIsRunning] = useState(false);",
  "  const [campaignStatus, setCampaignStatus] = useState<CampaignStatus | null>(null);\n  const [activeCampaigns, setActiveCampaigns] = useState<CampaignStatus[]>([]);\n  const [history, setHistory] = useState<CampaignStatus[]>([]);\n  const [isRunning, setIsRunning] = useState(false);"
);

// 2. Replace fetchStatus
const oldFetchStatus = [
  "  const fetchStatus = useCallback(async () => {",
  "    try {",
  "      const res = await axios.get<{ status: CampaignStatus | null }>(`${API_URL}/campaign/status`);",
  "      const status = res.data.status;",
  "",
  "      if (status) {",
  "        setCampaignStatus(status);",
  "        setIsRunning(status.status === 'Sending');",
  "      } else {",
  "        setCampaignStatus(null);",
  "        setIsRunning(false);",
  "      }",
  "    } catch (error) {",
  "      console.error(error);",
  "    }",
  "  }, []);"
].join('\n');

const newFetchStatus = [
  "  const fetchStatus = useCallback(async () => {",
  "    try {",
  "      const res = await axios.get<{ status: CampaignStatus | null; activeCampaigns: CampaignStatus[] }>(`${API_URL}/campaign/status`);",
  "      const { status, activeCampaigns } = res.data;",
  "      setActiveCampaigns(activeCampaigns || []);",
  "      if (status) {",
  "        setCampaignStatus(status);",
  "        setIsRunning(true);",
  "      } else {",
  "        setCampaignStatus(null);",
  "        setIsRunning(false);",
  "      }",
  "    } catch (error) {",
  "      console.error(error);",
  "    }",
  "  }, []);",
  "",
  "  const fetchHistory = useCallback(async () => {",
  "    try {",
  "      const res = await axios.get<{ history: CampaignStatus[] }>(`${API_URL}/campaign/history`);",
  "      setHistory(res.data.history || []);",
  "    } catch (error) {",
  "      console.error(error);",
  "    }",
  "  }, []);",
  "",
  "  useEffect(() => {",
  "    if (step === 'DASHBOARD') fetchHistory();",
  "  }, [step, fetchHistory]);"
].join('\n');

c = c.replace(oldFetchStatus, newFetchStatus);

// 3. Update startCampaign to fetchHistory
c = c.replace(
  "      setIsRunning(true);\n      await fetchStatus();\n    } catch (error) {",
  "      setIsRunning(true);\n      await fetchStatus();\n      await fetchHistory();\n    } catch (error) {"
);

// 4. Update stopCampaign to pause-all and fetchHistory
const oldStopCampaign = [
  "  const stopCampaign = async () => {",
  "    try {",
  "      await axios.post(`${API_URL}/campaign/stop`);",
  "      setIsRunning(false);",
  "      await fetchStatus();",
  "    } catch (error) {",
  "      console.error(error);",
  "    }",
  "  };"
].join('\n');

const newStopCampaign = [
  "  const stopCampaign = async () => {",
  "    try {",
  "      await axios.post(`${API_URL}/campaign/pause-all`);",
  "      setIsRunning(false);",
  "      await fetchStatus();",
  "      await fetchHistory();",
  "    } catch (error) {",
  "      console.error(error);",
  "    }",
  "  };"
].join('\n');

c = c.replace(oldStopCampaign, newStopCampaign);

// 5. Update resumeCampaign to fetchHistory
c = c.replace(
  "      setIsRunning(true);\n      await fetchStatus();\n    } catch (error) {",
  "      setIsRunning(true);\n      await fetchStatus();\n      await fetchHistory();\n    } catch (error) {"
);

fs.writeFileSync('src/App.tsx', c);
console.log('App.tsx states and hooks updated!');
