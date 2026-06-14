const fs = require('fs');
let c = fs.readFileSync('src/App.tsx', 'utf8');

c = c.replace(/setCampaignStatus\(status\);?/g, '');
c = c.replace(/setCampaignStatus\(null\);?/g, '');

fs.writeFileSync('src/App.tsx', c);
