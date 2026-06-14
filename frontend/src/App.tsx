import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Play, Square, Edit3, Users, Settings, Phone, Key, LogOut, MessageCircle, X, ChevronLeft, ChevronRight } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
axios.defaults.withCredentials = true;

axios.interceptors.request.use(config => {
  const token = localStorage.getItem('tg_session_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

type Step = 'PHONE' | 'CODE' | 'DASHBOARD' | 'SAVE_SESSION';
type Group = { id: string; title: string };
type Member = { id: string; username?: string; firstName?: string; status?: string; isBot?: boolean; isDeleted?: boolean };
type MemberStats = { total: number; activeToday: number; activeWeek: number; inactive: number; bots: number; deleted: number; unknown: number; };
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
  const [platform, setPlatform] = useState<'NONE' | 'TELEGRAM' | 'WHATSAPP'>('NONE');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sessionString, setSessionString] = useState('');
  const [step, setStep] = useState<Step>('PHONE');
  const [isLoading, setIsLoading] = useState(true);
  const [dashboardUser, setDashboardUser] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginMethod, setLoginMethod] = useState<'otp' | 'session'>('otp');
  const [loggedInSessionString, setLoggedInSessionString] = useState('');

  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [message, setMessage] = useState('Hello! This is a test message.');
  const [durationValue, setDurationValue] = useState<string | number>(3);
  const [durationType, setDurationType] = useState<'hours' | 'minutes'>('hours');
  const [manualDelay, setManualDelay] = useState<string | number>(60);
  const [useManualDelay, setUseManualDelay] = useState(false);
  const [skipCount, setSkipCount] = useState<string | number>(0);
  const [activeCampaigns, setActiveCampaigns] = useState<CampaignStatus[]>([]);
  const [history, setHistory] = useState<CampaignStatus[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const itemsPerPage = 15;

  const paginatedHistory = useMemo(() => {
    const start = (historyPage - 1) * itemsPerPage;
    return history.slice(start, start + itemsPerPage);
  }, [history, historyPage]);
  const totalPages = Math.ceil(history.length / itemsPerPage) || 1;

  const [isGroupsLoading, setIsGroupsLoading] = useState(false);
  const [memberStats, setMemberStats] = useState<MemberStats | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'activeToday' | 'activeWeek' | 'active'>('all');
  const [allExtractedMembers, setAllExtractedMembers] = useState<Member[]>([]);

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
      const res = await axios.get<{ status: CampaignStatus | null; activeCampaigns: CampaignStatus[] }>(`${API_URL}/campaign/status`);
      const { status, activeCampaigns } = res.data;
      setActiveCampaigns(activeCampaigns || []);
      if (status) {
        
        setIsRunning(true);
      } else {
        
        setIsRunning(false);
      }
    } catch (error) {
      console.error(error);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await axios.get<{ history: CampaignStatus[] }>(`${API_URL}/campaign/history`);
      setHistory(res.data.history || []);
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    if (step === 'DASHBOARD') fetchHistory();
  }, [step, fetchHistory]);

  const initSession = useCallback(async () => {
    setIsLoading(true);

    try {
      const res = await axios.post<{ success: boolean; user?: string; token?: string }>(`${API_URL}/auth/init`);
      if (res.data.token) {
        localStorage.setItem('tg_session_token', res.data.token);
      }
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

  useEffect(() => {
    const handlePopState = () => {
      if (step === 'CODE' || step === 'SAVE_SESSION') {
        setStep('PHONE');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [step]);

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
      setLoginError('');
      window.history.pushState({ step: 'CODE' }, 'Code');
      alert('OTP sent successfully!');
    } catch (error) {
      alert(`Failed to send code: ${getErrorMessage(error, 'Something went wrong')}`);
    }
  };

  const handleLogin = async () => {
    setLoginError('');
    
    if (loginMethod === 'session') {
      // Session-based login
      if (!sessionString) {
        setLoginError('Session string is required');
        alert('Session string is required');
        return;
      }
      try {
        const res = await axios.post<{ success: boolean; user?: string; token?: string }>(`${API_URL}/auth/login`, { phone, sessionString });
        if (res.data.token) {
          localStorage.setItem('tg_session_token', res.data.token);
        }
        setDashboardUser(res.data.user || 'User');
        setStep('DASHBOARD');
      } catch (error) {
        const errorMsg = axios.isAxiosError(error)
          ? error.response?.data?.error || error.message || 'Login failed'
          : 'Login failed. Something went wrong.';
        setLoginError(errorMsg);
        alert(errorMsg);
      }
      return;
    }
    
    // OTP-based login
    try {
      const res = await axios.post<{ success: boolean; user?: string; token?: string; sessionString?: string }>(`${API_URL}/auth/login`, { phone, code });
      if (res.data.token) {
        localStorage.setItem('tg_session_token', res.data.token);
      }
      setDashboardUser(res.data.user || 'User');
      
      // Show session string for backup
      if (res.data.sessionString) {
        setLoggedInSessionString(res.data.sessionString);
      }
      
      setStep('DASHBOARD');
    } catch (error) {
      let errorMsg = axios.isAxiosError(error)
        ? (error.response?.data?.error || error.message || 'Login failed')
        : 'Login failed. Something went wrong.';

      if (axios.isAxiosError(error)) {
        const rawError: string = error.response?.data?.error || error.message || '';
        if (rawError.toUpperCase().includes('PHONE_CODE_INVALID')) {
          errorMsg = '❌ Incorrect OTP! Please check and try again.';
        } else if (rawError.toUpperCase().includes('PHONE_CODE_EXPIRED')) {
          errorMsg = '⏰ OTP expired! Please go back and request a new one.';
        } else if (rawError.toUpperCase().includes('FLOOD_WAIT') || rawError.toUpperCase().includes('A WAIT OF')) {
          const seconds = rawError.match(/\d+/)?.[0] || '';
          errorMsg = `⏳ Too many attempts! Wait ${seconds ? seconds + ' seconds' : 'some time'} and try again.`;
        } else {
          errorMsg = `Login failed: ${rawError || 'Something went wrong'}`;
        }
      }

      setLoginError(errorMsg);
      alert(errorMsg);
    }
  };

  const handleSaveSession = async () => {
    setLoginError('');
    if (!sessionString) {
      setLoginError('Session string is required');
      alert('Session string is required');
      return;
    }
    try {
      const res = await axios.post<{ success: boolean; user?: string; token?: string }>(`${API_URL}/auth/save-session`, { phone, sessionString });
      if (res.data.token) {
        localStorage.setItem('tg_session_token', res.data.token);
      }
      setDashboardUser(res.data.user || 'User');
      setStep('DASHBOARD');
    } catch (error) {
      const errorMsg = axios.isAxiosError(error)
        ? error.response?.data?.error || error.message || 'Failed to save session'
        : 'Failed to save session. Try again.';
      setLoginError(errorMsg);
      alert(errorMsg);
    }
  };

  const extractMembers = async () => {
    if (selectedGroups.length === 0) return alert('Select at least one group');

    try {
      setMembers([]);
      setMemberStats(null);
      setAllExtractedMembers([]);
      const res = await axios.post<{ members: Member[]; stats: MemberStats }>(`${API_URL}/telegram/members`, { groupIds: selectedGroups });
      setAllExtractedMembers(res.data.members);
      setMemberStats(res.data.stats);
      setMembers(res.data.members);
      setActiveFilter('all');
    } catch (error) {
      alert(`Failed to extract members: ${getErrorMessage(error, 'Something went wrong')}`);
    }
  };

  const applyFilter = (filter: 'all' | 'activeToday' | 'activeWeek' | 'active') => {
    setActiveFilter(filter);
    if (filter === 'all') setMembers(allExtractedMembers);
    else if (filter === 'active') setMembers(allExtractedMembers.filter(m => m.status === 'activeToday' || m.status === 'activeWeek'));
    else setMembers(allExtractedMembers.filter(m => m.status === filter));
  };

  const toggleGroup = (id: string) => {
    setSelectedGroups(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  };

  const startCampaign = async () => {
    if (!members.length) return alert('Extract members first');

    try {
      const skip = Math.max(0, Number(skipCount) || 0);
      const users = members.map(member => member.id).filter(Boolean);

      if (useManualDelay) {
        const delaySeconds = Number(manualDelay);
        if (!delaySeconds || delaySeconds <= 0) return alert('Please enter a valid delay in seconds');
        await axios.post(`${API_URL}/campaign/start`, { message, users, manualDelaySeconds: delaySeconds, skipCount: skip });
      } else {
        const val = Number(durationValue) || 0;
        const totalTimeHours = durationType === 'minutes' ? val / 60 : val;
        if (totalTimeHours <= 0) return alert('Please enter a valid duration greater than 0');
        await axios.post(`${API_URL}/campaign/start`, { message, users, totalTimeHours, skipCount: skip });
      }

      setIsRunning(true);
      await fetchStatus();
      await fetchHistory();
    } catch (error) {
      alert(`Failed to start campaign: ${getErrorMessage(error, 'Something went wrong')}`);
    }
  };

  const stopCampaign = async () => {
    try {
      await axios.post(`${API_URL}/campaign/pause-all`);
      setIsRunning(false);
      await fetchStatus();
      await fetchHistory();
    } catch (error) {
      console.error(error);
    }
  };

  const closeAllCampaigns = async () => {
    try {
      await axios.post(`${API_URL}/campaign/stop-all`);
      setIsRunning(false);
      await fetchStatus();
      await fetchHistory();
    } catch (error) {
      console.error(error);
    }
  };

  const resumeCampaign = async () => {
    try {
      await axios.post(`${API_URL}/campaign/resume`);
      setIsRunning(true);
      await fetchStatus();
      await fetchHistory();
    } catch (error) {
      alert(`Failed to resume: ${getErrorMessage(error, 'Something went wrong')}`);
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

  const updateDelay = async () => {
    const delaySeconds = Number(manualDelay);
    if (!delaySeconds || delaySeconds <= 0) return alert('Enter a valid delay in seconds');
    try {
      await axios.post(`${API_URL}/campaign/update-delay`, { delaySeconds });
      alert(`Delay updated to ${delaySeconds} seconds!`);
    } catch (error) {
      alert(`Failed to update delay: ${getErrorMessage(error, 'Something went wrong')}`);
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post(`${API_URL}/auth/logout`);
    } catch (error) {
      console.error(error);
    } finally {
      localStorage.removeItem('tg_session_token');
      setStep('PHONE');
      setDashboardUser('');
      setGroups([]);
      setSelectedGroups([]);
      setMembers([]);
      
      setIsRunning(false);
    }
  };

if (platform === 'NONE') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white text-gray-900 p-4">
        <h1 className="text-4xl font-extrabold mb-12 text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-green-600 text-center">
          Choose Platform
        </h1>
        <div className="flex flex-col sm:flex-row gap-6 w-full max-w-3xl">
          <button 
            onClick={() => setPlatform('TELEGRAM')}
            className="flex-1 bg-white border border-blue-300 hover:border-blue-500 p-10 rounded-3xl flex flex-col items-center justify-center gap-6 transition-all group shadow-lg"
          >
            <div className="p-6 bg-blue-100 rounded-full group-hover:scale-110 transition-transform">
              <Users size={64} className="text-blue-600" />
            </div>
            <h2 className="text-3xl font-bold text-gray-800">Telegram</h2>
            <p className="text-gray-600 text-center text-sm px-4">Automate group extractions and bulk messaging securely.</p>
          </button>

          <button 
            onClick={() => setPlatform('WHATSAPP')}
            className="flex-1 bg-white border border-green-300 hover:border-green-500 p-10 rounded-3xl flex flex-col items-center justify-center gap-6 transition-all group shadow-lg"
          >
            <div className="p-6 bg-green-100 rounded-full group-hover:scale-110 transition-transform">
              <MessageCircle size={64} className="text-green-600" />
            </div>
            <h2 className="text-3xl font-bold text-gray-800">WhatsApp</h2>
            <p className="text-gray-600 text-center text-sm px-4">Link via phone number (8-digit code) and automate campaigns.</p>
          </button>
        </div>
      </div>
    );
  }

  if (platform === 'WHATSAPP') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-gray-900 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-green-300 text-center">
          <div className="flex justify-center mb-6"><MessageCircle size={56} className="text-green-600" /></div>
          <h2 className="text-2xl font-bold mb-3">WhatsApp Automation</h2>
          <p className="text-gray-600 mb-8 text-sm px-2">
            Enter your phone number to receive an 8-digit linking code on your WhatsApp app. No QR scan needed!
          </p>
          <input type="text" placeholder="Phone Number (e.g. +91...)"
            className="w-full bg-gray-100 p-4 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900 placeholder-gray-500"
          />
          <button className="w-full bg-green-600 text-white hover:bg-green-700 p-4 rounded-xl font-bold transition-colors">
            Get 8-Digit Pairing Code
          </button>
          
          <button onClick={() => setPlatform('NONE')} className="mt-6 text-gray-500 hover:text-gray-700 underline text-sm transition-colors">
            Go Back to Selection
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-900">
        Loading...
      </div>
    );
  }

if (step === 'PHONE') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-gray-900">
        <div className="bg-white p-8 rounded-xl shadow-xl w-96 border border-gray-300">
          <div className="flex justify-center mb-6"><Phone size={48} className="text-blue-500" /></div>
          <h2 className="text-2xl font-bold mb-6 text-center">Telegram Login</h2>

          <div className="mb-6">
            <label className="block text-sm text-gray-600 mb-2">Login with OTP</label>
            <input type="text" placeholder="Phone Number (e.g. +123456789)"
              className="w-full bg-gray-100 p-3 rounded mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-500"
              value={phone} onChange={e => setPhone(e.target.value)} />
            <button onClick={handleSendCode} className="w-full bg-blue-600 text-white hover:bg-blue-700 p-3 rounded font-semibold transition-colors">
              Send Code
            </button>
          </div>

          <div className="flex items-center my-6">
            <div className="flex-1 border-t border-gray-300"></div>
            <span className="px-4 text-gray-500 text-sm font-semibold">OR</span>
            <div className="flex-1 border-t border-gray-300"></div>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-2">Login with Backup String</label>
            <input type="password" placeholder="Paste Session String (317...)"
              className="w-full bg-gray-100 p-3 rounded mb-3 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900 placeholder-gray-500 font-mono text-sm"
              value={sessionString} onChange={e => setSessionString(e.target.value)} />
            <button onClick={() => { setLoginMethod('session'); setTimeout(handleLogin, 50); }} className="w-full bg-green-600 text-white hover:bg-green-700 p-3 rounded font-semibold transition-colors flex items-center justify-center gap-2">
              <Key size={18} /> Login with Session String
            </button>
          </div>
        </div>
      </div>
    );
  }

if (step === 'SAVE_SESSION') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-gray-900">
        <div className="bg-white p-8 rounded-xl shadow-xl w-96 border border-gray-300">
          <div className="flex justify-center mb-6"><Key size={48} className="text-purple-500" /></div>
          <h2 className="text-2xl font-bold mb-6 text-center">Save Session</h2>
          {loginError && (
            <div className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm font-medium border border-red-300">
              {loginError}
            </div>
          )}
          <input type="text" placeholder="Phone (optional)"
            className="w-full bg-gray-100 p-3 rounded mb-3 focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 placeholder-gray-500"
            value={phone} onChange={e => setPhone(e.target.value)} />
          <input type="password" placeholder="Session String (317XXXXXXXXXXXXXXX...)"
            className="w-full bg-gray-100 p-3 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 placeholder-gray-500 font-mono text-sm"
            value={sessionString} onChange={e => setSessionString(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={() => setStep('PHONE')} className="flex-1 bg-gray-200 text-gray-700 hover:bg-gray-300 p-2 rounded transition-colors">
              Back
            </button>
            <button onClick={handleSaveSession} className="flex-1 bg-purple-600 text-white hover:bg-purple-700 p-3 rounded font-semibold transition-colors">
              Save & Connect
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'CODE') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-gray-900">
        <div className="bg-white p-8 rounded-xl shadow-xl w-96 border border-gray-300">
          <div className="flex justify-center mb-6"><Key size={48} className="text-blue-500" /></div>
          <h2 className="text-2xl font-bold mb-6 text-center">Enter Code</h2>
          {loginError && (
            <div className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm font-medium border border-red-300">
              {loginError}
            </div>
          )}
          <input type="text" placeholder="5-digit code"
            className="w-full bg-gray-100 p-3 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-500"
            value={code} onChange={e => setCode(e.target.value)} />
          <button onClick={handleLogin} className="w-full bg-blue-600 text-white hover:bg-blue-700 p-3 rounded font-semibold transition-colors">
            Login
          </button>
        </div>
      </div>
    );
  }

return (
    <div className="min-h-screen bg-gray-100 text-gray-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 flex items-center gap-3">
            <Users className="text-blue-400" size={32} /> Auto-Sender
          </h1>
          <button onClick={handleLogout} className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold transition-colors">
            <LogOut size={18} /> Logout
          </button>
        </div>

        {dashboardUser && (
          <div className="flex flex-col sm:flex-row items-center justify-between bg-white p-4 rounded-lg border border-gray-200">
            <p className="text-gray-500 text-center sm:text-left mb-4 sm:mb-0">Logged in as: <span className="text-gray-900 font-semibold">{dashboardUser}</span></p>
            {loggedInSessionString && (
              <div className="flex items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                <input type="password" readOnly value={loggedInSessionString} className="bg-gray-100 border border-gray-300 rounded p-2 text-sm text-gray-500 w-full sm:w-48 font-mono outline-none" placeholder="Session String" />
                <button onClick={() => { navigator.clipboard.writeText(loggedInSessionString); alert('Copied to clipboard!'); }} className="bg-purple-600 text-white px-3 py-2 rounded text-sm font-semibold hover:bg-purple-700 transition-colors whitespace-nowrap flex items-center gap-1">
                  <Key size={14}/> Copy Session
                </button>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col max-h-[400px]">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h2 className="text-xl font-bold flex items-center gap-2 text-gray-900"><Users className="text-blue-400" /> Target Audience</h2>
              <button onClick={fetchGroups} className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded text-gray-600 font-medium">
                {isGroupsLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-gray-100 rounded p-3 mb-4 space-y-2 border border-gray-300">
              {isGroupsLoading ? (
                <p className="text-gray-500 text-sm text-center py-4">Fetching groups from Telegram...</p>
              ) : groups.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">No groups found.</p>
              ) : (
                groups.map(g => (
                  <label key={g.id} className="flex items-center gap-3 p-2 hover:bg-gray-200 rounded cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      className="w-5 h-5 rounded border-gray-500 text-blue-400 focus:ring-blue-500 bg-gray-100"
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
            {memberStats && (
              <div className="mt-3">
                <div className="grid grid-cols-3 gap-1 mb-3 text-center text-xs">
                  <div className="bg-green-50 border border-green-200 p-2 rounded-lg">
                    <p className="text-lg font-bold text-green-600">{memberStats.activeToday}</p>
                    <p className="text-green-700">🟢 Active Today</p>
                  </div>
                  <div className="bg-yellow-50 border border-yellow-200 p-2 rounded-lg">
                    <p className="text-lg font-bold text-yellow-600">{memberStats.activeWeek}</p>
                    <p className="text-yellow-700">🟡 This Week</p>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 p-2 rounded-lg">
                    <p className="text-lg font-bold text-gray-500">{memberStats.inactive + memberStats.unknown}</p>
                    <p className="text-gray-500">🔴 Inactive</p>
                  </div>
                </div>
                <div className="flex gap-1 mb-2 flex-wrap">
                  {(['all','active','activeToday','activeWeek'] as const).map(f => (
                    <button key={f} onClick={() => applyFilter(f)}
                      className={`text-xs px-2 py-1 rounded font-semibold transition-colors ${activeFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {f === 'all' ? `All (${allExtractedMembers.length})` : f === 'active' ? `✅ Active Only (${memberStats.activeToday + memberStats.activeWeek})` : f === 'activeToday' ? `🟢 Today (${memberStats.activeToday})` : `🟡 Week (${memberStats.activeWeek})`}
                    </button>
                  ))}
                </div>
                <p className="text-blue-600 font-semibold text-center mb-2">✅ Ready: {members.length} Users</p>
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={Number(skipCount) > 0}
                    onChange={e => setSkipCount(e.target.checked ? 1 : 0)}
                    className="w-4 h-4 rounded border-gray-500 text-blue-400"
                  />
                  <span className="text-xs text-gray-600 font-medium">Skip starting members</span>
                </label>
                {Number(skipCount) > 0 && (
                  <div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500 font-medium whitespace-nowrap">Skip first</label>
                      <input
                        type="number" min={1} max={members.length - 1} value={skipCount}
                        onChange={e => setSkipCount(e.target.value)}
                        className="w-20 bg-gray-100 border border-gray-300 text-gray-900 p-1.5 rounded text-sm outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <label className="text-xs text-gray-500 font-medium whitespace-nowrap">members</label>
                    </div>
                    <p className="text-xs text-orange-400 mt-1">⚠️ First {skipCount} skipped. Sending to {members.length - Number(skipCount)} members. Counter: {skipCount}/{members.length}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
             <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-gray-900"><Settings className="text-purple-400" /> Settings</h2>

             {/* Mode Toggle */}
             <div className="flex gap-2 mb-4 bg-gray-100 p-1 rounded-lg">
               <button
                 onClick={() => setUseManualDelay(false)}
                 className={`flex-1 py-2 px-3 rounded-md text-sm font-semibold transition-colors ${!useManualDelay ? 'bg-gray-200 shadow text-purple-400' : 'text-gray-500'}`}
               >
                 ⏱ Auto (Hours/Min)
               </button>
               <button
                 onClick={() => setUseManualDelay(true)}
                 className={`flex-1 py-2 px-3 rounded-md text-sm font-semibold transition-colors ${useManualDelay ? 'bg-gray-200 shadow text-orange-400' : 'text-gray-500'}`}
               >
                 ⚡ Manual (Seconds)
               </button>
             </div>

             {useManualDelay ? (
               /* Manual Delay Mode */
               <div>
                 <label className="block text-gray-600 font-medium text-sm mb-2">Delay Between Messages (seconds)</label>
                 <input type="number" min={1} step={1} value={manualDelay} onChange={e => setManualDelay(e.target.value)}
                   className="w-full bg-gray-100 border border-gray-300 text-gray-900 p-3 rounded mb-3 outline-none focus:ring-2 focus:ring-orange-400" />
                 {isRunning && (
                   <button onClick={updateDelay} className="w-full bg-orange-900 text-orange-300 hover:bg-orange-800 p-2 rounded font-semibold text-sm transition-colors">
                     🔄 Update Delay Live
                   </button>
                 )}
                 <p className="text-xs text-gray-500 mt-2">Campaign chalte waqt bhi delay change kar sakte ho</p>
               </div>
             ) : (
               /* Auto Duration Mode */
               <div>
                 <div className="flex gap-4 mb-4">
                   <label className="flex items-center gap-2 cursor-pointer">
                     <input type="radio" className="text-purple-400 focus:ring-purple-500 bg-gray-100 border-gray-500" checked={durationType === 'hours'} onChange={() => setDurationType('hours')} />
                     <span className="text-sm text-gray-600 font-medium">Hours</span>
                   </label>
                   <label className="flex items-center gap-2 cursor-pointer">
                     <input type="radio" className="text-purple-400 focus:ring-purple-500 bg-gray-100 border-gray-500" checked={durationType === 'minutes'} onChange={() => setDurationType('minutes')} />
                     <span className="text-sm text-gray-600 font-medium">Minutes</span>
                   </label>
                 </div>
                 <label className="block text-gray-600 font-medium text-sm mb-2">Duration ({durationType === 'hours' ? 'Hours' : 'Minutes'})</label>
                 <input type="number" min={0.1} step={0.1} value={durationValue} onChange={e => setDurationValue(e.target.value)}
                   className="w-full bg-gray-100 border border-gray-300 text-gray-900 p-3 rounded mb-4 outline-none focus:ring-2 focus:ring-purple-500" />
                 <label className="block text-gray-600 font-medium text-sm mb-2">Estimated Delay</label>
                 <div className="bg-blue-900 border border-blue-700 p-3 rounded text-blue-300 font-mono font-medium">
                   {members.length ? estimatedDelay : 0} seconds / msg
                 </div>
               </div>
             )}
           </div>

           <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm md:col-span-2">
             <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-gray-900"><Edit3 className="text-green-400" /> Message Template</h2>
             <textarea
               value={message} onChange={e => setMessage(e.target.value)}
               className="w-full h-32 bg-gray-100 border border-gray-300 text-gray-900 p-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 mb-4 resize-none"
               placeholder="Type your message here..."></textarea>

             <button onClick={updateMessage} className="bg-green-900 text-green-300 hover:bg-green-800 px-6 py-2 rounded-lg font-semibold transition-colors">
               Save Changes Live
             </button>
           </div>

           <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm md:col-span-2 flex flex-col md:flex-row items-center justify-between gap-6">
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
                  <div className="flex gap-2">
                    <button onClick={stopCampaign} className="w-full flex items-center justify-center gap-2 bg-red-500 text-white hover:bg-red-600 px-6 py-3 rounded-xl font-bold text-lg transition-all transform hover:scale-105 shadow-[0_4px_14px_0_rgba(239,68,68,0.39)]">
                      <Square fill="currentColor" /> Pause
                    </button>
                    <button onClick={closeAllCampaigns} className="w-full flex items-center justify-center gap-2 bg-gray-800 text-white hover:bg-gray-900 px-6 py-3 rounded-xl font-bold text-lg transition-all transform hover:scale-105 shadow-[0_4px_14px_0_rgba(31,41,55,0.39)]">
                      <X fill="currentColor" /> Close
                    </button>
                  </div>
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
                     {paginatedHistory.length > 0 ? paginatedHistory.map((h, i) => (
                       <tr key={h.id || i} className="border-b hover:bg-gray-50 transition-colors">
                         <td className="p-3 text-sm text-gray-600 whitespace-nowrap">{h.createdAt ? new Date(h.createdAt).toLocaleString() : 'N/A'}</td>
                         <td className="p-3 text-sm font-medium text-gray-800 max-w-xs truncate" title={h.message}>{h.message}</td>
                         <td className="p-3 text-sm">
                           <span className={`px-2 py-1 rounded text-xs font-bold ${h.status === 'Completed' ? 'bg-green-100 text-green-700' : h.status === 'Stopped' ? 'bg-red-100 text-red-700' : h.status === 'Paused' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>
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
               {totalPages > 1 && (
                 <div className="flex items-center justify-center gap-4 mt-6">
                   <button
                     onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                     disabled={historyPage === 1}
                     className="p-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                   >
                     <ChevronLeft size={20} />
                   </button>
                   <span className="text-gray-700 font-medium text-sm">
                     Page {historyPage} of {totalPages}
                   </span>
                   <button
                     onClick={() => setHistoryPage(p => Math.min(totalPages, p + 1))}
                     disabled={historyPage === totalPages}
                     className="p-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                   >
                     <ChevronRight size={20} />
                   </button>
                 </div>
               )}
            </div>
         </div>
       </div>
     </div>
   );
}

export default App;
