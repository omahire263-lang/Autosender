import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Play, Square, Edit3, Users, Settings, Phone, Key, LogOut } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
axios.defaults.withCredentials = true;

type Step = 'PHONE' | 'CODE' | 'DASHBOARD';
type Group = { id: string; title: string };
type Member = { id: string; username?: string; firstName?: string };
type CampaignStatus = {
  id?: number;
  status?: string;
  totalUsers?: number;
  sentCount?: number;
  failedCount?: number;
  message?: string;
  estimatedTime?: number;
  createdAt?: string;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error || error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
};

function App() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>('PHONE');
  const [isLoading, setIsLoading] = useState(true);
  const [dashboardUser, setDashboardUser] = useState('');

  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [message, setMessage] = useState('Hello! This is a test message.');
  const [durationValue, setDurationValue] = useState<string | number>(3);
  const [durationType, setDurationType] = useState<'hours' | 'minutes'>('hours');
  const [campaignStatus, setCampaignStatus] = useState<CampaignStatus | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const [isGroupsLoading, setIsGroupsLoading] = useState(false);

  const fetchGroups = useCallback(async () => {
    setIsGroupsLoading(true);
    try {
      const res = await axios.get<{ groups: Group[] }>(`${API_URL}/telegram/groups`);
      setGroups(res.data.groups);
    } catch (error) {
      console.error(error);
      alert('Failed to fetch groups from server');
    } finally {
      setIsGroupsLoading(false);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await axios.get<{ status: CampaignStatus | null }>(`${API_URL}/campaign/status`);
      const status = res.data.status;

      if (status) {
        setCampaignStatus(status);
        setIsRunning(status.status === 'Sending');
      } else {
        setCampaignStatus(null);
        setIsRunning(false);
      }
    } catch (error) {
      console.error(error);
    }
  }, []);

  const initSession = useCallback(async () => {
    setIsLoading(true);

    try {
      const res = await axios.post<{ success: boolean; user?: string }>(`${API_URL}/auth/init`);
      setDashboardUser(res.data.user || 'User');
      setStep('DASHBOARD');
      await fetchGroups();
      await fetchStatus();
    } catch {
      setStep('PHONE');
    } finally {
      setIsLoading(false);
    }
  }, [fetchGroups, fetchStatus]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void initSession();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [initSession]);

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [fetchStatus, isRunning]);

  const estimatedDelay = useMemo(() => {
    const val = Number(durationValue) || 0;
    const totalHours = durationType === 'minutes' ? val / 60 : val;
    return members.length ? Math.round((totalHours * 3600) / members.length) : 0;
  }, [durationType, durationValue, members.length]);

  const handleSendCode = async () => {
    try {
      const trimmedPhone = phone.trim();
      const formattedPhone = trimmedPhone.startsWith('+')
        ? trimmedPhone
        : `+91${trimmedPhone.replace(/^0+/, '')}`;

      await axios.post(`${API_URL}/auth/send-code`, { phone: formattedPhone });
      setPhone(formattedPhone);
      setStep('CODE');
    } catch (error) {
      alert(`Failed to send code: ${getErrorMessage(error, 'Something went wrong')}`);
    }
  };

  const handleLogin = async () => {
    try {
      const res = await axios.post<{ success: boolean; user?: string }>(`${API_URL}/auth/login`, { phone, code });
      setDashboardUser(res.data.user || 'User');
      setStep('DASHBOARD');
    } catch (error) {
      alert(`Login failed: ${getErrorMessage(error, 'Something went wrong')}`);
    }
  };

  const extractMembers = async () => {
    if (selectedGroups.length === 0) return alert('Select at least one group');

    try {
      setMembers([]);
      const res = await axios.post<{ members: Member[] }>(`${API_URL}/telegram/members`, { groupIds: selectedGroups });
      setMembers(res.data.members);
      alert(`Extracted ${res.data.members.length} unique members from ${selectedGroups.length} groups`);
    } catch (error) {
      alert(`Failed to extract members: ${getErrorMessage(error, 'Something went wrong')}`);
    }
  };

  const toggleGroup = (id: string) => {
    setSelectedGroups(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  };

  const startCampaign = async () => {
    if (!members.length) return alert('Extract members first');

    try {
      const users = members.map(member => member.id).filter(Boolean);
      const val = Number(durationValue) || 0;
      const totalTimeHours = durationType === 'minutes' ? val / 60 : val;
      
      if (totalTimeHours <= 0) {
        return alert('Please enter a valid duration greater than 0');
      }

      await axios.post(`${API_URL}/campaign/start`, {
        message,
        users,
        totalTimeHours
      });
      setIsRunning(true);
      await fetchStatus();
    } catch (error) {
      alert(`Failed to start campaign: ${getErrorMessage(error, 'Something went wrong')}`);
    }
  };

  const stopCampaign = async () => {
    try {
      await axios.post(`${API_URL}/campaign/stop`);
      setIsRunning(false);
      await fetchStatus();
    } catch (error) {
      console.error(error);
    }
  };

  const updateMessage = async () => {
    try {
      await axios.post(`${API_URL}/campaign/update-message`, { message });
      alert('Message updated live!');
    } catch (error) {
      console.error(error);
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post(`${API_URL}/auth/logout`);
    } catch (error) {
      console.error(error);
    } finally {
      setStep('PHONE');
      setDashboardUser('');
      setGroups([]);
      setSelectedGroups([]);
      setMembers([]);
      setCampaignStatus(null);
      setIsRunning(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-900">
        Loading...
      </div>
    );
  }

  if (step === 'PHONE') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-900">
        <div className="bg-white p-8 rounded-xl shadow-2xl w-96 border border-gray-200">
          <div className="flex justify-center mb-6"><Phone size={48} className="text-blue-500" /></div>
          <h2 className="text-2xl font-bold mb-6 text-center">Telegram Login</h2>
          <input type="text" placeholder="Phone Number (e.g. +123456789)"
            className="w-full bg-gray-100 p-3 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={phone} onChange={e => setPhone(e.target.value)} />
          <button onClick={handleSendCode} className="w-full bg-blue-600 text-white hover:bg-blue-700 p-3 rounded font-semibold transition-colors">
            Send Code
          </button>
        </div>
      </div>
    );
  }

  if (step === 'CODE') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-900">
        <div className="bg-white p-8 rounded-xl shadow-2xl w-96 border border-gray-200">
          <div className="flex justify-center mb-6"><Key size={48} className="text-blue-500" /></div>
          <h2 className="text-2xl font-bold mb-6 text-center">Enter Code</h2>
          <input type="text" placeholder="5-digit code"
            className="w-full bg-gray-100 p-3 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={code} onChange={e => setCode(e.target.value)} />
          <button onClick={handleLogin} className="w-full bg-blue-600 text-white hover:bg-blue-700 p-3 rounded font-semibold transition-colors">
            Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600 flex items-center gap-3">
            <Users className="text-blue-600" size={32} /> Auto-Sender
          </h1>
          <button onClick={handleLogout} className="flex items-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded-lg font-semibold transition-colors">
            <LogOut size={18} /> Logout
          </button>
        </div>

        {dashboardUser && (
          <p className="text-gray-500 text-center sm:text-left">Logged in as: <span className="text-gray-900 font-semibold">{dashboardUser}</span></p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col max-h-[400px]">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h2 className="text-xl font-bold flex items-center gap-2"><Users className="text-blue-600" /> Target Audience</h2>
              <button onClick={fetchGroups} className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded text-gray-700 font-medium">
                {isGroupsLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-gray-50 rounded p-3 mb-4 space-y-2 border border-gray-200">
              {isGroupsLoading ? (
                <p className="text-gray-500 text-sm text-center py-4">Fetching groups from Telegram...</p>
              ) : groups.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">No groups found.</p>
              ) : (
                groups.map(g => (
                  <label key={g.id} className="flex items-center gap-3 p-2 hover:bg-gray-100 rounded cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 bg-white"
                      checked={selectedGroups.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                    />
                    <span className="text-sm text-gray-800 truncate select-none">{g.title}</span>
                  </label>
                ))
              )}
            </div>

            <button onClick={extractMembers} disabled={isGroupsLoading} className="w-full shrink-0 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 p-3 rounded text-gray-800 font-semibold transition-colors">
              Extract Members
            </button>
            {members.length > 0 && (
              <p className="mt-4 text-green-600 font-semibold text-center">Ready: {members.length} Users</p>
            )}
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
             <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Settings className="text-purple-600" /> Settings</h2>
             
             <div className="flex gap-4 mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" className="text-purple-600 focus:ring-purple-500 bg-white border-gray-300" checked={durationType === 'hours'} onChange={() => setDurationType('hours')} />
                  <span className="text-sm text-gray-700 font-medium">Hours</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" className="text-purple-600 focus:ring-purple-500 bg-white border-gray-300" checked={durationType === 'minutes'} onChange={() => setDurationType('minutes')} />
                  <span className="text-sm text-gray-700 font-medium">Minutes</span>
                </label>
             </div>
             
             <label className="block text-gray-600 font-medium text-sm mb-2">Duration ({durationType === 'hours' ? 'Hours' : 'Minutes'})</label>
             <input type="number" min={0.1} step={0.1} value={durationValue} onChange={e => setDurationValue(e.target.value)}
               className="w-full bg-gray-50 border border-gray-200 text-gray-900 p-3 rounded mb-4 outline-none focus:ring-2 focus:ring-purple-500" />

             <label className="block text-gray-600 font-medium text-sm mb-2">Estimated Delay</label>
             <div className="bg-blue-50 border border-blue-100 p-3 rounded text-blue-700 font-mono font-medium">
               {members.length ? estimatedDelay : 0} seconds / msg
             </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm md:col-span-2">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Edit3 className="text-green-600" /> Message Template</h2>
            <textarea
              value={message} onChange={e => setMessage(e.target.value)}
              className="w-full h-32 bg-gray-50 border border-gray-200 text-gray-900 p-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 mb-4 resize-none"
              placeholder="Type your message here..."></textarea>

            <button onClick={updateMessage} className="bg-green-100 text-green-700 hover:bg-green-200 px-6 py-2 rounded-lg font-semibold transition-colors">
              Save Changes Live
            </button>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm md:col-span-2 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-center md:text-left">
              <h2 className="text-2xl font-bold mb-2 text-gray-900">Campaign Status</h2>
              {campaignStatus ? (
                <div>
                  <p className="text-gray-600 font-medium">Status: <span className={campaignStatus.status === 'Sending' ? 'text-green-600' : 'text-yellow-600'}>{campaignStatus.status}</span></p>
                  <p className="text-gray-600 font-medium">Sent: {campaignStatus.sentCount || 0} / {campaignStatus.totalUsers || 0}</p>
                </div>
              ) : <p className="text-gray-500">Not started</p>}
            </div>

            <div className="flex gap-4 w-full md:w-auto">
              {!isRunning ? (
                <button onClick={startCampaign} className="w-full md:w-auto flex items-center justify-center gap-2 bg-blue-600 text-white hover:bg-blue-700 px-8 py-4 rounded-xl font-bold text-lg transition-all transform hover:scale-105 shadow-[0_4px_14px_0_rgba(37,99,235,0.39)]">
                  <Play fill="currentColor" /> Start Sender
                </button>
              ) : (
                <button onClick={stopCampaign} className="w-full md:w-auto flex items-center justify-center gap-2 bg-red-500 text-white hover:bg-red-600 px-8 py-4 rounded-xl font-bold text-lg transition-all transform hover:scale-105 shadow-[0_4px_14px_0_rgba(239,68,68,0.39)]">
                  <Square fill="currentColor" /> Stop
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
