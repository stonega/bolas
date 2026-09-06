export const BACKGROUND_PRESETS = Object.freeze([
  {
    angle: 135,
    asset: 'aurora-mesh.png',
    colors: ['#76d7ff', '#9f6bff', '#f052bb'],
    id: 'aurora',
    name: 'Aurora',
  },
  {
    angle: 130,
    asset: 'lagoon-mesh.png',
    colors: ['#9ee7ff', '#4f8cff', '#7657d5'],
    id: 'sky',
    name: 'Lagoon',
  },
  {
    angle: 140,
    asset: 'ember-mesh.png',
    colors: ['#ffb36b', '#f0587e', '#8c54d9'],
    id: 'sunset',
    name: 'Ember',
  },
  {
    angle: 150,
    asset: 'midnight-mesh.png',
    colors: ['#272a4d', '#3b246d', '#151728'],
    id: 'midnight',
    name: 'Midnight',
  },
  {
    angle: 132,
    asset: 'mint-bloom.png',
    colors: ['#28a48b', '#b7efda', '#742ac2'],
    id: 'mint-bloom',
    name: 'Mint Bloom',
  },
  {
    angle: 118,
    asset: 'violet-bloom.png',
    colors: ['#7130cf', '#6214bd', '#2ca68d'],
    id: 'violet-bloom',
    name: 'Violet Bloom',
  },
  {
    angle: 105,
    asset: 'sunbeam.png',
    colors: ['#bdf2e5', '#e8dc78', '#ffc03c'],
    id: 'sunbeam',
    name: 'Sunbeam',
  },
  {
    angle: 125,
    asset: 'deep-teal.png',
    colors: ['#bdebef', '#128a93', '#121a13'],
    id: 'deep-teal',
    name: 'Deep Teal',
  },
  {
    angle: 112,
    asset: 'brass-tide.png',
    colors: ['#efc94b', '#12878f', '#121817'],
    id: 'brass-tide',
    name: 'Brass Tide',
  },
  {
    angle: 138,
    asset: 'eclipse-gold.png',
    colors: ['#f1cc4b', '#168a92', '#090a0a'],
    id: 'eclipse-gold',
    name: 'Eclipse Gold',
  },
  {
    angle: 120,
    colors: ['#fbfaf7', '#e8e4dc', '#cbc5ba'],
    id: 'paper',
    name: 'Paper',
  },
  {
    angle: 145,
    colors: ['#4c535c', '#272b31', '#17191d'],
    id: 'graphite',
    name: 'Graphite',
  },
]);

export const MIN_BACKGROUND_GRID_COLUMNS = 3;

export const SHARE_RATIOS = Object.freeze([
  { height: 1200, id: 'landscape', label: '4:3', width: 1600 },
  { height: 900, id: 'wide', label: '16:9', width: 1600 },
  { height: 1600, id: 'square', label: '1:1', width: 1600 },
]);

export function backgroundPreset(id) {
  return BACKGROUND_PRESETS.find((preset) => preset.id === id) ?? BACKGROUND_PRESETS[0];
}

export function shareRatio(id) {
  return SHARE_RATIOS.find((ratio) => ratio.id === id) ?? SHARE_RATIOS[0];
}
