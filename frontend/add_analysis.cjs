const fs = require('fs');
let c = fs.readFileSync('src/App.tsx', 'utf8');

// Normalize line endings for matching
const cn = c.replace(/\r\n/g, '\n');

// 1. Update Member type
let result = cn.replace(
  "type Member = { id: string; username?: string; firstName?: string };",
  "type Member = { id: string; username?: string; firstName?: string; status?: string; isBot?: boolean; isDeleted?: boolean };\ntype MemberStats = { total: number; activeToday: number; activeWeek: number; inactive: number; bots: number; deleted: number; unknown: number; };"
);

// 2. Add stats state after isGroupsLoading
result = result.replace(
  "  const [isGroupsLoading, setIsGroupsLoading] = useState(false);\n",
  "  const [isGroupsLoading, setIsGroupsLoading] = useState(false);\n  const [memberStats, setMemberStats] = useState<MemberStats | null>(null);\n  const [activeFilter, setActiveFilter] = useState<'all' | 'activeToday' | 'activeWeek' | 'active'>('all');\n  const [allExtractedMembers, setAllExtractedMembers] = useState<Member[]>([]);\n"
);

// 3. Replace extractMembers
const oldExtract = [
  "  const extractMembers = async () => {",
  "    if (selectedGroups.length === 0) return alert('Select at least one group');",
  "",
  "    try {",
  "      setMembers([]);",
  "      const res = await axios.post<{ members: Member[] }>(`${API_URL}/telegram/members`, { groupIds: selectedGroups });",
  "      setMembers(res.data.members);",
  "      alert(`Extracted ${res.data.members.length} unique members from ${selectedGroups.length} groups`);",
  "    } catch (error) {",
  "      alert(`Failed to extract members: ${getErrorMessage(error, 'Something went wrong')}`);",
  "    }",
  "  };"
].join('\n');

const newExtract = [
  "  const extractMembers = async () => {",
  "    if (selectedGroups.length === 0) return alert('Select at least one group');",
  "",
  "    try {",
  "      setMembers([]);",
  "      setMemberStats(null);",
  "      setAllExtractedMembers([]);",
  "      const res = await axios.post<{ members: Member[]; stats: MemberStats }>(`${API_URL}/telegram/members`, { groupIds: selectedGroups });",
  "      setAllExtractedMembers(res.data.members);",
  "      setMemberStats(res.data.stats);",
  "      setMembers(res.data.members);",
  "      setActiveFilter('all');",
  "    } catch (error) {",
  "      alert(`Failed to extract members: ${getErrorMessage(error, 'Something went wrong')}`);",
  "    }",
  "  };",
  "",
  "  const applyFilter = (filter: 'all' | 'activeToday' | 'activeWeek' | 'active') => {",
  "    setActiveFilter(filter);",
  "    if (filter === 'all') setMembers(allExtractedMembers);",
  "    else if (filter === 'active') setMembers(allExtractedMembers.filter(m => m.status === 'activeToday' || m.status === 'activeWeek'));",
  "    else setMembers(allExtractedMembers.filter(m => m.status === filter));",
  "  };"
].join('\n');

if (!result.includes(oldExtract)) {
  console.error('extractMembers not found!');
  process.exit(1);
}
result = result.replace(oldExtract, newExtract);

// 4. Replace Ready section
const oldReady = [
  "            {members.length > 0 && (",
  "              <div className=\"mt-3\">",
  "                <p className=\"text-green-400 font-semibold text-center mb-2\">Ready: {members.length} Users</p>"
].join('\n');

const newReady = [
  "            {memberStats && (",
  "              <div className=\"mt-3\">",
  "                <div className=\"grid grid-cols-3 gap-1 mb-3 text-center text-xs\">",
  "                  <div className=\"bg-green-50 border border-green-200 p-2 rounded-lg\">",
  "                    <p className=\"text-lg font-bold text-green-600\">{memberStats.activeToday}</p>",
  "                    <p className=\"text-green-700\">🟢 Active Today</p>",
  "                  </div>",
  "                  <div className=\"bg-yellow-50 border border-yellow-200 p-2 rounded-lg\">",
  "                    <p className=\"text-lg font-bold text-yellow-600\">{memberStats.activeWeek}</p>",
  "                    <p className=\"text-yellow-700\">🟡 This Week</p>",
  "                  </div>",
  "                  <div className=\"bg-gray-50 border border-gray-200 p-2 rounded-lg\">",
  "                    <p className=\"text-lg font-bold text-gray-500\">{memberStats.inactive + memberStats.unknown}</p>",
  "                    <p className=\"text-gray-500\">🔴 Inactive</p>",
  "                  </div>",
  "                </div>",
  "                <div className=\"flex gap-1 mb-2 flex-wrap\">",
  "                  {(['all','active','activeToday','activeWeek'] as const).map(f => (",
  "                    <button key={f} onClick={() => applyFilter(f)}",
  "                      className={`text-xs px-2 py-1 rounded font-semibold transition-colors ${activeFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>",
  "                      {f === 'all' ? `All (${allExtractedMembers.length})` : f === 'active' ? `✅ Active Only (${memberStats.activeToday + memberStats.activeWeek})` : f === 'activeToday' ? `🟢 Today (${memberStats.activeToday})` : `🟡 Week (${memberStats.activeWeek})`}",
  "                    </button>",
  "                  ))}",
  "                </div>",
  "                <p className=\"text-blue-600 font-semibold text-center mb-2\">✅ Ready: {members.length} Users</p>"
].join('\n');

if (!result.includes(oldReady)) {
  console.error('Ready section not found!');
  const idx = result.indexOf('Ready:');
  console.log('Context:', result.substring(idx-300, idx+100));
  process.exit(1);
}
result = result.replace(oldReady, newReady);

fs.writeFileSync('src/App.tsx', result);
console.log('Done! Lines:', result.split('\n').length);
