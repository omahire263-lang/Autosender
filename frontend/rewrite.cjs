const fs = require('fs');
let c = fs.readFileSync('src/App.tsx', 'utf8');
const search = /<div className="flex gap-2 mb-4 bg-gray-700 p-1 rounded-lg">[\s\S]*?Have a session string\? Save directly\s*<\/button>\s*<\/div>/;
const replace = `<div className="mb-6">
            <label className="block text-sm text-gray-400 mb-2">Login with OTP</label>
            <input type="text" placeholder="Phone Number (e.g. +123456789)"
              className="w-full bg-gray-700 p-3 rounded mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-100 placeholder-gray-400"
              value={phone} onChange={e => setPhone(e.target.value)} />
            <button onClick={handleSendCode} className="w-full bg-blue-600 text-white hover:bg-blue-700 p-3 rounded font-semibold transition-colors">
              Send Code
            </button>
          </div>

          <div className="flex items-center my-6">
            <div className="flex-1 border-t border-gray-600"></div>
            <span className="px-4 text-gray-500 text-sm font-semibold">OR</span>
            <div className="flex-1 border-t border-gray-600"></div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Login with Backup String</label>
            <input type="password" placeholder="Paste Session String (317...)"
              className="w-full bg-gray-700 p-3 rounded mb-3 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-100 placeholder-gray-400 font-mono text-sm"
              value={sessionString} onChange={e => setSessionString(e.target.value)} />
            <button onClick={() => { setLoginMethod('session'); setTimeout(handleLogin, 50); }} className="w-full bg-green-600 text-white hover:bg-green-700 p-3 rounded font-semibold transition-colors flex items-center justify-center gap-2">
              <Key size={18} /> Login with Session String
            </button>
          </div>
        </div>`;
c = c.replace(search, replace);
fs.writeFileSync('src/App.tsx', c);
