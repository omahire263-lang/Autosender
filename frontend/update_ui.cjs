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

// 6. Replace UI Campaign Status Box
const oldCampaignBoxStart = `            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm md:col-span-2 flex flex-col md:flex-row items-center justify-between gap-6">`;
const oldCampaignBoxEnd = `              </div>\n            </div>`;

const idxStart = c.indexOf(oldCampaignBoxStart);
const idxEnd = c.indexOf(oldCampaignBoxEnd, idxStart);
if (idxStart === -1 || idxEnd === -1) {
  console.log("NOT FOUND!");
  process.exit(1);
}

const oldCampaignBoxStr = c.substring(idxStart, idxEnd + oldCampaignBoxEnd.length);

const newCampaignBoxStr = `            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm md:col-span-2 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="text-center md:text-left">
                <h2 className="text-2xl font-bold mb-2 text-gray-900">Active Campaigns</h2>
                {activeCampaigns.length > 0 ? (
                  <div>
                    <p className="text-green-600 font-bold mb-2">{activeCampaigns.length} Campaign(s) Running</p>
                    {activeCampaigns.map((c, i) => (
                      <div key={c.id || i} className="text-sm bg-gray-50 p-2 rounded border border-gray-200 mb-2">
                         <p className="font-semibold truncate w-48 sm:w-64">{c.message}</p>
                         <p className="text-gray-600">Sent: {c.sentCount || 0} / {c.totalUsers || 0} | Status: <span className="text-green-500 font-semibold">{c.status}</span></p>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-gray-500">No active campaigns</p>}
              </div>

              <div className="flex flex-col gap-4 w-full md:w-auto">
                <button onClick={startCampaign} className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white hover:bg-blue-700 px-8 py-3 rounded-xl font-bold text-lg transition-all transform hover:scale-105 shadow-[0_4px_14px_0_rgba(37,99,235,0.39)]">
                  <Play fill="currentColor" /> {activeCampaigns.length > 0 ? 'Start Another' : 'Start Sender'}
                </button>
                {activeCampaigns.length > 0 && (
                  <button onClick={stopCampaign} className="w-full flex items-center justify-center gap-2 bg-red-500 text-white hover:bg-red-600 px-8 py-3 rounded-xl font-bold text-lg transition-all transform hover:scale-105 shadow-[0_4px_14px_0_rgba(239,68,68,0.39)]">
                    <Square fill="currentColor" /> Pause All
                  </button>
                )}
                {!isRunning && history.some(h => h.status === 'Paused') && (
                  <button onClick={resumeCampaign} className="w-full flex items-center justify-center gap-2 bg-green-600 text-white hover:bg-green-700 px-8 py-3 rounded-xl font-bold text-lg transition-all transform hover:scale-105 shadow-[0_4px_14px_0_rgba(34,197,94,0.39)]">
                    <Play fill="currentColor" /> Resume Last Paused
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm md:col-span-2 mt-6">
               <h2 className="text-xl font-bold mb-4 text-gray-900">Campaign History</h2>
               <div className="overflow-x-auto">
                 <table className="w-full text-left border-collapse">
                   <thead>
                     <tr className="bg-gray-100 text-gray-700">
                       <th className="p-3 border-b">Date</th>
                       <th className="p-3 border-b">Message</th>
                       <th className="p-3 border-b">Status</th>
                       <th className="p-3 border-b">Progress</th>
                     </tr>
                   </thead>
                   <tbody>
                     {history.length > 0 ? history.map((h, i) => (
                       <tr key={h.id || i} className="border-b hover:bg-gray-50 transition-colors">
                         <td className="p-3 text-sm text-gray-600 whitespace-nowrap">{h.createdAt ? new Date(h.createdAt).toLocaleString() : 'N/A'}</td>
                         <td className="p-3 text-sm font-medium text-gray-800 max-w-xs truncate" title={h.message}>{h.message}</td>
                         <td className="p-3 text-sm">
                           <span className={\`px-2 py-1 rounded text-xs font-bold \${h.status === 'Completed' ? 'bg-green-100 text-green-700' : h.status === 'Paused' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}\`}>
                             {h.status}
                           </span>
                         </td>
                         <td className="p-3 text-sm text-gray-700 font-semibold">{h.sentCount || 0} / {h.totalUsers || 0}</td>
                       </tr>
                     )) : (
                       <tr><td colSpan={4} className="p-6 text-center text-gray-500">No campaigns yet</td></tr>
                     )}
                   </tbody>
                 </table>
               </div>
            </div>`;

c = c.replace(oldCampaignBoxStr, newCampaignBoxStr);

fs.writeFileSync('src/App.tsx', c);
console.log('App.tsx UI updated!');
