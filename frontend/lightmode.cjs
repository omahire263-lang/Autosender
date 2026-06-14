const fs = require('fs');
let c = fs.readFileSync('src/App.tsx', 'utf8');

// Background conversions
c = c.replace(/bg-gray-900/g, 'bg-gray-100');
c = c.replace(/bg-gray-800/g, 'bg-white');
c = c.replace(/bg-gray-700/g, 'bg-gray-100');
c = c.replace(/bg-gray-600/g, 'bg-gray-200');

// Border conversions
c = c.replace(/border-gray-700/g, 'border-gray-200');
c = c.replace(/border-gray-600/g, 'border-gray-300');

// Text conversions
c = c.replace(/text-gray-100/g, 'text-gray-900');
c = c.replace(/text-gray-200/g, 'text-gray-800');
c = c.replace(/text-gray-300/g, 'text-gray-600');
c = c.replace(/text-gray-400/g, 'text-gray-500');

// Placeholder
c = c.replace(/placeholder-gray-400/g, 'placeholder-gray-400');

// Shadow upgrade
c = c.replace(/shadow-2xl/g, 'shadow-xl');

// hover overrides
c = c.replace(/hover:bg-gray-600/g, 'hover:bg-gray-200');
c = c.replace(/hover:bg-gray-700/g, 'hover:bg-gray-100');

fs.writeFileSync('src/App.tsx', c);
console.log('Done!');
