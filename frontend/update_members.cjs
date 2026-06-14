const fs = require('fs');
let c = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Update Member type
c = c.replace(
  "type Member = { id: string; username?: string; firstName?: string };",
  "type Member = { id: string; username?: string; firstName?: string; status?: string; isBot?: boolean; isDeleted?: boolean };\ntype MemberStats = { total: number; activeToday: number; activeWeek: number; inactive: number; bots: number; deleted: number; unknown: number; };"
);

// 2. Add new state after isGroupsLoading state
c = c.replace(
  "  const [isGroupsLoading, setIsGroupsLoading] = useState(false);",
  `  const [isGroupsLoading, setIsGroupsLoading] = useState(false);
  const [memberStats, setMemberStats] = useState<MemberStats | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'activeToday' | 'activeWeek' | 'active'>('all');
  const [allExtractedMembers, setAllExtractedMembers] = useState<Member[]>([]);`
);

// 3. Replace extractMembers function
c = c.replace(
  `  const extractMembers = async () => {
    if (selectedGroups.length === 0) return alert('Select at least one group');

    try {
      setMembers([]);
      const res = await axios.post<{ members: Member[] }>(\`\${API_URL}/telegram/members\`, { groupIds: selectedGroups });
      setMembers(res.data.members);
      alert(\`Extracted \${res.data.members.length} unique members from \${selectedGroups.length} groups\`);
    } catch (error) {
      alert(\`Failed to extract members: \${getErrorMessage(error, 'Something went wrong')}\`);
    }
  };`,
  `  const extractMembers = async () => {
    if (selectedGroups.length === 0) return alert('Select at least one group');

    try {
      setMembers([]);
      setMemberStats(null);
      setAllExtractedMembers([]);
      const res = await axios.post<{ members: Member[]; stats: MemberStats }>(\`\${API_URL}/telegram/members\`, { groupIds: selectedGroups });
      setAllExtractedMembers(res.data.members);
      setMemberStats(res.data.stats);
      setMembers(res.data.members);
      setActiveFilter('all');
    } catch (error) {
      alert(\`Failed to extract members: \${getErrorMessage(error, 'Something went wrong')}\`);
    }
  };

  const applyFilter = (filter: 'all' | 'activeToday' | 'activeWeek' | 'active') => {
    setActiveFilter(filter);
    if (filter === 'all') setMembers(allExtractedMembers);
    else if (filter === 'active') setMembers(allExtractedMembers.filter(m => m.status === 'activeToday' || m.status === 'activeWeek'));
    else setMembers(allExtractedMembers.filter(m => m.status === filter));
  };`
);

fs.writeFileSync('src/App.tsx', c);
console.log('Done! Lines:', c.split('\n').length);
